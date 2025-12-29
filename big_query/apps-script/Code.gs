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
      case 'test_sheets_access':
        result = testSheetsAccess();
        break;
      case 'read_all_sheets':
        result = readAllSheetsFromSpreadsheet(data.spreadsheetId, data.includeHeaders !== false);
        break;
      case 'read_sheet':
        result = readSheetFromSpreadsheet(data.spreadsheetId, data.sheetName, data.includeHeaders !== false);
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
    advisor_linkedin_url: normalizeLinkedInUrl(advisor_linkedin_url) || null,  // ✅ FIXED: Now normalized
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
      advisor_linkedin_url: normalizeLinkedInUrl(profile.linkedin_url) || null,  // ✅ FIXED: Now normalized
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

// ============================================================
// GOOGLE SHEETS ACCESS TESTING
// ============================================================

/**
 * Helper function to run testSheetsAccess and display results
 * Use this in Apps Script console to see formatted output
 */
function runTestSheetsAccess() {
  const result = testSheetsAccess();
  Logger.log('\n=== TEST SHEETS ACCESS RESULTS ===');
  Logger.log(`Total tested: ${result.totalTested}`);
  Logger.log(`✅ Accessible: ${result.accessible}`);
  Logger.log(`❌ Errors: ${result.errors}`);
  Logger.log('\n=== DETAILED RESULTS ===');
  result.results.forEach(r => {
    if (r.status === '✅ ACCESSIBLE') {
      Logger.log(`✅ ${r.recruiter}: ${r.sheetCount} sheets, ${r.headerCount} columns`);
    } else {
      Logger.log(`❌ ${r.recruiter}: ${r.error}`);
    }
  });
  return result;
}

/**
 * Test reading all sheets from Megan Bailey's spreadsheet (for testing)
 * Can be run directly from function dropdown
 */
function testReadAllSheets() {
  const spreadsheetId = '1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE'; // Megan Bailey
  return readAllSheetsFromSpreadsheet(spreadsheetId, true);
}

/**
 * Test reading a specific sheet (for testing)
 * Can be run directly from function dropdown
 */
function testReadSheet() {
  const spreadsheetId = '1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE'; // Megan Bailey
  const sheetName = '12_28_25'; // Most recent sheet
  return readSheetFromSpreadsheet(spreadsheetId, sheetName, true);
}

/**
 * Test access to multiple Google Sheets
 * Can be called via POST action: 'test_sheets_access'
 * Or run directly in Apps Script console
 */
function testSheetsAccess() {
  Logger.log('Starting testSheetsAccess...');
  
  // Get all recruiters with sheet URLs (extract ID from URL if needed)
  const recruiterQuery = `
    SELECT name, output_sheet_id, output_sheet_url
    FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\`
    WHERE output_sheet_url IS NOT NULL
    ORDER BY name
  `;
  
  Logger.log('Querying BigQuery for recruiters with sheet URLs...');
  const recruiters = runQuery(recruiterQuery);
  Logger.log(`Found ${recruiters.length} recruiters with sheet URLs in BigQuery`);
  
  // Extract sheet ID from URL if not already stored
  recruiters.forEach(recruiter => {
    if (!recruiter.output_sheet_id && recruiter.output_sheet_url) {
      // Extract sheet ID from URL: https://docs.google.com/spreadsheets/d/SHEET_ID/...
      const match = recruiter.output_sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match) {
        recruiter.output_sheet_id = match[1];
      }
    }
  });
  
  // Also test the hardcoded examples
  const testSheets = [
    { id: '1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE', name: 'Megan Bailey (test)' },
    { id: '1gzhH8o_VYjnD2bsIbW9oj9Qsl7bxmmJgNzJi6xU5Vjc', name: 'Patrick Kelly (test)' },
    { id: '1X6GMt_tsdoO2bc2Az28VI6z8umOyJuUM5s2gfvHgQY8', name: 'Taylor Newman (test)' },
  ];
  
  const results = [];
  
  // Test sheets from BigQuery
  recruiters.forEach(recruiter => {
    const sheetId = recruiter.output_sheet_id;
    if (!sheetId) {
      Logger.log(`⚠️ ${recruiter.name}: No sheet ID available (URL: ${recruiter.output_sheet_url || 'none'})`);
      results.push({
        recruiter: recruiter.name,
        sheetId: null,
        status: '⚠️ NO SHEET ID',
        error: 'Could not extract sheet ID from URL'
      });
      return;
    }
    
    try {
      const ss = SpreadsheetApp.openById(sheetId);
      const sheets = ss.getSheets().map(s => s.getName());
      const firstSheet = ss.getSheets()[0];
      const headers = firstSheet ? firstSheet.getRange(1, 1, 1, 12).getValues()[0] : [];
      
      const result = {
        recruiter: recruiter.name,
        sheetId: sheetId,
        status: '✅ ACCESSIBLE',
        sheetCount: sheets.length,
        sheetNames: sheets,
        headers: headers,
        headerCount: headers.length
      };
      
      Logger.log(`✅ ${recruiter.name}: ${sheets.length} sheets - ${sheets.join(', ')}`);
      results.push(result);
    } catch (e) {
      const result = {
        recruiter: recruiter.name,
        sheetId: sheetId,
        status: '❌ ERROR',
        error: e.message
      };
      Logger.log(`❌ ${recruiter.name}: ${e.message}`);
      results.push(result);
    }
  });
  
  // Test hardcoded examples
  testSheets.forEach(test => {
    try {
      const ss = SpreadsheetApp.openById(test.id);
      const sheets = ss.getSheets().map(s => s.getName());
      const firstSheet = ss.getSheets()[0];
      const headers = firstSheet ? firstSheet.getRange(1, 1, 1, 12).getValues()[0] : [];
      
      const result = {
        recruiter: test.name,
        sheetId: test.id,
        status: '✅ ACCESSIBLE',
        sheetCount: sheets.length,
        sheetNames: sheets,
        headers: headers,
        headerCount: headers.length
      };
      
      Logger.log(`✅ ${test.name}: ${sheets.length} sheets - ${sheets.join(', ')}`);
      results.push(result);
    } catch (e) {
      const result = {
        recruiter: test.name,
        sheetId: test.id,
        status: '❌ ERROR',
        error: e.message
      };
      Logger.log(`❌ ${test.name}: ${e.message}`);
      results.push(result);
    }
  });
  
  const summary = {
    success: true,
    totalTested: results.length,
    accessible: results.filter(r => r.status === '✅ ACCESSIBLE').length,
    errors: results.filter(r => r.status === '❌ ERROR').length,
    results: results
  };
  
  Logger.log(`\n=== SUMMARY ===`);
  Logger.log(`Total tested: ${summary.totalTested}`);
  Logger.log(`✅ Accessible: ${summary.accessible}`);
  Logger.log(`❌ Errors: ${summary.errors}`);
  
  return summary;
}

/**
 * Read all sheets from a given spreadsheet ID
 * Returns data from all tabs in the spreadsheet
 * 
 * @param {string} spreadsheetId - Google Sheets ID
 * @param {boolean} includeHeaders - Whether to include header row (default: true)
 * @returns {Object} Object with sheet names as keys and data arrays as values
 */
function readAllSheetsFromSpreadsheet(spreadsheetId, includeHeaders = true) {
  if (!spreadsheetId) {
    Logger.log('❌ Error: spreadsheetId is required');
    return {
      success: false,
      error: 'spreadsheetId is required'
    };
  }
  
  Logger.log(`Reading all sheets from spreadsheet: ${spreadsheetId}`);
  
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheets = ss.getSheets();
    Logger.log(`Found ${sheets.length} sheets in "${ss.getName()}"`);
    
    const result = {
      success: true,
      spreadsheetName: ss.getName(),
      spreadsheetId: spreadsheetId,
      sheetCount: sheets.length,
      sheets: {}
    };
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      
      Logger.log(`  Processing sheet "${sheetName}": ${lastRow} rows × ${lastCol} cols`);
      
      if (lastRow === 0 || lastCol === 0) {
        Logger.log(`    ⚠️ Sheet "${sheetName}" is empty`);
        result.sheets[sheetName] = {
          rowCount: 0,
          columnCount: 0,
          headers: [],
          data: []
        };
        return;
      }
      
      // Get all data
      const range = sheet.getRange(1, 1, lastRow, lastCol);
      const values = range.getValues();
      
      // Extract headers (first row)
      const headers = values[0] || [];
      
      // Extract data (skip header row if includeHeaders is false)
      const data = includeHeaders ? values : values.slice(1);
      
      const formatCheck = {
        hasDate: headers[0] && headers[0].toString().toLowerCase().includes('date'),
        hasName: headers[1] && headers[1].toString().toLowerCase().includes('name'),
        hasTitle: headers[2] && headers[2].toString().toLowerCase().includes('title'),
        hasLocation: headers[3] && headers[3].toString().toLowerCase().includes('location'),
        hasSource: headers[4] && headers[4].toString().toLowerCase().includes('source'),
        hasLinkedIn: headers[5] && headers[5].toString().toLowerCase().includes('linkedin'),
        hasAccreds: headers.length >= 6
      };
      
      Logger.log(`    Headers: ${headers.slice(0, 6).join(', ')}...`);
      Logger.log(`    Format check: ${JSON.stringify(formatCheck)}`);
      
      result.sheets[sheetName] = {
        rowCount: lastRow,
        columnCount: lastCol,
        headers: headers,
        data: data,
        expectedFormat: formatCheck
      };
    });
    
    Logger.log(`✅ Successfully read ${sheets.length} sheets`);
    return result;
    
  } catch (error) {
    Logger.log(`❌ Error reading spreadsheet: ${error.message}`);
    return {
      success: false,
      error: error.message,
      spreadsheetId: spreadsheetId
    };
  }
}

/**
 * Read a specific sheet tab from a spreadsheet
 * 
 * @param {string} spreadsheetId - Google Sheets ID
 * @param {string} sheetName - Name of the sheet tab (default: first sheet)
 * @param {boolean} includeHeaders - Whether to include header row (default: true)
 * @returns {Object} Sheet data
 */
function readSheetFromSpreadsheet(spreadsheetId, sheetName = null, includeHeaders = true) {
  if (!spreadsheetId) {
    Logger.log('❌ Error: spreadsheetId is required');
    return {
      success: false,
      error: 'spreadsheetId is required'
    };
  }
  
  Logger.log(`Reading sheet from spreadsheet: ${spreadsheetId}${sheetName ? `, sheet: "${sheetName}"` : ' (first sheet)'}`);
  
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    Logger.log(`Opened spreadsheet: "${ss.getName()}"`);
    
    const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
    
    if (!sheet) {
      Logger.log(`❌ Sheet "${sheetName || 'first sheet'}" not found`);
      return {
        success: false,
        error: sheetName ? `Sheet "${sheetName}" not found` : 'No sheets found',
        spreadsheetId: spreadsheetId
      };
    }
    
    Logger.log(`Reading sheet: "${sheet.getName()}"`);
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    Logger.log(`Sheet dimensions: ${lastRow} rows × ${lastCol} cols`);
    
    if (lastRow === 0 || lastCol === 0) {
      Logger.log(`⚠️ Sheet is empty`);
      return {
        success: true,
        spreadsheetId: spreadsheetId,
        sheetName: sheet.getName(),
        rowCount: 0,
        columnCount: 0,
        headers: [],
        data: []
      };
    }
    
    // Get all data
    const range = sheet.getRange(1, 1, lastRow, lastCol);
    const values = range.getValues();
    
    // Extract headers (first row)
    const headers = values[0] || [];
    
    // Extract data (skip header row if includeHeaders is false)
    const data = includeHeaders ? values : values.slice(1);
    
    const formatCheck = {
      expectedColumns: ['Date', 'Name', 'Title', 'Location', 'Connection Source', 'LinkedIn URL', 'Accreditation 1', 'Accreditation 2', 'Accreditation 3', 'Accreditation 4', 'Accreditation 5', 'Accreditation 6'],
      actualColumnCount: headers.length,
      matchesExpected: headers.length >= 6
    };
    
    Logger.log(`Headers: ${headers.join(', ')}`);
    Logger.log(`Format check: ${JSON.stringify(formatCheck)}`);
    Logger.log(`Data rows: ${data.length}`);
    
    return {
      success: true,
      spreadsheetId: spreadsheetId,
      sheetName: sheet.getName(),
      rowCount: lastRow,
      columnCount: lastCol,
      headers: headers,
      data: data,
      formatCheck: formatCheck
    };
    
  } catch (error) {
    Logger.log(`❌ Error: ${error.message}`);
    return {
      success: false,
      error: error.message,
      spreadsheetId: spreadsheetId,
      sheetName: sheetName
    };
  }
}

// ============================================================
// HISTORICAL DATA BACKFILL
// ============================================================
// Add this entire section to the END of your Code.gs file
// ============================================================

/**
 * MAIN BACKFILL FUNCTION
 * 
 * Reads all historical scrapes from Google Sheets and inserts them into BigQuery.
 * This populates: advisors, connections, connection_observations, scrape_runs
 * 
 * Run this function from Apps Script console to execute the backfill.
 * 
 * @param {Object} options - Optional configuration
 * @param {boolean} options.dryRun - If true, only log what would be done (default: false)
 * @param {string} options.recruiterFilter - Only process this recruiter name (optional)
 * @param {number} options.maxRecruiters - Limit number of recruiters to process (for testing)
 */
function backfillHistoricalData(options = {}) {
  const dryRun = options.dryRun || false;
  const recruiterFilter = options.recruiterFilter || null;
  const maxRecruiters = options.maxRecruiters || 999;
  
  Logger.log('========================================');
  Logger.log('SAVVY PIRATE - HISTORICAL DATA BACKFILL');
  Logger.log('========================================');
  Logger.log(`Mode: ${dryRun ? '🔍 DRY RUN (no data will be written)' : '🚀 LIVE (writing to BigQuery)'}`);
  Logger.log(`Filter: ${recruiterFilter || 'All recruiters'}`);
  Logger.log(`Timestamp: ${new Date().toISOString()}`);
  Logger.log('');
  
  // Track overall stats
  const stats = {
    recruitersProcessed: 0,
    sheetsProcessed: 0,
    totalRows: 0,
    advisorsCreated: 0,
    advisorsUpdated: 0,
    connectionsCreated: 0,
    observationsCreated: 0,
    scrapeRunsCreated: 0,
    errors: [],
    skipped: []
  };
  
  try {
    // Step 1: Get all recruiters with sheet URLs from BigQuery
    Logger.log('Step 1: Fetching recruiters from BigQuery...');
    const recruitersQuery = `
      SELECT id, name, output_sheet_url, output_sheet_id, frequency, company, title
      FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\`
      WHERE output_sheet_url IS NOT NULL
      ${recruiterFilter ? `AND name = '${escapeSql(recruiterFilter)}'` : ''}
      ORDER BY name
      LIMIT ${maxRecruiters}
    `;
    const recruiters = runQuery(recruitersQuery);
    Logger.log(`Found ${recruiters.length} recruiters with sheet URLs`);
    
    if (recruiters.length === 0) {
      Logger.log('❌ No recruiters found with sheet URLs');
      return { success: false, error: 'No recruiters found', stats };
    }
    
    // Step 2: Process each recruiter
    for (const recruiter of recruiters) {
      Logger.log('');
      Logger.log(`========================================`);
      Logger.log(`Processing: ${recruiter.name}`);
      Logger.log(`========================================`);
      
      // Extract sheet ID from URL if not already set
      let sheetId = recruiter.output_sheet_id;
      if (!sheetId && recruiter.output_sheet_url) {
        const match = recruiter.output_sheet_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        sheetId = match ? match[1] : null;
      }
      
      if (!sheetId) {
        Logger.log(`⚠️ Skipping ${recruiter.name}: No sheet ID found`);
        stats.skipped.push({ recruiter: recruiter.name, reason: 'No sheet ID' });
        continue;
      }
      
      try {
        // Read all sheets from this recruiter's spreadsheet
        const allSheets = readAllSheetsFromSpreadsheet(sheetId, true);
        
        if (!allSheets.success) {
          Logger.log(`❌ Failed to read sheets for ${recruiter.name}: ${allSheets.error}`);
          stats.errors.push({ recruiter: recruiter.name, error: allSheets.error });
          continue;
        }
        
        Logger.log(`Found ${allSheets.sheetCount} sheet tabs`);
        
        // Process each sheet tab (each tab = one historical scrape date)
        const sheetNames = Object.keys(allSheets.sheets);
        for (const sheetName of sheetNames) {
          const sheetData = allSheets.sheets[sheetName];
          
          // Skip empty sheets
          if (sheetData.rowCount <= 1) {
            Logger.log(`  ⏭️ Skipping empty sheet: ${sheetName}`);
            continue;
          }
          
          // Parse date from sheet name (format: MM_DD_YY)
          const scrapeDate = parseSheetNameToDate(sheetName);
          if (!scrapeDate) {
            Logger.log(`  ⚠️ Could not parse date from sheet name: ${sheetName}`);
            stats.skipped.push({ recruiter: recruiter.name, sheet: sheetName, reason: 'Invalid date format' });
            continue;
          }
          
          Logger.log(`  📅 Processing sheet: ${sheetName} (${scrapeDate}) - ${sheetData.rowCount - 1} rows`);
          
          // Process this sheet's data
          const sheetResult = processHistoricalSheet({
            recruiterId: recruiter.id,
            recruiterName: recruiter.name,
            sheetName: sheetName,
            scrapeDate: scrapeDate,
            data: sheetData.data,
            headers: sheetData.headers,
            dryRun: dryRun
          });
          
          // Update stats
          stats.sheetsProcessed++;
          stats.totalRows += sheetResult.rowsProcessed;
          stats.advisorsCreated += sheetResult.advisorsCreated;
          stats.advisorsUpdated += sheetResult.advisorsUpdated;
          stats.connectionsCreated += sheetResult.connectionsCreated;
          stats.observationsCreated += sheetResult.observationsCreated;
          stats.scrapeRunsCreated += sheetResult.scrapeRunCreated ? 1 : 0;
          
          if (sheetResult.errors.length > 0) {
            stats.errors = stats.errors.concat(sheetResult.errors);
          }
        }
        
        stats.recruitersProcessed++;
        
      } catch (err) {
        Logger.log(`❌ Error processing ${recruiter.name}: ${err.message}`);
        stats.errors.push({ recruiter: recruiter.name, error: err.message });
      }
    }
    
    // Final summary
    Logger.log('');
    Logger.log('========================================');
    Logger.log('BACKFILL COMPLETE - SUMMARY');
    Logger.log('========================================');
    Logger.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    Logger.log(`Recruiters processed: ${stats.recruitersProcessed}`);
    Logger.log(`Sheets processed: ${stats.sheetsProcessed}`);
    Logger.log(`Total rows: ${stats.totalRows}`);
    Logger.log(`Advisors created: ${stats.advisorsCreated}`);
    Logger.log(`Advisors updated: ${stats.advisorsUpdated}`);
    Logger.log(`Connections created: ${stats.connectionsCreated}`);
    Logger.log(`Observations created: ${stats.observationsCreated}`);
    Logger.log(`Scrape runs created: ${stats.scrapeRunsCreated}`);
    Logger.log(`Errors: ${stats.errors.length}`);
    Logger.log(`Skipped: ${stats.skipped.length}`);
    
    if (stats.errors.length > 0) {
      Logger.log('');
      Logger.log('ERRORS:');
      stats.errors.slice(0, 10).forEach(e => Logger.log(`  - ${JSON.stringify(e)}`));
    }
    
    return { success: true, stats };
    
  } catch (error) {
    Logger.log(`❌ FATAL ERROR: ${error.message}`);
    Logger.log(error.stack);
    return { success: false, error: error.message, stats };
  }
}

/**
 * Helper function to chunk arrays for BigQuery IN clauses
 * BigQuery has limits on IN clause size, so we chunk into groups of 500
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process a single historical sheet tab
 * OPTIMIZED: Uses batch queries instead of per-row queries
 */
function processHistoricalSheet(params) {
  const { recruiterId, recruiterName, sheetName, scrapeDate, data, headers, dryRun } = params;
  
  const result = {
    rowsProcessed: 0,
    advisorsCreated: 0,
    advisorsUpdated: 0,
    connectionsCreated: 0,
    observationsCreated: 0,
    scrapeRunCreated: false,
    errors: []
  };
  
  // Skip header row
  const dataRows = data.slice(1);
  
  if (dataRows.length === 0) {
    return result;
  }
  
  // Determine if this is a partial scrape (heuristic: less than 100 rows)
  const isPartialScrape = dataRows.length < 100;
  
  // Create a scrape_run entry for this historical scrape
  const scrapeRunId = generateUUID();
  const scrapeDateISO = scrapeDate; // Already in YYYY-MM-DD format
  
  if (!dryRun) {
    try {
      // Calculate week of month from scrape date
      const dateObj = new Date(scrapeDate);
      const dayOfMonth = dateObj.getDate();
      const weekOfMonth = Math.ceil(dayOfMonth / 7);
      
      // Calculate Monday of that week
      const monday = new Date(dateObj);
      monday.setDate(dateObj.getDate() - ((dateObj.getDay() + 6) % 7));
      const scrapeWeek = monday.toISOString().split('T')[0];
      
      insertRows('scrape_runs', [{
        id: scrapeRunId,
        recruiter_id: recruiterId,
        recruiter_name: recruiterName,
        started_at: `${scrapeDateISO}T00:00:00.000Z`,
        completed_at: `${scrapeDateISO}T00:01:00.000Z`,
        status: isPartialScrape ? 'partial' : 'completed',
        profiles_scraped: dataRows.length,
        new_connections_found: 0, // Will be calculated later if needed
        searches_completed: 9,
        total_searches: 9,
        error_message: isPartialScrape ? 'Historical partial scrape' : null,
        scrape_week: scrapeWeek,
        week_of_month: weekOfMonth,
        created_at: new Date().toISOString()
      }]);
      result.scrapeRunCreated = true;
    } catch (err) {
      Logger.log(`    ⚠️ Error creating scrape_run: ${err.message}`);
      result.errors.push({ type: 'scrape_run', error: err.message });
    }
  }
  
  if (dryRun) {
    Logger.log(`    [DRY RUN] Would process ${dataRows.length} rows`);
    result.rowsProcessed = dataRows.length;
    return result;
  }
  
  Logger.log(`    📊 Processing ${dataRows.length} rows with batch operations...`);
  
  // ============================================================
  // STEP 1: Parse and normalize all rows first
  // ============================================================
  const parsedRows = [];
  const allLinkedInUrls = new Set();
  
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    
    // Extract data from row (matching your column structure)
    // Columns: Date, Name, Title, Location, Connection Source, LinkedIn URL, Accred1-6
    const name = row[1] ? String(row[1]).trim() : null;
    const title = row[2] ? String(row[2]).trim() : null;
    const location = row[3] ? String(row[3]).trim() : null;
    const linkedinUrl = row[5] ? String(row[5]).trim() : null;
    
    // Skip rows without LinkedIn URL or name
    if (!linkedinUrl || !name) {
      continue;
    }
    
    // Normalize LinkedIn URL
    const normalizedUrl = normalizeLinkedInUrl(linkedinUrl);
    const linkedinId = extractLinkedInId(linkedinUrl);
    
    if (!normalizedUrl) {
      result.errors.push({ row: i + 2, error: 'Invalid LinkedIn URL', url: linkedinUrl });
      continue;
    }
    
    // Extract accreditations (columns 6-11)
    const accreditations = [];
    for (let j = 6; j <= 11; j++) {
      if (row[j] && String(row[j]).trim()) {
        accreditations.push(String(row[j]).trim());
      }
    }
    
    parsedRows.push({
      name: name,
      title: title,
      location: location,
      linkedinUrl: normalizedUrl,
      linkedinId: linkedinId,
      accreditations: accreditations,
      rowIndex: i + 2
    });
    
    allLinkedInUrls.add(normalizedUrl);
  }
  
  if (parsedRows.length === 0) {
    Logger.log(`    ⚠️ No valid rows to process`);
    return result;
  }
  
  result.rowsProcessed = parsedRows.length;
  Logger.log(`    ✅ Parsed ${parsedRows.length} valid rows`);
  
  // ============================================================
  // STEP 2: Batch-fetch ALL existing advisors in ONE query (chunked)
  // ============================================================
  Logger.log(`    🔍 Batch-fetching existing advisors (${allLinkedInUrls.size} unique URLs)...`);
  const urlArray = Array.from(allLinkedInUrls);
  const urlChunks = chunkArray(urlArray, 500); // BigQuery IN clause limit
  const existingAdvisors = [];
  
  for (const chunk of urlChunks) {
    const urlList = chunk.map(url => `'${escapeSql(url)}'`).join(',');
    const existingQuery = `
      SELECT id, linkedin_url, linkedin_id, first_seen_at, last_seen_at
      FROM \`${PROJECT_ID}.${DATASET_ID}.advisors\`
      WHERE linkedin_url IN (${urlList})
    `;
    try {
      const chunkResults = runQuery(existingQuery);
      existingAdvisors.push(...chunkResults);
    } catch (err) {
      Logger.log(`    ⚠️ Error fetching advisors chunk: ${err.message}`);
      result.errors.push({ type: 'advisor_batch_query', error: err.message });
    }
  }
  
  Logger.log(`    ✅ Found ${existingAdvisors.length} existing advisors`);
  
  // ============================================================
  // STEP 3: Build advisor lookup map
  // ============================================================
  const advisorMap = {}; // linkedin_url -> { id, first_seen_at, last_seen_at }
  existingAdvisors.forEach(a => {
    advisorMap[a.linkedin_url] = {
      id: a.id,
      firstSeen: a.first_seen_at,
      lastSeen: a.last_seen_at
    };
  });
  
  // ============================================================
  // STEP 4: Identify NEW advisors and prepare for batch insert
  // ============================================================
  const newAdvisors = [];
  
  parsedRows.forEach(row => {
    const url = row.linkedinUrl;
    
    if (!advisorMap[url]) {
      // New advisor - create it
      const advisorId = generateUUID();
      advisorMap[url] = {
        id: advisorId,
        firstSeen: `${scrapeDateISO}T00:00:00.000Z`,
        lastSeen: `${scrapeDateISO}T00:00:00.000Z`
      };
      
      newAdvisors.push({
        id: advisorId,
        linkedin_url: url,
        linkedin_id: row.linkedinId,
        name: row.name,
        current_title: row.title || null,
        current_location: row.location || null,
        accreditations: row.accreditations.length > 0 ? row.accreditations : [],
        first_seen_at: `${scrapeDateISO}T00:00:00.000Z`,
        last_seen_at: `${scrapeDateISO}T00:00:00.000Z`,
        times_seen: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } else {
      // Existing advisor - use existing ID
      // Note: We skip updating first_seen_at during backfill to avoid:
      // 1. Streaming buffer issues (can't UPDATE recently inserted rows)
      // 2. Date parsing issues (BigQuery timestamp formats)
      // The observations table has the accurate historical data anyway
    }
  });
  
  // Batch insert new advisors
  if (newAdvisors.length > 0) {
    Logger.log(`    ➕ Creating ${newAdvisors.length} new advisors...`);
    try {
      insertRows('advisors', newAdvisors);
      result.advisorsCreated = newAdvisors.length;
      Logger.log(`    ✅ Created ${newAdvisors.length} advisors`);
    } catch (err) {
      Logger.log(`    ❌ Error inserting advisors: ${err.message}`);
      result.errors.push({ type: 'advisor_insert', error: err.message });
    }
  }
  
  // Note: We don't update existing advisors' first_seen_at during backfill
  // The observations table contains the accurate historical data, and the
  // v_observations_with_advisors view can be used for query-time analysis
  
  // ============================================================
  // STEP 5: Get all advisor IDs we'll be working with
  // ============================================================
  const advisorIds = parsedRows.map(row => advisorMap[row.linkedinUrl].id);
  const uniqueAdvisorIds = Array.from(new Set(advisorIds));
  
  Logger.log(`    🔍 Batch-fetching existing connections (${uniqueAdvisorIds.length} unique advisors)...`);
  
  // ============================================================
  // STEP 6: Batch-fetch ALL existing connections (chunked)
  // ============================================================
  const advisorIdChunks = chunkArray(uniqueAdvisorIds, 500);
  const existingConnections = [];
  
  for (const chunk of advisorIdChunks) {
    const idList = chunk.map(id => `'${escapeSql(id)}'`).join(',');
    const connQuery = `
      SELECT advisor_id, id, first_seen_date, last_seen_date
      FROM \`${PROJECT_ID}.${DATASET_ID}.connections\`
      WHERE recruiter_id = '${recruiterId}'
      AND advisor_id IN (${idList})
    `;
    try {
      const chunkResults = runQuery(connQuery);
      existingConnections.push(...chunkResults);
    } catch (err) {
      Logger.log(`    ⚠️ Error fetching connections chunk: ${err.message}`);
      result.errors.push({ type: 'connection_batch_query', error: err.message });
    }
  }
  
  Logger.log(`    ✅ Found ${existingConnections.length} existing connections`);
  
  // ============================================================
  // STEP 7: Build connection lookup map
  // ============================================================
  const connMap = {}; // advisor_id -> { id, first_seen_date, last_seen_date }
  existingConnections.forEach(c => {
    connMap[c.advisor_id] = {
      id: c.id,
      firstSeen: c.first_seen_date,
      lastSeen: c.last_seen_date
    };
  });
  
  // ============================================================
  // STEP 8: Identify NEW connections and prepare for batch insert
  // ============================================================
  const newConnections = [];
  
  parsedRows.forEach(row => {
    const advisorId = advisorMap[row.linkedinUrl].id;
    
    if (!connMap[advisorId]) {
      // New connection
      newConnections.push({
        id: generateUUID(),
        advisor_id: advisorId,
        recruiter_id: recruiterId,
        first_seen_date: scrapeDateISO,
        last_seen_date: scrapeDateISO,
        search_type: null, // Not available in historical data
        scrape_run_id: scrapeRunId,
        created_at: new Date().toISOString()
      });
    } else {
      // Connection exists - we could update dates, but for backfill we'll skip
      // to avoid streaming buffer issues. The observations table has the correct data.
    }
  });
  
  // Batch insert new connections
  if (newConnections.length > 0) {
    Logger.log(`    ➕ Creating ${newConnections.length} new connections...`);
    try {
      insertRows('connections', newConnections);
      result.connectionsCreated = newConnections.length;
      Logger.log(`    ✅ Created ${newConnections.length} connections`);
    } catch (err) {
      Logger.log(`    ❌ Error inserting connections: ${err.message}`);
      result.errors.push({ type: 'connection_insert', error: err.message });
    }
  }
  
  // ============================================================
  // STEP 9: Batch-insert all observations
  // ============================================================
  Logger.log(`    📝 Preparing ${parsedRows.length} observations...`);
  const observations = parsedRows.map((row, idx) => ({
    id: `obs_hist_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
    scrape_run_id: scrapeRunId,
    recruiter_id: recruiterId,
    advisor_id: advisorMap[row.linkedinUrl].id,
    search_id: null,
    observed_at: `${scrapeDateISO}T00:00:00.000Z`,
    advisor_name: row.name,
    advisor_title: row.title || null,
    advisor_location: row.location || null,
    advisor_linkedin_url: row.linkedinUrl,
    search_job_title: null,
    created_at: new Date().toISOString()
  }));
  
  // Insert observations in batches of 500 (BigQuery streaming insert limit)
  const observationBatches = chunkArray(observations, 500);
  Logger.log(`    📤 Inserting ${observations.length} observations in ${observationBatches.length} batch(es)...`);
  
  for (let i = 0; i < observationBatches.length; i++) {
    try {
      insertRows('connection_observations', observationBatches[i]);
      result.observationsCreated += observationBatches[i].length;
      Logger.log(`    ✅ Inserted batch ${i + 1}/${observationBatches.length} (${observationBatches[i].length} rows)`);
    } catch (err) {
      Logger.log(`    ❌ Error inserting observations batch ${i + 1}: ${err.message}`);
      result.errors.push({ type: 'observation_batch', batch: i + 1, error: err.message });
    }
  }
  
  Logger.log(`    ✅ Processed ${result.rowsProcessed} rows: ${result.advisorsCreated} new advisors, ${result.connectionsCreated} new connections, ${result.observationsCreated} observations`);
  
  return result;
}

/**
 * Parse sheet name to date
 * Handles formats like: "12_28_25" -> "2025-12-28"
 */
function parseSheetNameToDate(sheetName) {
  if (!sheetName) return null;
  
  // Try MM_DD_YY format
  const match = sheetName.match(/^(\d{1,2})_(\d{1,2})_(\d{2})$/);
  if (match) {
    const month = match[1].padStart(2, '0');
    const day = match[2].padStart(2, '0');
    const year = `20${match[3]}`; // Assumes 20xx
    return `${year}-${month}-${day}`;
  }
  
  // Try other formats if needed
  // Add more parsers here as needed
  
  return null;
}


// ============================================================
// HELPER FUNCTIONS FOR BACKFILL
// ============================================================

/**
 * Run a dry-run backfill for testing
 */
function testBackfillDryRun() {
  return backfillHistoricalData({
    dryRun: true,
    maxRecruiters: 3
  });
}

/**
 * Backfill a single recruiter (for testing)
 */
function backfillSingleRecruiter(recruiterName) {
  return backfillHistoricalData({
    dryRun: false,
    recruiterFilter: recruiterName
  });
}

/**
 * Backfill a single recruiter in dry-run mode
 */
function testBackfillSingleRecruiter() {
  return backfillHistoricalData({
    dryRun: true,
    recruiterFilter: 'Megan Bailey'
  });
}

/**
 * Run the FULL backfill (all recruiters, live mode)
 * ⚠️ WARNING: This will insert data into BigQuery!
 */
function runFullBackfill() {
  return backfillHistoricalData({
    dryRun: false
  });
}


// ============================================================
// QUICK STATS CHECK
// ============================================================

/**
 * Check current data counts in BigQuery (run before/after backfill)
 */
function checkDataCounts() {
  Logger.log('========================================');
  Logger.log('BIGQUERY DATA COUNTS');
  Logger.log('========================================');
  
  const tables = ['recruiters', 'searches', 'advisors', 'connections', 'connection_observations', 'scrape_runs'];
  
  for (const table of tables) {
    try {
      const query = `SELECT COUNT(*) as count FROM \`${PROJECT_ID}.${DATASET_ID}.${table}\``;
      const result = runQuery(query);
      Logger.log(`${table}: ${result[0].count} rows`);
    } catch (err) {
      Logger.log(`${table}: ERROR - ${err.message}`);
    }
  }
  
  // Also check date ranges
  Logger.log('');
  Logger.log('DATE RANGES:');
  
  try {
    const advisorDates = runQuery(`
      SELECT 
        MIN(first_seen_at) as earliest,
        MAX(last_seen_at) as latest
      FROM \`${PROJECT_ID}.${DATASET_ID}.advisors\`
    `);
    if (advisorDates.length > 0) {
      Logger.log(`Advisors: ${advisorDates[0].earliest} to ${advisorDates[0].latest}`);
    }
  } catch (err) {}
  
  try {
    const connDates = runQuery(`
      SELECT 
        MIN(first_seen_date) as earliest,
        MAX(last_seen_date) as latest
      FROM \`${PROJECT_ID}.${DATASET_ID}.connections\`
    `);
    if (connDates.length > 0) {
      Logger.log(`Connections: ${connDates[0].earliest} to ${connDates[0].latest}`);
    }
  } catch (err) {}
  
  try {
    const obsDates = runQuery(`
      SELECT 
        MIN(observed_at) as earliest,
        MAX(observed_at) as latest
      FROM \`${PROJECT_ID}.${DATASET_ID}.connection_observations\`
    `);
    if (obsDates.length > 0) {
      Logger.log(`Observations: ${obsDates[0].earliest} to ${obsDates[0].latest}`);
    }
  } catch (err) {}
  
  Logger.log('========================================');
}
// ============================================================
// INDIVIDUAL RECRUITER BACKFILL FUNCTIONS
// ============================================================
// Add this to the END of your Code.gs
// Run these ONE AT A TIME from the function dropdown
// ============================================================

// Track which recruiters have been processed
// Run this first to see which ones are done
function checkBackfillProgress() {
  Logger.log('========================================');
  Logger.log('BACKFILL PROGRESS CHECK');
  Logger.log('========================================');
  
  const query = `
    SELECT 
      r.name as recruiter,
      COUNT(DISTINCT sr.id) as scrape_runs,
      COUNT(DISTINCT c.id) as connections,
      MIN(c.first_seen_date) as earliest_date,
      MAX(c.last_seen_date) as latest_date
    FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` r
    LEFT JOIN \`${PROJECT_ID}.${DATASET_ID}.scrape_runs\` sr ON r.id = sr.recruiter_id
    LEFT JOIN \`${PROJECT_ID}.${DATASET_ID}.connections\` c ON r.id = c.recruiter_id
    GROUP BY r.name
    ORDER BY r.name
  `;
  
  const results = runQuery(query);
  
  let done = 0;
  let pending = 0;
  
  results.forEach(r => {
    const status = r.scrape_runs > 0 ? '✅' : '⏳';
    if (r.scrape_runs > 0) done++; else pending++;
    Logger.log(`${status} ${r.recruiter}: ${r.scrape_runs} runs, ${r.connections} connections (${r.earliest_date || 'n/a'} to ${r.latest_date || 'n/a'})`);
  });
  
  Logger.log('');
  Logger.log(`Done: ${done} | Pending: ${pending}`);
}

// ============================================================
// RUN THESE ONE AT A TIME - 2nd & 4th Week Recruiters
// ============================================================

function backfill_01_Michael_Terrana() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Michael Terrana' });
}

function backfill_02_Jodie_Papike_Sladavic() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Jodie Papike Sladavic' });
}

function backfill_03_Taylor_Matthews() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Taylor Matthews' });
}

function backfill_04_Stacey_Frank() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Stacey Frank' });
}

function backfill_05_Michael_McGahey() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Michael McGahey' });
}

function backfill_06_Megan_Bailey() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Megan Bailey' });
}

function backfill_07_Scott_Briganti() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Scott Briganti' });
}

function backfill_08_Morgan_Cirotto() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Morgan Cirotto' });
}

function backfill_09_Nicole_Owens() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Nicole Owens' });
}

function backfill_10_Kylie_Leone() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Kylie Leone' });
}

function backfill_11_Rachel_Schuyler() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Rachel Schuyler' });
}

function backfill_12_Frank_LaRosa() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Frank LaRosa' });
}

function backfill_13_Simon_Hoyle() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Simon Hoyle' });
}

// ============================================================
// RUN THESE ONE AT A TIME - 1st & 3rd Week Recruiters
// ============================================================

function backfill_14_Louis_Diamond() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Louis Diamond' });
}

function backfill_15_Jeff_Nash() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Jeff Nash' });
}

function backfill_16_Jesse_Papike() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Jesse Papike' });
}

function backfill_17_Patrick_Kelly() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Patrick Kelly' });
}

function backfill_18_Jon_Bartick() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Jon Bartick' });
}

function backfill_19_Matt_DuToit() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Matt DuToit' });
}

function backfill_20_Thor_Gould() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Thor Gould' });
}

function backfill_21_Sam_Briganti() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Sam Briganti' });
}

function backfill_22_Taylor_Newman() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Taylor Newman' });
}

function backfill_23_Kate_Little() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Kate Little' });
}

function backfill_24_Mina_Consarino() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Mina Consarino' });
}

function backfill_25_Kaitlin_Wickenheiser() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Kaitlin Wickenheiser' });
}

function backfill_26_Kaely_Ferguson() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Kaely Ferguson' });
}

function backfill_27_Julianna_King() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Julianna King' });
}

function backfill_28_Kristy_Puckett() {
  // Use LIKE query approach - modify backfillHistoricalData to support this
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Kristy Puckett' });
}

function backfill_29_Sean_Lindenbaum() {
  return backfillHistoricalData({ dryRun: false, recruiterFilter: 'Sean Lindenbaum' });
}
