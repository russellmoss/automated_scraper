// background/bigquery_sync.js
// Syncs scraped data to BigQuery via Apps Script Web App

const BQ_LOG = '[BIGQUERY]';

// ============================================================
// CONFIGURATION - Loaded from Chrome Storage
// ============================================================

// Default URL (will be overridden by stored config)
let APPS_SCRIPT_WEB_APP_URL = null;

/**
 * Initialize BigQuery sync configuration
 * Call this once during service worker startup
 */
export async function initBigQueryConfig() {
    try {
        const stored = await chrome.storage.local.get(['bigquery_config']);
        if (stored.bigquery_config?.appsScriptWebAppUrl) {
            APPS_SCRIPT_WEB_APP_URL = stored.bigquery_config.appsScriptWebAppUrl;
            console.log(`${BQ_LOG} ✅ Config loaded: ${APPS_SCRIPT_WEB_APP_URL}`);
            return true;
        } else {
            console.warn(`${BQ_LOG} ⚠️ No Apps Script Web App URL configured`);
            return false;
        }
    } catch (e) {
        console.error(`${BQ_LOG} Failed to load config:`, e);
        return false;
    }
}

/**
 * Save BigQuery configuration
 * @param {Object} config - { appsScriptWebAppUrl: string }
 */
export async function saveBigQueryConfig(config) {
    await chrome.storage.local.set({ 
        bigquery_config: {
            appsScriptWebAppUrl: config.appsScriptWebAppUrl,
            configured_at: new Date().toISOString()
        }
    });
    APPS_SCRIPT_WEB_APP_URL = config.appsScriptWebAppUrl;
    console.log(`${BQ_LOG} ✅ Config saved`);
}

/**
 * Check if BigQuery sync is configured
 */
export function isConfigured() {
    return !!APPS_SCRIPT_WEB_APP_URL;
}

/**
 * Get current configuration
 */
export function getConfig() {
    return {
        appsScriptWebAppUrl: APPS_SCRIPT_WEB_APP_URL,
        isConfigured: isConfigured()
    };
}

// ============================================================
// API HELPER
// ============================================================

async function callAppsScriptWebApp(action, data) {
    if (!APPS_SCRIPT_WEB_APP_URL) {
        throw new Error('BigQuery Apps Script Web App URL not configured');
    }
    
    const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, data })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Apps Script Web App error: ${response.status} - ${error}`);
    }

    return response.json();
}

// ============================================================
// PROFILE SYNC
// ============================================================

/**
 * Convert Sheets row format to BigQuery profile format
 * Sheets format: [Date, Name, Title, Location, Connection Source, LinkedIn URL, Accreditation 1-6, ...]
 * BigQuery format: { name, linkedinUrl, title, location, accreditations }
 */
function convertSheetsRowToProfile(row) {
    // Sheets row format: [Date, Name, Title, Location, Connection Source, LinkedIn URL, Accreditation 1-6, ...]
    // Index mapping: 0=Date, 1=Name, 2=Title, 3=Location, 4=Connection Source, 5=LinkedIn URL, 6-11=Accreditations
    const accreditations = [];
    for (let i = 6; i <= 11; i++) {
        if (row[i] && row[i].trim()) {
            accreditations.push(row[i].trim());
        }
    }
    
    return {
        name: row[1] || '', // Column 1 = Name
        title: row[2] || null, // Column 2 = Title
        location: row[3] || null, // Column 3 = Location
        linkedinUrl: row[5] || null, // Column 5 = LinkedIn URL
        accreditations: accreditations.length > 0 ? accreditations : []
    };
}

/**
 * Sync scraped profiles to BigQuery
 * Call this after the existing Google Sheets sync
 * @param {Array} profiles - Array of profile objects OR Sheets row format arrays
 * @param {string} recruiterId - BigQuery recruiter ID
 * @param {string} recruiterName - Recruiter name (Connection Source)
 * @param {string} searchType - Optional search type/job title
 * @param {string} scrapeRunId - Optional scrape run ID
 */
export async function syncProfilesToBigQuery(profiles, recruiterId, recruiterName, searchType = null, scrapeRunId = null) {
    console.log(`${BQ_LOG} Syncing ${profiles.length} profiles for ${recruiterName}...`);

    if (!isConfigured()) {
        console.warn(`${BQ_LOG} Apps Script Web App URL not configured - skipping sync`);
        return { synced: 0, errors: 0 };
    }

    // Convert Sheets row format to profile format if needed
    const profileObjects = profiles.map(p => {
        if (Array.isArray(p)) {
            // It's a Sheets row format array
            return convertSheetsRowToProfile(p);
        } else {
            // It's already a profile object
            return {
                name: p.name || '',
                linkedinUrl: p.linkedinUrl || p.linkedin_url || null,
                title: p.title || null,
                location: p.location || null,
                accreditations: p.accreditations || []
            };
        }
    });

    try {
        const result = await callAppsScriptWebApp('sync_profiles', {
            profiles: profileObjects,
            recruiterId,
            recruiterName,
            searchType,
            scrapeRunId
        });

        // Log full result for debugging
        console.log(`${BQ_LOG} 📊 Sync result:`, JSON.stringify(result, null, 2));
        
        // Check if advisorIds are in the result
        if (result.advisorIds) {
            console.log(`${BQ_LOG} ✅ advisorIds received: ${result.advisorIds.length} IDs (first 3: ${result.advisorIds.slice(0, 3).join(', ')})`);
        } else {
            console.warn(`${BQ_LOG} ⚠️ No advisorIds in sync result - observations will use fallback lookup`);
        }

        if (result.errors > 0) {
            console.warn(`${BQ_LOG} ⚠️ Sync complete with ${result.errors} errors: ${result.synced} synced, ${result.errors} failed`);
            if (result.errorDetails && result.errorDetails.length > 0) {
                console.warn(`${BQ_LOG} Error details:`, result.errorDetails);
                result.errorDetails.forEach((detail, idx) => {
                    console.warn(`${BQ_LOG}   Error ${idx + 1}: ${detail}`);
                });
            } else {
                console.warn(`${BQ_LOG} ⚠️ No error details provided by Apps Script`);
            }
        } else {
            console.log(`${BQ_LOG} ✅ Sync complete: ${result.synced} synced, 0 errors`);
        }
        return result;

    } catch (error) {
        console.error(`${BQ_LOG} ❌ Sync error:`, error);
        return { synced: 0, errors: profiles.length, error: error.message };
    }
}

// ============================================================
// RECRUITER MANAGEMENT
// ============================================================

/**
 * Get or create a recruiter in BigQuery
 * @param {string} name - Recruiter name (Connection Source)
 * @param {string} frequency - '1st_3rd_week' or '2nd_4th_week'
 * @param {Object} options - Additional options (company, title, sheetUrl)
 */
export async function getOrCreateRecruiter(name, frequency = '1st_3rd_week', options = {}) {
    console.log(`${BQ_LOG} Getting/creating recruiter: ${name}`);

    if (!isConfigured()) {
        console.warn(`${BQ_LOG} Apps Script Web App URL not configured - cannot get/create recruiter`);
        return null;
    }

    try {
        const result = await callAppsScriptWebApp('get_or_create_recruiter', {
            name,
            frequency,
            company: options.company,
            title: options.title,
            sheetUrl: options.sheetUrl
        });

        console.log(`${BQ_LOG} Recruiter ${result.created ? 'created' : 'found'}: ${result.recruiterId}`);
        return result.recruiterId;

    } catch (error) {
        console.error(`${BQ_LOG} Error managing recruiter:`, error);
        throw error;
    }
}

// ============================================================
// SCRAPE RUN TRACKING
// ============================================================

/**
 * Create a scrape run record in BigQuery
 */
export async function createScrapeRun(recruiterId, recruiterName, totalSearches = 9) {
    console.log(`${BQ_LOG} Creating scrape run for ${recruiterName}...`);

    if (!isConfigured()) {
        return null;
    }

    try {
        const result = await callAppsScriptWebApp('create_scrape_run', {
            recruiterId,
            recruiterName,
            totalSearches
        });

        console.log(`${BQ_LOG} Scrape run created: ${result.scrapeRunId}`);
        return result.scrapeRunId;

    } catch (error) {
        console.error(`${BQ_LOG} Create scrape run error:`, error);
        return null;
    }
}

/**
 * Complete a scrape run
 */
export async function completeScrapeRun(scrapeRunId, profilesScraped, newConnections, searchesCompleted, status = 'completed', error = null) {
    console.log(`${BQ_LOG} Completing scrape run: ${scrapeRunId}...`);

    if (!isConfigured() || !scrapeRunId) {
        return;
    }

    try {
        await callAppsScriptWebApp('complete_scrape_run', {
            scrapeRunId,
            profilesScraped,
            newConnections,
            searchesCompleted,
            status,
            error
        });

        console.log(`${BQ_LOG} Scrape run completed`);

    } catch (err) {
        console.error(`${BQ_LOG} Complete scrape run error:`, err);
    }
}

// ============================================================
// OBSERVATION RECORDING (Point-in-Time Storage)
// ============================================================

/**
 * Record all profiles from a search as observations
 * Called after each search completes
 */
export async function recordSearchObservations(scrapeRunId, recruiterId, searchId, searchJobTitle, profiles, advisorIds = null) {
    if (!profiles || profiles.length === 0) {
        console.log(`${BQ_LOG} No profiles to record as observations`);
        return;
    }
    
    if (!isConfigured()) {
        console.warn(`${BQ_LOG} Apps Script Web App URL not configured - skipping observations`);
        return;
    }
    
    try {
        // Convert Sheets row format if needed
        const profileObjects = profiles.map(p => {
            if (Array.isArray(p)) {
                const converted = convertSheetsRowToProfile(p);
                return {
                    advisor_id: null, // Will be provided from sync result
                    name: converted.name,
                    title: converted.title,
                    location: converted.location,
                    linkedin_url: converted.linkedinUrl
                };
            } else {
                return {
                    advisor_id: p.id || null,
                    name: p.name || '',
                    title: p.title || null,
                    location: p.location || null,
                    linkedin_url: p.linkedinUrl || p.linkedin_url || null
                };
            }
        });

        const result = await callAppsScriptWebApp('record_observations_batch', {
            scrape_run_id: scrapeRunId,
            recruiter_id: recruiterId,
            search_id: searchId,
            search_job_title: searchJobTitle,
            profiles: profileObjects,
            advisorIds: advisorIds // Pass advisor_ids from sync result
        });
        
        console.log(`${BQ_LOG} Observations recorded:`, result);
        return result;
        
    } catch (error) {
        console.error(`${BQ_LOG} Failed to record observations:`, error);
    }
}

// ============================================================
// TEST CONNECTION
// ============================================================

export async function testConnection() {
    try {
        const result = await callAppsScriptWebApp('test_connection', {});
        return { success: true, message: result.message };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// ============================================================
// EXPORT FOR SERVICE WORKER
// ============================================================

export default {
    syncProfilesToBigQuery,
    getOrCreateRecruiter,
    createScrapeRun,
    completeScrapeRun,
    recordSearchObservations,
    isConfigured,
    testConnection,
    initBigQueryConfig,
    saveBigQueryConfig,
    getConfig
};

