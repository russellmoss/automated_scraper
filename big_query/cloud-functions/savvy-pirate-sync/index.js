// cloud-functions/savvy-pirate-sync/index.js
// Google Cloud Function to receive scraped data and insert into BigQuery
// Deploy with: gcloud functions deploy savvy-pirate-sync --runtime nodejs18 --trigger-http --allow-unauthenticated

const { BigQuery } = require('@google-cloud/bigquery');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

const bigquery = new BigQuery();
const DATASET_ID = 'savvy_pirate';
const PROJECT_ID = process.env.GCP_PROJECT || 'savvy-gtm-analytics';

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
      
      case 'sync_recruiters':
        return await syncRecruitersFromSheets(data, res);
      
      case 'record_observation':
        return await recordObservation(data, res);
      
      case 'record_observations_batch':
        return await recordObservationsBatch(data, res);
      
      case 'test_connection':
        return res.json({ success: true, message: 'Connected to BigQuery', project: PROJECT_ID });
      
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

// ============================================================
// GOOGLE SHEETS → BIGQUERY SYNC
// ============================================================

/**
 * Sync recruiters from Google Sheets Command & Control to BigQuery
 * This should be called whenever recruiters are added/edited/removed in Sheets
 */
async function syncRecruitersFromSheets(data, res) {
    const { spreadsheetId, sheetName } = data;
    
    // Command & Control sheet ID from configuration constants
    const SHEET_ID = spreadsheetId || '1AY2X6U9Hjg7b3hP3qpVM3eyHQ2fLq8pqREVj4NpGDeM';
    const SHEET_NAME = sheetName || 'Mapping and Schedules';
    
    console.log(`[SYNC] Starting recruiter sync from sheet: ${SHEET_ID}`);
    
    try {
        // Authenticate with Google Sheets API using default credentials
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
        });
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Read the sheet data
        // Columns: Name, Sheet_URL, Title, Company, Day, Day of Week, Time (24hr), Frequency
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `'${SHEET_NAME}'!A:H`
        });
        
        const rows = response.data.values;
        if (!rows || rows.length < 2) {
            console.log('[SYNC] No data found in sheet');
            return res.json({ success: false, error: 'No data found in sheet' });
        }
        
        console.log(`[SYNC] Found ${rows.length - 1} rows in sheet`);
        
        // Parse recruiters from sheet (skip header row)
        const recruitersFromSheet = rows.slice(1).map(row => ({
            name: (row[0] || '').trim(),
            sheet_url: (row[1] || '').trim(),
            title: (row[2] || '').trim(),
            company: (row[3] || '').trim(),
            // Parse frequency - look for "1st" to determine group
            frequency: (row[7] || '').toLowerCase().includes('1st') ? '1st_3rd_week' : '2nd_4th_week'
        })).filter(r => r.name);  // Skip empty rows
        
        console.log(`[SYNC] Parsed ${recruitersFromSheet.length} valid recruiters`);
        
        // Get existing recruiter names from BigQuery
        const [existingRows] = await bigquery.query({
            query: `SELECT name FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` WHERE is_active = TRUE`
        });
        const existingNames = new Set(existingRows.map(r => r.name.toLowerCase()));
        const sheetNames = new Set(recruitersFromSheet.map(r => r.name.toLowerCase()));
        
        // Track stats
        let added = 0, updated = 0, deactivated = 0;
        
        // Upsert each recruiter from the sheet
        for (const rec of recruitersFromSheet) {
            // Generate deterministic ID (same as seed data)
            const id = 'rec_' + Buffer.from(rec.name.toLowerCase()).toString('hex').substring(0, 32);
            
            // Extract sheet ID from URL
            const sheetIdMatch = rec.sheet_url.match(/\/d\/([^/]+)/);
            const sheetId = sheetIdMatch ? sheetIdMatch[1] : null;
            
            const isNew = !existingNames.has(rec.name.toLowerCase());
            
            await bigquery.query({
                query: `
                    MERGE INTO \`${PROJECT_ID}.${DATASET_ID}.recruiters\` AS target
                    USING (
                        SELECT 
                            @id as id, 
                            @name as name, 
                            @company as company, 
                            @title as title, 
                            @frequency as frequency, 
                            @sheet_url as output_sheet_url,
                            @sheet_id as output_sheet_id
                    ) AS source
                    ON target.name = source.name
                    WHEN MATCHED THEN
                        UPDATE SET 
                            company = source.company,
                            title = source.title,
                            frequency = source.frequency,
                            output_sheet_url = source.output_sheet_url,
                            output_sheet_id = source.output_sheet_id,
                            is_active = TRUE,
                            updated_at = CURRENT_TIMESTAMP()
                    WHEN NOT MATCHED THEN
                        INSERT (id, name, company, title, frequency, output_sheet_url, output_sheet_id, is_active, created_at, updated_at)
                        VALUES (source.id, source.name, source.company, source.title, source.frequency, 
                                source.output_sheet_url, source.output_sheet_id, TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
                `,
                params: {
                    id: id,
                    name: rec.name,
                    company: rec.company || null,
                    title: rec.title || null,
                    frequency: rec.frequency,
                    sheet_url: rec.sheet_url || null,
                    sheet_id: sheetId
                }
            });
            
            if (isNew) added++;
            else updated++;
        }
        
        // Soft-delete recruiters that are no longer in the sheet
        for (const existingName of existingNames) {
            if (!sheetNames.has(existingName)) {
                await bigquery.query({
                    query: `
                        UPDATE \`${PROJECT_ID}.${DATASET_ID}.recruiters\`
                        SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP()
                        WHERE LOWER(name) = @name AND is_active = TRUE
                    `,
                    params: { name: existingName }
                });
                deactivated++;
                console.log(`[SYNC] Deactivated recruiter: ${existingName}`);
            }
        }
        
        // Regenerate searches for all active recruiters
        console.log('[SYNC] Regenerating searches table...');
        await bigquery.query({
            query: `
                MERGE INTO \`${PROJECT_ID}.${DATASET_ID}.searches\` AS target
                USING (
                    WITH job_titles AS (
                        SELECT title FROM UNNEST([
                            'Financial Advisor', 'Financial Consultant', 'Financial Planner',
                            'Investment Advisor', 'Partner', 'Portfolio Manager',
                            'Principal', 'Wealth Advisor', 'Wealth Manager'
                        ]) AS title
                    )
                    SELECT 
                        CONCAT('srch_', TO_HEX(MD5(CONCAT(LOWER(r.name), '_', LOWER(jt.title))))) AS id,
                        r.id AS recruiter_id,
                        r.name AS recruiter_name,
                        jt.title AS target_job_title,
                        CONCAT(
                            'https://www.linkedin.com/search/results/people/?connectionOf=[%22',
                            r.id, '%22]&titleFreeText=%22', 
                            REPLACE(jt.title, ' ', '%20'),
                            '%22&origin=FACETED_SEARCH'
                        ) AS linkedin_search_url,
                        r.is_active
                    FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` r
                    CROSS JOIN job_titles jt
                ) AS source
                ON target.id = source.id
                WHEN MATCHED THEN
                    UPDATE SET 
                        is_active = source.is_active,
                        recruiter_name = source.recruiter_name
                WHEN NOT MATCHED THEN
                    INSERT (id, recruiter_id, recruiter_name, target_job_title, linkedin_search_url, is_active, created_at)
                    VALUES (source.id, source.recruiter_id, source.recruiter_name, source.target_job_title, 
                            source.linkedin_search_url, source.is_active, CURRENT_TIMESTAMP())
            `
        });
        
        // Get final counts for verification
        const [countResult] = await bigquery.query({
            query: `
                SELECT 
                    (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` WHERE is_active = TRUE) as active_recruiters,
                    (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET_ID}.searches\` WHERE is_active = TRUE) as active_searches
            `
        });
        
        const result = {
            success: true,
            added: added,
            updated: updated,
            deactivated: deactivated,
            total_active_recruiters: countResult[0].active_recruiters,
            total_active_searches: countResult[0].active_searches,
            message: `Sync complete: ${added} added, ${updated} updated, ${deactivated} deactivated`
        };
        
        console.log('[SYNC] Complete:', result);
        return res.json(result);
        
    } catch (error) {
        console.error('[SYNC] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ============================================================
// RECORD OBSERVATION (Point-in-Time Storage)
// ============================================================

/**
 * Records an observation from a scrape - APPEND ONLY
 * This creates a permanent record of every profile seen in every scrape
 */
async function recordObservation(data, res) {
    const { 
        scrape_run_id, 
        recruiter_id, 
        advisor_id, 
        search_id,
        advisor_name,
        advisor_title,
        advisor_location,
        advisor_linkedin_url,
        search_job_title
    } = data;
    
    // Generate unique observation ID
    const observation_id = `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        await bigquery.query({
            query: `
                INSERT INTO \`${PROJECT_ID}.${DATASET_ID}.connection_observations\`
                (id, scrape_run_id, recruiter_id, advisor_id, search_id, 
                 observed_at, advisor_name, advisor_title, advisor_location, 
                 advisor_linkedin_url, search_job_title)
                VALUES
                (@id, @scrape_run_id, @recruiter_id, @advisor_id, @search_id,
                 CURRENT_TIMESTAMP(), @advisor_name, @advisor_title, @advisor_location,
                 @advisor_linkedin_url, @search_job_title)
            `,
            params: {
                id: observation_id,
                scrape_run_id: scrape_run_id,
                recruiter_id: recruiter_id,
                advisor_id: advisor_id,
                search_id: search_id || null,
                advisor_name: advisor_name || null,
                advisor_title: advisor_title || null,
                advisor_location: advisor_location || null,
                advisor_linkedin_url: advisor_linkedin_url || null,
                search_job_title: search_job_title || null
            }
        });
        
        return res.json({ 
            success: true, 
            observation_id: observation_id,
            message: 'Observation recorded'
        });
        
    } catch (error) {
        console.error('[OBSERVATION] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Batch record multiple observations at once (more efficient)
 */
async function recordObservationsBatch(data, res) {
    const { scrape_run_id, recruiter_id, search_id, search_job_title, profiles } = data;
    
    if (!profiles || profiles.length === 0) {
        return res.json({ success: true, recorded: 0, message: 'No profiles to record' });
    }
    
    console.log(`[OBSERVATION] Recording ${profiles.length} observations for recruiter ${recruiter_id}`);
    
    try {
        // Build batch insert
        const rows = profiles.map((profile, idx) => ({
            id: `obs_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
            scrape_run_id: scrape_run_id,
            recruiter_id: recruiter_id,
            advisor_id: profile.advisor_id || `adv_${Buffer.from(profile.linkedin_url || profile.name).toString('hex').substring(0, 32)}`,
            search_id: search_id || null,
            observed_at: new Date().toISOString(),
            advisor_name: profile.name || null,
            advisor_title: profile.title || null,
            advisor_location: profile.location || null,
            advisor_linkedin_url: profile.linkedin_url || null,
            search_job_title: search_job_title || null
        }));
        
        // Insert all rows
        await bigquery
            .dataset(DATASET_ID)
            .table('connection_observations')
            .insert(rows);
        
        console.log(`[OBSERVATION] Successfully recorded ${rows.length} observations`);
        
        return res.json({ 
            success: true, 
            recorded: rows.length,
            message: `Recorded ${rows.length} observations`
        });
        
    } catch (error) {
        console.error('[OBSERVATION] Batch error:', error);
        
        // BigQuery insert errors have a different structure
        if (error.name === 'PartialFailureError') {
            const failedRows = error.errors.length;
            const successRows = profiles.length - failedRows;
            return res.json({ 
                success: true, 
                recorded: successRows,
                failed: failedRows,
                message: `Recorded ${successRows}/${profiles.length} observations`
            });
        }
        
        return res.status(500).json({ success: false, error: error.message });
    }
}
