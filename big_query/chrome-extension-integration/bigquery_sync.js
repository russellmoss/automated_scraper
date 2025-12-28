// background/bigquery_sync.js
// Add this file to your Chrome extension's background folder
// This syncs scraped data to BigQuery via Cloud Function

const LOG = '[BIGQUERY]';

// Cloud Function URL - UPDATE THIS after deploying
const CLOUD_FUNCTION_URL = 'https://YOUR_REGION-YOUR_PROJECT_ID.cloudfunctions.net/savvy-pirate-sync';

// ============================================================
// API HELPER
// ============================================================

async function callCloudFunction(action, data) {
    const response = await fetch(CLOUD_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, data })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Cloud Function error: ${response.status} - ${error}`);
    }

    return response.json();
}

// ============================================================
// RECRUITER MANAGEMENT
// ============================================================

/**
 * Get or create a recruiter in BigQuery
 */
export async function getOrCreateRecruiter(name, frequency = '1st_3rd_week', options = {}) {
    console.log(`${LOG} Getting/creating recruiter: ${name}`);

    try {
        const result = await callCloudFunction('get_or_create_recruiter', {
            name,
            frequency,
            company: options.company,
            title: options.title,
            sheetUrl: options.sheetUrl
        });

        console.log(`${LOG} Recruiter ${result.created ? 'created' : 'found'}: ${result.recruiterId}`);
        return result.recruiterId;

    } catch (error) {
        console.error(`${LOG} Error managing recruiter:`, error);
        throw error;
    }
}

/**
 * Import recruiters from the Mapping and Schedules sheet
 */
export async function importRecruitersFromMappings(mappings) {
    console.log(`${LOG} Importing ${mappings.length} recruiters...`);

    try {
        const result = await callCloudFunction('import_recruiters', {
            recruiters: mappings
        });

        console.log(`${LOG} Imported ${result.imported} recruiters, ${result.errors} errors`);
        return result;

    } catch (error) {
        console.error(`${LOG} Import error:`, error);
        throw error;
    }
}

// ============================================================
// PROFILE SYNC
// ============================================================

/**
 * Sync scraped profiles to BigQuery
 * Call this after the existing Google Sheets sync
 */
export async function syncProfilesToBigQuery(profiles, recruiterId, recruiterName, searchType = null, scrapeRunId = null) {
    console.log(`${LOG} Syncing ${profiles.length} profiles for ${recruiterName}...`);

    if (!isConfigured()) {
        console.warn(`${LOG} Cloud Function URL not configured - skipping sync`);
        return { synced: 0, errors: 0 };
    }

    try {
        const result = await callCloudFunction('sync_profiles', {
            profiles: profiles.map(p => ({
                name: p.name,
                linkedinUrl: p.linkedinUrl,
                title: p.title,
                location: p.location,
                accreditations: p.accreditations
            })),
            recruiterId,
            recruiterName,
            searchType,
            scrapeRunId
        });

        console.log(`${LOG} ✅ Sync complete: ${result.synced} synced, ${result.errors} errors`);
        return result;

    } catch (error) {
        console.error(`${LOG} Sync error:`, error);
        return { synced: 0, errors: profiles.length, error: error.message };
    }
}

// ============================================================
// SCRAPE RUN TRACKING
// ============================================================

/**
 * Create a scrape run record in BigQuery
 */
export async function createScrapeRun(recruiterId, recruiterName, totalSearches = 9) {
    console.log(`${LOG} Creating scrape run for ${recruiterName}...`);

    try {
        const result = await callCloudFunction('create_scrape_run', {
            recruiterId,
            recruiterName,
            totalSearches
        });

        console.log(`${LOG} Scrape run created: ${result.scrapeRunId}`);
        return result.scrapeRunId;

    } catch (error) {
        console.error(`${LOG} Create scrape run error:`, error);
        return null;
    }
}

/**
 * Complete a scrape run
 */
export async function completeScrapeRun(scrapeRunId, profilesScraped, newConnections, searchesCompleted, status = 'completed', error = null) {
    console.log(`${LOG} Completing scrape run: ${scrapeRunId}...`);

    try {
        await callCloudFunction('complete_scrape_run', {
            scrapeRunId,
            profilesScraped,
            newConnections,
            searchesCompleted,
            status,
            error
        });

        console.log(`${LOG} Scrape run completed`);

    } catch (err) {
        console.error(`${LOG} Complete scrape run error:`, err);
    }
}

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Check if BigQuery sync is configured
 */
export function isConfigured() {
    return CLOUD_FUNCTION_URL && 
           !CLOUD_FUNCTION_URL.includes('YOUR_REGION') &&
           !CLOUD_FUNCTION_URL.includes('YOUR_PROJECT_ID');
}

/**
 * Test connection to Cloud Function
 */
export async function testConnection() {
    try {
        const result = await callCloudFunction('test_connection', {});
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
    importRecruitersFromMappings,
    createScrapeRun,
    completeScrapeRun,
    isConfigured,
    testConnection
};
