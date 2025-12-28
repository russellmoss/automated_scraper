// cloud-functions/savvy-pirate-sync/index.js
// Google Cloud Function to receive scraped data and insert into BigQuery
// Deploy with: gcloud functions deploy savvy-pirate-sync --runtime nodejs18 --trigger-http --allow-unauthenticated

const { BigQuery } = require('@google-cloud/bigquery');
const { v4: uuidv4 } = require('uuid');

const bigquery = new BigQuery();
const DATASET_ID = 'savvy_pirate';
const PROJECT_ID = process.env.GCP_PROJECT || 'YOUR_PROJECT_ID';

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Main Cloud Function entry point
 */
exports.savvyPirateSync = async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set(corsHeaders);
    res.status(204).send('');
    return;
  }

  res.set(corsHeaders);

  try {
    const { action, data } = req.body;

    switch (action) {
      case 'sync_profiles':
        return await syncProfiles(data, res);
      
      case 'get_or_create_recruiter':
        return await getOrCreateRecruiter(data, res);
      
      case 'create_scrape_run':
        return await createScrapeRun(data, res);
      
      case 'complete_scrape_run':
        return await completeScrapeRun(data, res);
      
      case 'import_recruiters':
        return await importRecruiters(data, res);
      
      case 'test_connection':
        return res.json({ success: true, message: 'Connected to BigQuery' });
      
      default:
        return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    }

  } catch (error) {
    console.error('Function error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Normalize LinkedIn URL to canonical form
 */
function normalizeLinkedInUrl(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?]+)/i);
  return match ? `https://www.linkedin.com/in/${match[1].toLowerCase()}` : url;
}

function extractLinkedInId(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Sync scraped profiles to BigQuery
 */
async function syncProfiles(data, res) {
  const { profiles, recruiterId, recruiterName, searchType, scrapeRunId } = data;
  
  if (!profiles || !Array.isArray(profiles)) {
    return res.status(400).json({ success: false, error: 'profiles array required' });
  }

  let synced = 0;
  let errors = 0;
  const today = new Date().toISOString().split('T')[0];

  for (const profile of profiles) {
    try {
      if (!profile.name || !profile.linkedinUrl) continue;

      const normalizedUrl = normalizeLinkedInUrl(profile.linkedinUrl);
      const linkedinId = extractLinkedInId(profile.linkedinUrl);
      const advisorId = uuidv4();

      // Check if advisor exists
      const [existingAdvisor] = await bigquery.query({
        query: `SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.advisors\` WHERE linkedin_url = @url LIMIT 1`,
        params: { url: normalizedUrl }
      });

      let finalAdvisorId;

      if (existingAdvisor.length > 0) {
        finalAdvisorId = existingAdvisor[0].id;
        // Update existing advisor
        await bigquery.query({
          query: `
            UPDATE \`${PROJECT_ID}.${DATASET_ID}.advisors\`
            SET 
              name = @name,
              current_title = COALESCE(@title, current_title),
              current_location = COALESCE(@location, current_location),
              accreditations = CASE WHEN ARRAY_LENGTH(@accreditations) > 0 THEN @accreditations ELSE accreditations END,
              last_seen_at = CURRENT_TIMESTAMP(),
              times_seen = times_seen + 1,
              updated_at = CURRENT_TIMESTAMP()
            WHERE id = @id
          `,
          params: {
            id: finalAdvisorId,
            name: profile.name.trim(),
            title: profile.title || null,
            location: profile.location || null,
            accreditations: (profile.accreditations || []).filter(a => a)
          }
        });
      } else {
        finalAdvisorId = advisorId;
        // Insert new advisor
        await bigquery.dataset(DATASET_ID).table('advisors').insert([{
          id: advisorId,
          linkedin_url: normalizedUrl,
          linkedin_id: linkedinId,
          name: profile.name.trim(),
          current_title: profile.title || null,
          current_location: profile.location || null,
          accreditations: (profile.accreditations || []).filter(a => a),
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          times_seen: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);
      }

      // Check if connection exists
      const [existingConn] = await bigquery.query({
        query: `
          SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.connections\` 
          WHERE advisor_id = @advisorId AND recruiter_id = @recruiterId 
          LIMIT 1
        `,
        params: { advisorId: finalAdvisorId, recruiterId }
      });

      if (existingConn.length > 0) {
        // Update last_seen_date
        await bigquery.query({
          query: `
            UPDATE \`${PROJECT_ID}.${DATASET_ID}.connections\`
            SET last_seen_date = @today
            WHERE advisor_id = @advisorId AND recruiter_id = @recruiterId
          `,
          params: { today, advisorId: finalAdvisorId, recruiterId }
        });
      } else {
        // Insert new connection
        await bigquery.dataset(DATASET_ID).table('connections').insert([{
          id: uuidv4(),
          advisor_id: finalAdvisorId,
          recruiter_id: recruiterId,
          first_seen_date: today,
          last_seen_date: today,
          search_type: searchType || null,
          scrape_run_id: scrapeRunId || null,
          created_at: new Date().toISOString()
        }]);
      }

      synced++;
    } catch (err) {
      console.error('Profile sync error:', err);
      errors++;
    }
  }

  return res.json({ success: true, synced, errors });
}

/**
 * Get or create a recruiter
 */
async function getOrCreateRecruiter(data, res) {
  const { name, frequency, company, title, sheetUrl } = data;

  if (!name) {
    return res.status(400).json({ success: false, error: 'name required' });
  }

  // Check if exists
  const [existing] = await bigquery.query({
    query: `SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` WHERE name = @name LIMIT 1`,
    params: { name: name.trim() }
  });

  if (existing.length > 0) {
    return res.json({ success: true, recruiterId: existing[0].id, created: false });
  }

  // Create new
  const recruiterId = uuidv4();
  const sheetId = sheetUrl ? sheetUrl.match(/\/d\/([^/]+)/)?.[1] : null;

  await bigquery.dataset(DATASET_ID).table('recruiters').insert([{
    id: recruiterId,
    name: name.trim(),
    linkedin_url: null,
    company: company || null,
    title: title || null,
    frequency: frequency || '1st_3rd_week',
    output_sheet_url: sheetUrl || null,
    output_sheet_id: sheetId,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }]);

  return res.json({ success: true, recruiterId, created: true });
}

/**
 * Create a scrape run record
 */
async function createScrapeRun(data, res) {
  const { recruiterId, recruiterName, totalSearches } = data;
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayOfMonth = now.getDate();
  const weekOfMonth = Math.ceil(dayOfMonth / 7);
  
  // Get Monday of this week
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const scrapeWeek = monday.toISOString().split('T')[0];

  const scrapeRunId = uuidv4();

  await bigquery.dataset(DATASET_ID).table('scrape_runs').insert([{
    id: scrapeRunId,
    recruiter_id: recruiterId,
    recruiter_name: recruiterName,
    started_at: now.toISOString(),
    completed_at: null,
    status: 'running',
    profiles_scraped: 0,
    new_connections_found: 0,
    searches_completed: 0,
    total_searches: totalSearches || 9,
    error_message: null,
    scrape_week: scrapeWeek,
    week_of_month: weekOfMonth,
    created_at: now.toISOString()
  }]);

  return res.json({ success: true, scrapeRunId });
}

/**
 * Complete a scrape run
 */
async function completeScrapeRun(data, res) {
  const { scrapeRunId, profilesScraped, newConnections, searchesCompleted, status, error } = data;

  await bigquery.query({
    query: `
      UPDATE \`${PROJECT_ID}.${DATASET_ID}.scrape_runs\`
      SET 
        completed_at = CURRENT_TIMESTAMP(),
        status = @status,
        profiles_scraped = @profiles,
        new_connections_found = @newConns,
        searches_completed = @searches,
        error_message = @error
      WHERE id = @id
    `,
    params: {
      id: scrapeRunId,
      status: status || 'completed',
      profiles: profilesScraped || 0,
      newConns: newConnections || 0,
      searches: searchesCompleted || 0,
      error: error || null
    }
  });

  return res.json({ success: true });
}

/**
 * Bulk import recruiters from CSV data
 */
async function importRecruiters(data, res) {
  const { recruiters } = data;

  if (!recruiters || !Array.isArray(recruiters)) {
    return res.status(400).json({ success: false, error: 'recruiters array required' });
  }

  let imported = 0;
  let errors = 0;

  for (const rec of recruiters) {
    try {
      const name = rec.Name || rec.name;
      if (!name) continue;

      // Determine frequency from the CSV format
      let frequency = '1st_3rd_week';
      const freqRaw = rec.Frequency || rec.frequency || '';
      if (freqRaw.includes('2nd') || freqRaw.includes('4th')) {
        frequency = '2nd_4th_week';
      }

      const sheetUrl = rec.Sheet_URL || rec.sheet_url;
      const sheetId = sheetUrl ? sheetUrl.match(/\/d\/([^/]+)/)?.[1] : null;

      // Check if exists
      const [existing] = await bigquery.query({
        query: `SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` WHERE name = @name LIMIT 1`,
        params: { name: name.trim() }
      });

      if (existing.length > 0) {
        // Update existing
        await bigquery.query({
          query: `
            UPDATE \`${PROJECT_ID}.${DATASET_ID}.recruiters\`
            SET 
              company = @company,
              title = @title,
              frequency = @frequency,
              output_sheet_url = @sheetUrl,
              output_sheet_id = @sheetId,
              updated_at = CURRENT_TIMESTAMP()
            WHERE name = @name
          `,
          params: {
            name: name.trim(),
            company: rec.Company || null,
            title: rec.Title || null,
            frequency,
            sheetUrl: sheetUrl || null,
            sheetId
          }
        });
      } else {
        // Insert new
        await bigquery.dataset(DATASET_ID).table('recruiters').insert([{
          id: uuidv4(),
          name: name.trim(),
          linkedin_url: null,
          company: rec.Company || null,
          title: rec.Title || null,
          frequency,
          output_sheet_url: sheetUrl || null,
          output_sheet_id: sheetId,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);
      }

      imported++;
    } catch (err) {
      console.error('Recruiter import error:', err);
      errors++;
    }
  }

  return res.json({ success: true, imported, errors });
}
