/**
 * Savvy Pirate BigQuery Sync - Apps Script Web App
 * 
 * This replaces the Cloud Function and provides the same functionality.
 * Receives HTTP POST requests from the Chrome Extension and writes to BigQuery.
 * 
 * Version: 1.0.0
 * Compatible with: Implementation Guide v4.5+
 */

// ============================================================
// CONFIGURATION
// ============================================================

const PROJECT_ID = 'savvy-gtm-analytics';
const DATASET_ID = 'savvy_pirate';

// ============================================================
// WEB APP ENTRY POINTS
// ============================================================

/**
 * Handle GET requests (for testing connectivity)
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: 'Savvy Pirate BigQuery Sync is running',
      project: PROJECT_ID,
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests (main entry point for Chrome Extension)
 */
function doPost(e) {
  try {
    // Parse the incoming JSON
    const payload = JSON.parse(e.postData.contents);
    const { action, data } = payload;
    
    console.log(`[SYNC] Received action: ${action}`);
    console.log(`[SYNC] Data keys:`, data ? Object.keys(data) : 'no data');
    if (data && data.profiles) {
      console.log(`[SYNC] Profiles count:`, data.profiles.length);
      if (data.profiles.length > 0) {
        console.log(`[SYNC] First profile keys:`, Object.keys(data.profiles[0]));
        console.log(`[SYNC] First profile:`, JSON.stringify(data.profiles[0]).substring(0, 200));
      }
    }
    
    // Route to appropriate handler
    let result;
    switch (action) {
      case 'test_connection':
        result = testConnection();
        break;
      case 'sync_profiles':
        result = syncProfiles(data);
        break;
      case 'get_or_create_recruiter':
        result = getOrCreateRecruiter(data);
        break;
      case 'create_scrape_run':
        result = createScrapeRun(data);
        break;
      case 'complete_scrape_run':
        result = completeScrapeRun(data);
        break;
      case 'record_observation':
        result = recordObservation(data);
        break;
      case 'record_observations_batch':
        result = recordObservationsBatch(data);
        break;
      case 'sync_recruiters':
        result = syncRecruitersFromSheets(data);
        break;
      default:
        result = { success: false, error: `Unknown action: ${action}` };
    }
    
    // Log the result before returning
    console.log(`[SYNC] Result success:`, result.success);
    console.log(`[SYNC] Result keys:`, Object.keys(result));
    if (result.errorDetails) {
      console.log(`[SYNC] Error details count:`, result.errorDetails.length);
      console.log(`[SYNC] Error details:`, result.errorDetails);
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('[SYNC] Top-level error:', error);
    console.error('[SYNC] Error message:', error.message);
    console.error('[SYNC] Error stack:', error.stack);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message || error.toString(),
        errorStack: error.stack ? error.stack.toString() : null
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// TEST CONNECTION
// ============================================================

function testConnection() {
  try {
    // Try a simple BigQuery query to verify connection
    const query = 'SELECT 1 as test';
    BigQuery.Jobs.query({ query: query, useLegacySql: false }, PROJECT_ID);
    
    return {
      success: true,
      message: 'Connected to BigQuery',
      project: PROJECT_ID,
      dataset: DATASET_ID,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: `BigQuery connection failed: ${error.message}`
    };
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Generate a UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Normalize LinkedIn URL to standard format
 */
function normalizeLinkedInUrl(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? `https://www.linkedin.com/in/${match[1].toLowerCase()}` : url;
}

/**
 * Extract LinkedIn ID (slug) from URL
 */
function extractLinkedInId(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Escape single quotes for SQL
 */
function escapeSql(str) {
  if (!str) return null;
  // Escape single quotes (SQL standard: double them)
  // Also handle newlines and other control characters that could break SQL
  return String(str)
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/'/g, "''")      // Escape single quotes (SQL standard)
    .replace(/\n/g, ' ')      // Replace newlines with spaces
    .replace(/\r/g, ' ')      // Replace carriage returns with spaces
    .replace(/\t/g, ' ')      // Replace tabs with spaces
    .trim();                  // Remove leading/trailing whitespace
}

/**
 * Run a BigQuery query and return results
 */
function runQuery(sql, useLegacySql = false) {
  const request = {
    query: sql,
    useLegacySql: useLegacySql
  };
  
  const queryResults = BigQuery.Jobs.query(request, PROJECT_ID);
  
  if (queryResults.rows) {
    return queryResults.rows.map(row => {
      const obj = {};
      queryResults.schema.fields.forEach((field, i) => {
        obj[field.name] = row.f[i].v;
      });
      return obj;
    });
  }
  
  return [];
}

/**
 * Insert rows into a BigQuery table
 */
function insertRows(tableId, rows) {
  const insertRequest = {
    rows: rows.map(row => ({ json: row }))
  };
  
  try {
    BigQuery.Tabledata.insertAll(insertRequest, PROJECT_ID, DATASET_ID, tableId);
    return { success: true, inserted: rows.length };
  } catch (error) {
    console.error(`[INSERT] Error inserting into ${tableId}:`, error);
    throw error;
  }
}

/**
 * Run a DML query (UPDATE, DELETE)
 */
function runDML(sql) {
  const request = {
    query: sql,
    useLegacySql: false
  };
  
  const job = BigQuery.Jobs.query(request, PROJECT_ID);
  return job;
}

// ============================================================
// SYNC PROFILES
// ============================================================

function syncProfiles(data) {
  console.log('[SYNC] syncProfiles called with data:', JSON.stringify(data).substring(0, 500));
  const { profiles, recruiterId, recruiterName, searchType, scrapeRunId } = data;
  
  if (!profiles || !Array.isArray(profiles) || !recruiterId) {
    const errorMsg = `Invalid input: profiles=${!!profiles}, isArray=${Array.isArray(profiles)}, recruiterId=${!!recruiterId}`;
    console.error('[SYNC]', errorMsg);
    return { success: false, error: errorMsg };
  }
  
  console.log(`[SYNC] Processing ${profiles.length} profiles for recruiter ${recruiterId}`);
  
  const today = new Date().toISOString().split('T')[0];
  let synced = 0;
  let errors = 0;
  const errorDetails = [];
  const advisorIds = []; // Track advisor_ids for each synced profile
  
  for (let idx = 0; idx < profiles.length; idx++) {
    const profile = profiles[idx];
    try {
      console.log(`[SYNC] Processing profile ${idx + 1}/${profiles.length}: ${profile.name || 'unknown'}`);
      const linkedinUrl = normalizeLinkedInUrl(profile.linkedinUrl || profile.linkedin_url);
      const linkedinId = extractLinkedInId(profile.linkedinUrl || profile.linkedin_url);
      
      if (!linkedinUrl || !profile.name) {
        errors++;
        errorDetails.push(`Skipped: missing ${!linkedinUrl ? 'LinkedIn URL' : 'name'} for ${profile.name || 'unknown'}`);
        advisorIds.push(null); // Push null for skipped profiles to maintain array alignment
        continue;
      }
      
      // Check if advisor exists first (to avoid streaming buffer issues with MERGE updates)
      const escapedLinkedInUrl = escapeSql(linkedinUrl);
      const existingQuery = `
        SELECT id, created_at 
        FROM \`${PROJECT_ID}.${DATASET_ID}.advisors\` 
        WHERE linkedin_url = '${escapedLinkedInUrl}' 
        LIMIT 1
      `;
      console.log(`[SYNC] Checking for existing advisor: ${profile.name}, LinkedIn: ${linkedinUrl.substring(0, 50)}...`);
      const existing = runQuery(existingQuery);
      
      let actualAdvisorId;
      const now = new Date().toISOString();
      
      if (existing.length > 0) {
        // Advisor exists - use existing ID
        actualAdvisorId = existing[0].id;
        const createdTime = existing[0].created_at;
        const createdDate = new Date(createdTime);
        const nowDate = new Date();
        const minutesSinceCreation = (nowDate - createdDate) / (1000 * 60);
        
        // Only try to update if row is older than 90 minutes (streaming buffer should be flushed)
        // Otherwise, skip update to avoid streaming buffer error
        if (minutesSinceCreation > 90) {
          try {
            const escapedTitle = profile.title ? escapeSql(profile.title) : null;
            const escapedLocation = profile.location ? escapeSql(profile.location) : null;
            const updateSql = `
              UPDATE \`${PROJECT_ID}.${DATASET_ID}.advisors\` 
              SET last_seen_at = CURRENT_TIMESTAMP(), 
                  times_seen = times_seen + 1,
                  current_title = ${escapedTitle ? `'${escapedTitle}'` : 'current_title'},
                  current_location = ${escapedLocation ? `'${escapedLocation}'` : 'current_location'},
                  updated_at = CURRENT_TIMESTAMP()
              WHERE id = '${actualAdvisorId}'
            `;
            console.log(`[SYNC] Updating existing advisor (${minutesSinceCreation.toFixed(1)} min old): ${profile.name}`);
            runDML(updateSql);
          } catch (updateErr) {
            // If update fails (still in streaming buffer), that's OK - we have the ID
            console.log(`[SYNC] Update skipped (streaming buffer): ${profile.name}`);
          }
        } else {
          console.log(`[SYNC] Update skipped (recently created, ${minutesSinceCreation.toFixed(1)} min old): ${profile.name}`);
        }
      } else {
        // Advisor doesn't exist - create new one using streaming insert
        actualAdvisorId = generateUUID();
        const escapedName = escapeSql(profile.name);
        const escapedTitle = profile.title ? escapeSql(profile.title) : null;
        const escapedLocation = profile.location ? escapeSql(profile.location) : null;
        
        // Build accreditations array for insertRows
        const accreditationsArray = profile.accreditations && Array.isArray(profile.accreditations) && profile.accreditations.length > 0
          ? profile.accreditations.map(a => String(a || '').trim()).filter(a => a.length > 0)
          : [];
        
        console.log(`[SYNC] Creating new advisor: ${profile.name}`);
        insertRows('advisors', [{
          id: actualAdvisorId,
          linkedin_url: linkedinUrl,
          linkedin_id: linkedinId,
          name: profile.name,
          current_title: profile.title || null,
          current_location: profile.location || null,
          accreditations: accreditationsArray,
          first_seen_at: now,
          last_seen_at: now,
          times_seen: 1,
          created_at: now,
          updated_at: now
        }]);
      }
      
      // Check if connection exists first (to avoid streaming buffer issues)
      const connQuery = `
        SELECT id, created_at 
        FROM \`${PROJECT_ID}.${DATASET_ID}.connections\` 
        WHERE advisor_id = '${actualAdvisorId}' AND recruiter_id = '${recruiterId}' 
        LIMIT 1
      `;
      const existingConn = runQuery(connQuery);
      
      if (existingConn.length > 0) {
        // Connection exists - try to update if old enough, otherwise skip
        const connCreatedTime = existingConn[0].created_at;
        const connCreatedDate = new Date(connCreatedTime);
        const nowDate = new Date();
        const minutesSinceCreation = (nowDate - connCreatedDate) / (1000 * 60);
        
        if (minutesSinceCreation > 90) {
          try {
            const updateConnSql = `
              UPDATE \`${PROJECT_ID}.${DATASET_ID}.connections\`
              SET last_seen_date = DATE('${today}')
              WHERE advisor_id = '${actualAdvisorId}' AND recruiter_id = '${recruiterId}'
            `;
            console.log(`[SYNC] Updating existing connection (${minutesSinceCreation.toFixed(1)} min old)`);
            runDML(updateConnSql);
          } catch (updateErr) {
            // If update fails (still in streaming buffer), that's OK
            console.log(`[SYNC] Connection update skipped (streaming buffer)`);
          }
        } else {
          console.log(`[SYNC] Connection update skipped (recently created, ${minutesSinceCreation.toFixed(1)} min old)`);
        }
      } else {
        // Connection doesn't exist - create new one using streaming insert
        const connectionId = generateUUID();
        console.log(`[SYNC] Creating new connection for advisor ${actualAdvisorId} and recruiter ${recruiterId}`);
        insertRows('connections', [{
          id: connectionId,
          advisor_id: actualAdvisorId,
          recruiter_id: recruiterId,
          first_seen_date: today,
          last_seen_date: today,
          search_type: searchType || null,
          scrape_run_id: scrapeRunId || null,
          created_at: new Date().toISOString()
        }]);
      }
      
      advisorIds.push(actualAdvisorId); // Store advisor_id for this profile
      synced++;
      console.log(`[SYNC] ✅ Successfully synced profile ${idx + 1}: ${profile.name} (advisor_id: ${actualAdvisorId})`);
    } catch (err) {
      console.error(`[SYNC] ❌ Profile ${idx + 1} sync error:`, err);
      console.error(`[SYNC] Error message:`, err.message);
      console.error(`[SYNC] Error stack:`, err.stack);
      errors++;
      const errorMsg = `Error syncing ${profile.name || 'unknown'}: ${err.message || err.toString()}`;
      errorDetails.push(errorMsg);
      advisorIds.push(null); // Push null for errored profiles
    }
  }
  
  console.log(`[SYNC] Completed processing: ${synced} synced, ${errors} errors`);
  
  // Build result - ALWAYS include errorDetails
  // Also include advisorIds array so observations can use them
  const result = { 
    success: errors < profiles.length, // Success if at least one profile synced
    synced, 
    errors, 
    total: profiles.length,
    advisorIds: advisorIds, // Return advisor_ids for each profile (aligned with profiles array)
    errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 20) : [], // ALWAYS include errorDetails
    _debug: {
      errorDetailsArrayLength: errorDetails.length,
      errorDetailsArray: errorDetails,
      advisorIdsLength: advisorIds.length
    }
  };
  
  // If errors occurred but errorDetails is empty, add a debug message
  if (errors > 0 && errorDetails.length === 0) {
    result.errorDetails = [`DEBUG: ${errors} errors occurred but errorDetails array is empty. This suggests exceptions were caught at a higher level.`];
  }
  
  // Log everything for debugging
  console.log('[SYNC] === FINAL RESULT ===');
  console.log('[SYNC] synced:', synced, 'errors:', errors, 'total:', profiles.length);
  console.log('[SYNC] advisorIds.length:', advisorIds.length);
  console.log('[SYNC] advisorIds (first 3):', advisorIds.slice(0, 3));
  console.log('[SYNC] errorDetails.length:', errorDetails.length);
  console.log('[SYNC] errorDetails (first 5):', errorDetails.slice(0, 5));
  console.log('[SYNC] result.errorDetails:', result.errorDetails);
  console.log('[SYNC] result.advisorIds:', result.advisorIds ? `Array of ${result.advisorIds.length} items` : 'NOT SET');
  console.log('[SYNC] Full result keys:', Object.keys(result));
  
  return result;
}

// ============================================================
// GET OR CREATE RECRUITER
// ============================================================

function getOrCreateRecruiter(data) {
  const { name, frequency, company, title, sheetUrl } = data;
  
  if (!name) {
    return { success: false, error: 'name required' };
  }
  
  const trimmedName = name.trim();
  const escapedName = escapeSql(trimmedName);
  
  const existingQuery = `
    SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` 
    WHERE name = '${escapedName}' 
    LIMIT 1
  `;
  const existing = runQuery(existingQuery);
  
  if (existing.length > 0) {
    return { success: true, recruiterId: existing[0].id, created: false };
  }
  
  const recruiterId = generateUUID();
  const sheetId = sheetUrl ? (sheetUrl.match(/\/d\/([^/]+)/) || [])[1] : null;
  const now = new Date().toISOString();
  
  insertRows('recruiters', [{
    id: recruiterId,
    name: trimmedName,
    linkedin_url: null,
    company: company || null,
    title: title || null,
    frequency: frequency || '1st_3rd_week',
    output_sheet_url: sheetUrl || null,
    output_sheet_id: sheetId || null,
    is_active: true,
    created_at: now,
    updated_at: now
  }]);
  
  return { success: true, recruiterId, created: true };
}

// ============================================================
// CREATE SCRAPE RUN
// ============================================================

function createScrapeRun(data) {
  const { recruiterId, recruiterName, totalSearches } = data;
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayOfMonth = now.getDate();
  const weekOfMonth = Math.ceil(dayOfMonth / 7);
  
  // Calculate Monday of current week
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const scrapeWeek = monday.toISOString().split('T')[0];
  
  const scrapeRunId = generateUUID();
  
  insertRows('scrape_runs', [{
    id: scrapeRunId,
    recruiter_id: recruiterId,
    recruiter_name: recruiterName || null,
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
  
  return { success: true, scrapeRunId };
}

// ============================================================
// COMPLETE SCRAPE RUN
// ============================================================

function completeScrapeRun(data) {
  const { scrapeRunId, profilesScraped, newConnections, searchesCompleted, status, error } = data;
  
  const errorSql = error ? `'${escapeSql(error)}'` : 'NULL';
  const updateSql = `
    UPDATE \`${PROJECT_ID}.${DATASET_ID}.scrape_runs\`
    SET completed_at = CURRENT_TIMESTAMP(),
        status = '${status || 'completed'}',
        profiles_scraped = ${profilesScraped || 0},
        new_connections_found = ${newConnections || 0},
        searches_completed = ${searchesCompleted || 0},
        error_message = ${errorSql}
    WHERE id = '${scrapeRunId}'
  `;
  runDML(updateSql);
  
  return { success: true };
}

// ============================================================
// RECORD OBSERVATION (Point-in-Time Storage)
// ============================================================

function recordObservation(data) {
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
  
  const observationId = `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  insertRows('connection_observations', [{
    id: observationId,
    scrape_run_id: scrape_run_id || null,
    recruiter_id: recruiter_id,
    advisor_id: advisor_id,
    search_id: search_id || null,
    observed_at: new Date().toISOString(),
    advisor_name: advisor_name || null,
    advisor_title: advisor_title || null,
    advisor_location: advisor_location || null,
    advisor_linkedin_url: advisor_linkedin_url || null,
    search_job_title: search_job_title || null,
    created_at: new Date().toISOString()
  }]);
  
  return { 
    success: true, 
    observation_id: observationId,
    message: 'Observation recorded'
  };
}

// ============================================================
// RECORD OBSERVATIONS BATCH
// ============================================================

function recordObservationsBatch(data) {
  const { scrape_run_id, recruiter_id, search_id, search_job_title, profiles, advisorIds } = data;
  
  if (!profiles || profiles.length === 0) {
    return { success: true, recorded: 0, message: 'No profiles to record' };
  }
  
  console.log(`[OBSERVATION] Recording ${profiles.length} observations for recruiter ${recruiter_id}`);
  console.log(`[OBSERVATION] Received ${advisorIds ? advisorIds.length : 0} advisor_ids from sync`);
  if (advisorIds && advisorIds.length > 0) {
    console.log(`[OBSERVATION] First 3 advisor_ids:`, advisorIds.slice(0, 3));
  } else {
    console.log(`[OBSERVATION] ⚠️ No advisorIds provided - will use fallback lookup`);
  }
  
  const now = new Date().toISOString();
  const rows = [];
  
  // Process each profile - use advisor_id from sync result if available
  for (let idx = 0; idx < profiles.length; idx++) {
    const profile = profiles[idx];
    
    // PREFERRED: Use advisor_id from sync result (most reliable - no lookup needed)
    let advisorId = advisorIds && advisorIds[idx] ? advisorIds[idx] : null;
    
    if (advisorId) {
      console.log(`[OBSERVATION] ✅ Using advisor_id from sync result: ${advisorId} for ${profile.name || 'unknown'}`);
    }
    
    // FALLBACK: If not provided, try to look it up (for backward compatibility)
    if (!advisorId && profile.advisor_id) {
      advisorId = profile.advisor_id;
    }
    
    // STRATEGY 2: Look up by linkedin_id (slug) - MORE RELIABLE than full URL
    // This is the normalized slug that's stored in advisors.linkedin_id
    if (!advisorId && profile.linkedin_url) {
      const linkedinId = extractLinkedInId(profile.linkedin_url);
      console.log(`[OBSERVATION] Attempting linkedin_id lookup for ${profile.name || 'unknown'}: linkedin_id="${linkedinId}"`);
      if (linkedinId) {
        const lookupQuery = `
          SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.advisors\` 
          WHERE linkedin_id = '${escapeSql(linkedinId)}' 
          LIMIT 1
        `;
        console.log(`[OBSERVATION] Running lookup query: ${lookupQuery.substring(0, 100)}...`);
        const existing = runQuery(lookupQuery);
        console.log(`[OBSERVATION] Lookup returned ${existing.length} results`);
        if (existing.length > 0) {
          advisorId = existing[0].id;
          console.log(`[OBSERVATION] ✅ Found advisor_id via linkedin_id lookup: ${advisorId} for ${profile.name || 'unknown'}`);
        } else {
          console.log(`[OBSERVATION] ⚠️ No advisor found for linkedin_id: ${linkedinId}`);
        }
      } else {
        console.log(`[OBSERVATION] ⚠️ Could not extract linkedin_id from URL: ${profile.linkedin_url}`);
      }
    }
    
    // STRATEGY 3: Fallback to full URL lookup with variations (if linkedin_id didn't work)
    if (!advisorId && profile.linkedin_url) {
      const linkedinUrl = normalizeLinkedInUrl(profile.linkedin_url);
      if (linkedinUrl) {
        // Try exact URL match first
        let existingQuery = `
          SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.advisors\` 
          WHERE linkedin_url = '${escapeSql(linkedinUrl)}' 
          LIMIT 1
        `;
        let existing = runQuery(existingQuery);
        
        // If no exact match, try with/without trailing slash
        if (existing.length === 0) {
          const urlVariations = [];
          if (linkedinUrl.endsWith('/')) {
            urlVariations.push(linkedinUrl.slice(0, -1));
          } else {
            urlVariations.push(linkedinUrl + '/');
          }
          
          for (const urlVar of urlVariations) {
            existingQuery = `
              SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.advisors\` 
              WHERE linkedin_url = '${escapeSql(urlVar)}' 
              LIMIT 1
            `;
            existing = runQuery(existingQuery);
            if (existing.length > 0) break;
          }
        }
        
        if (existing.length > 0) {
          advisorId = existing[0].id;
          console.log(`[OBSERVATION] ✅ Found advisor_id via URL lookup: ${advisorId} for ${profile.name || 'unknown'}`);
        } else {
          console.log(`[OBSERVATION] ⚠️ No advisor found for LinkedIn URL: ${linkedinUrl.substring(0, 50)}...`);
        }
      }
    }
    
    rows.push({
      id: `obs_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
      scrape_run_id: scrape_run_id || null,
      recruiter_id: recruiter_id,
      advisor_id: advisorId || null,
      search_id: search_id || null,
      observed_at: now,
      advisor_name: profile.name || null,
      advisor_title: profile.title || null,
      advisor_location: profile.location || null,
      advisor_linkedin_url: profile.linkedin_url || null,
      search_job_title: search_job_title || null,
      created_at: now
    });
  }
  
  try {
    insertRows('connection_observations', rows);
    console.log(`[OBSERVATION] Successfully recorded ${rows.length} observations`);
    
    return { 
      success: true, 
      recorded: rows.length,
      message: `Recorded ${rows.length} observations`
    };
  } catch (error) {
    console.error('[OBSERVATION] Batch error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// SYNC RECRUITERS FROM SHEETS (Optional)
// ============================================================

function syncRecruitersFromSheets(data) {
  // This can be called to sync recruiters from Command & Control sheet
  // Implementation depends on your specific sheet structure
  return { 
    success: true, 
    message: 'Recruiter sync via Apps Script not yet implemented - use BigQuery scheduled query instead'
  };
}

