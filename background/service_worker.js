// background/service_worker.js - Main Service Worker Orchestrator

// ============================================================
// IMPORTS
// ============================================================
import { 
    getAuthToken, 
    removeCachedToken, 
    setupTokenRefreshAlarm, 
    refreshTokenIfNeeded, 
    ensureFreshToken,
    setupServiceAccount,
    isServiceAccountConfigured,
    getServiceAccountEmail
} from './auth.js';
import { 
    createSheet, readSheet, appendRows, appendRowsToTab,
    getSheetTabs, createTab, writeHeadersToTab, ensureWeeklyTab,
    validateSpreadsheet, getSheetName, loadSheet, getTabData,
    compareTabs, deduplicateSheet, getTodayTabName
} from './sheets_api.js';
import { 
    addToQueue, processQueue, getQueueStatus, 
    getFailedRows, clearFailedRows, retryFailedItems, updateQueueTabName
} from './sync_queue.js';
import {
    getSchedules, setSchedule, deleteSchedule, checkSchedules,
    markScheduleRun, addExecutionRecord, updateExecutionRecord,
    getExecutionHistory, getScheduleForSource, calculateNextRun,
    generateSheetUrlWithGid, addPendingSchedule, removePendingSchedule,
    getPendingSchedules,
    validateSchedule
} from './scheduler.js';
import {
    setWebhookUrl, getWebhookUrl, testWebhook,
    notifyScheduleStarted, notifyScheduleCompleted, notifyScheduleFailed, notifyError,
    notifyScrapeFailed,
    notifyLinkedInSignedOut,
    notifyLinkedInCheckpoint,
    notifyGoogleAuthExpired
} from './notifications.js';
import {
    loadWorkbookConfig,
    syncWorkbookConfig,
    getWorkbookConfig,
    clearWorkbookConfig,
    setSyncInterval,
    getSyncInterval
} from './sheet_sync.js';
import { CONFIG, ALARM_NAMES, MESSAGE_ACTIONS, STORAGE_KEYS, LOG_PREFIXES } from '../utils/constants.js';

const LOG = LOG_PREFIXES.SERVICE_WORKER;
const SERVICE_WORKER_VERSION = '2025-12-17-testmode-v1';

// ============================================================
// STATE
// ============================================================
let currentOutputSheetId = null;
let currentTabName = 'Sheet1';
let isScrapingActive = false;
let currentSearchIndex = 0;
let savedWorkbooks = [];
let sourceMapping = {};
let autoRunState = {
    isRunning: false,
    isAborted: false,
    config: null,
    progress: null
};
let manualScrapeState = {
    isRunning: false,
    isAborted: false,
    sourceName: null,
    searches: [],
    currentSearchIndex: 0,
    workbookId: null
};

// ============================================================
// SCRAPE WAIT MANAGEMENT (Abort in-flight waits on Stop)
// ============================================================
const scrapeWaiters = new Map(); // tabId -> { resolve, cleanup }

function abortScrapeWait(tabId, reason = 'aborted') {
    const waiter = scrapeWaiters.get(tabId);
    if (!waiter) return;
    try {
        waiter.cleanup?.();
    } catch (e) {
        // ignore
    }
    try {
        waiter.resolve?.({ aborted: true, reason });
    } catch (e) {
        // ignore
    }
    scrapeWaiters.delete(tabId);
}

// ============================================================
// AUTH CHECK UTILITIES
// ============================================================

/**
 * Wait for content script to be ready by pinging it
 * @param {number} tabId - Tab ID to check
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} retryDelayMs - Delay between retries in milliseconds
 * @returns {Promise<boolean>} True if content script is ready
 */
async function waitForContentScriptReady(tabId, maxRetries = 10, retryDelayMs = 1000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, {
                action: MESSAGE_ACTIONS.PING
            });
            if (response?.success || response?.status === 'alive') {
                console.log(`${LOG} Content script ready (attempt ${attempt + 1})`);
                return true;
            }
        } catch (error) {
            // Expected error if content script not ready yet
            if (error.message?.includes('Could not establish connection')) {
                if (attempt < maxRetries - 1) {
                    console.log(`${LOG} Content script not ready yet, waiting ${retryDelayMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                    continue;
                } else {
                    console.error(`${LOG} Content script never became ready after ${maxRetries} attempts`);
                    return false;
                }
            } else {
                // Unexpected error
                throw error;
            }
        }
    }
    return false;
}

async function checkLinkedInAuthBeforeScrape(tabId, sourceName) {
    try {
        const authStatus = await chrome.tabs.sendMessage(tabId, {
            action: MESSAGE_ACTIONS.CHECK_LINKEDIN_AUTH
        });

        if (authStatus?.status === 'signed_out') {
            await notifyLinkedInSignedOut(`${authStatus.message || 'Signed out'} (${authStatus.url || 'unknown url'})`, sourceName).catch(() => {});
            return { ok: false, status: 'signed_out', message: authStatus.message || 'LinkedIn signed out' };
        }

        if (authStatus?.status === 'checkpoint') {
            await notifyLinkedInCheckpoint(`${authStatus.message || 'Checkpoint'} (${authStatus.url || 'unknown url'})`, sourceName).catch(() => {});
            return { ok: false, status: 'checkpoint', message: authStatus.message || 'LinkedIn checkpoint detected' };
        }

        return { ok: true, status: authStatus?.status || 'ok', message: authStatus?.message || 'Authenticated' };
    } catch (error) {
        // Content script might not be injected yet, or tab navigated mid-flight.
        // Fallback to URL-based detection.
        try {
            const tab = await chrome.tabs.get(tabId);
            const url = tab?.url || '';

            if (url.includes('/login') || url.includes('/uas/login') || url.includes('/authwall') || url.includes('linkedin.com/m/login')) {
                await notifyLinkedInSignedOut(`Redirected to login/authwall (${url})`, sourceName).catch(() => {});
                return { ok: false, status: 'signed_out', message: `Redirected to login/authwall (${url})` };
            }

            if (url.includes('/checkpoint/') || url.includes('/challenge/') || url.includes('/security/') || url.includes('/uas/consumer-email-challenge')) {
                await notifyLinkedInCheckpoint(`Checkpoint/challenge URL detected (${url})`, sourceName).catch(() => {});
                return { ok: false, status: 'checkpoint', message: `Checkpoint/challenge URL detected (${url})` };
            }
        } catch (e) {
            // ignore
        }

        // If we can't determine, proceed (do not hard-fail due to messaging flake)
        console.warn(`${LOG} Auth check inconclusive (proceeding):`, error?.message || error);
        return { ok: true, status: 'unknown', message: 'Auth check inconclusive' };
    }
}

async function performStartupAuthChecks() {
    try {
        // Non-interactive on startup to avoid popping auth UI unexpectedly.
        await getAuthToken(false);
    } catch (e) {
        // Only notify for configuration issues, not transient errors
        const errorMsg = e?.message || String(e);
        if (errorMsg.includes('not configured') || errorMsg.includes('missing required field') || errorMsg.includes('Service account')) {
            await notifyGoogleAuthExpired(
                `Service account not configured on startup: ${errorMsg}. Configure service account in extension popup.`,
                null
            ).catch(() => {});
        }
        // Otherwise, just log it (might be a transient network issue)
        console.warn(`${LOG} Startup auth check failed (non-critical): ${errorMsg}`);
    }
}

// ============================================================
// AUTO-RUN RESUME FINALIZATION (fixes "stuck running" after reload)
// ============================================================
async function resumeAutoRunAfterReload() {
    try {
        console.log(`${LOG} Resuming auto-run after reload`);
        chrome.alarms.create(ALARM_NAMES.AUTO_RUN_KEEPALIVE, { periodInMinutes: 0.3 });

        await processAutoRunQueue();

        // Finalize state (processAutoRunQueue does not clear isRunning on its own)
        const { autoRunState: latest } = await getFromStorage(['autoRunState']);
        const executionId = latest?.executionId || null;
        const sourceName = latest?.config?.sources?.[0] || latest?.progress?.currentSource || 'Unknown Source';
        const totalProfiles = latest?.progress?.totalProfiles || 0;
        const totalSearches = latest?.progress?.totalSearches || 0;
        const completedSearches = latest?.progress?.completedSearches || totalSearches || 0;

        // Mark auto-run as not running
        autoRunState = {
            ...(latest || autoRunState),
            isRunning: false
        };
        await saveToStorage({ autoRunState });
        chrome.alarms.clear(ALARM_NAMES.AUTO_RUN_KEEPALIVE);

        // Complete execution record + notification (only if we have an executionId)
        if (executionId) {
            await updateExecutionRecord(executionId, {
                status: 'completed',
                searchesCompleted: completedSearches,
                profilesScraped: totalProfiles,
                completedAt: new Date().toISOString()
            });
            await notifyScheduleCompleted(sourceName, totalProfiles, totalSearches).catch(() => {});
        }
    } catch (error) {
        console.error(`${LOG} Auto-run resume error:`, error);
        try {
            autoRunState.isRunning = false;
            await saveToStorage({ autoRunState });
            chrome.alarms.clear(ALARM_NAMES.AUTO_RUN_KEEPALIVE);
        } catch (_) {}
    } finally {
        // After any resume attempt, try to run pending schedules
        await processPendingSchedules();
    }
}

// ============================================================
// STORAGE HELPERS
// ============================================================
async function saveToStorage(data) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(data, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve();
            }
        });
    });
}

async function getFromStorage(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });
}

// ============================================================
// ALARM MANAGEMENT
// ============================================================
function startKeepAlive() {
    console.log(`${LOG} Starting keep-alive alarm`);
    chrome.alarms.create(ALARM_NAMES.KEEPALIVE, { 
        periodInMinutes: CONFIG.KEEPALIVE_INTERVAL_MINUTES 
    });
    isScrapingActive = true;
}

function stopKeepAlive() {
    console.log(`${LOG} Stopping keep-alive alarm`);
    chrome.alarms.clear(ALARM_NAMES.KEEPALIVE);
    isScrapingActive = false;
}

function startQueueProcessor() {
    console.log(`${LOG} Starting queue processor`);
    chrome.alarms.create(ALARM_NAMES.QUEUE_PROCESS, { 
        periodInMinutes: CONFIG.QUEUE_PROCESS_INTERVAL_MINUTES 
    });
}

function startScheduleChecker() {
    console.log(`${LOG} Starting schedule checker`);
    chrome.alarms.create(ALARM_NAMES.SCHEDULE_CHECK, { 
        periodInMinutes: CONFIG.SCHEDULE_CHECK_INTERVAL_MINUTES 
    });
}

// ============================================================
// ALARM HANDLER
// ============================================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
    switch (alarm.name) {
        case ALARM_NAMES.KEEPALIVE:
            console.log(`${LOG} Keep-alive ping`);
            break;
            
        case ALARM_NAMES.QUEUE_PROCESS:
            console.log(`${LOG} Queue process tick`);
            try {
                const result = await processQueue();
                if (result.synced > 0 || result.failed > 0) {
                    chrome.runtime.sendMessage({
                        action: 'QUEUE_UPDATED',
                        ...result
                    }).catch(() => {});
                }
            } catch (e) {
                console.error(`${LOG} Queue process error:`, e);
            }
            break;

        case ALARM_NAMES.WORKBOOK_SYNC:
            console.log(`${LOG} 🔄 Workbook sync alarm triggered`);
            try {
                // IMPORTANT: Skip sync if scraping is active (prevent race conditions)
                const { autoRunState: ars, manualScrapeState: mss } = await getFromStorage([
                    'autoRunState', 'manualScrapeState'
                ]);
                if (ars?.isRunning || mss?.isRunning) {
                    console.log(`${LOG} ⏸️ Skipping sync - scrape in progress`);
                    break;
                }

                const result = await syncWorkbookConfig();
                if (result?.changes?.length) {
                    chrome.action.setBadgeText({ text: '!' });
                    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
                }
            } catch (e) {
                console.error(`${LOG} Workbook sync alarm error:`, e);
            }
            break;
            
        case ALARM_NAMES.SCHEDULE_CHECK:
            console.log(`${LOG} Schedule check tick`);
            try {
                // OVERLAP PROTECTION: Skip if already running
                const currentState = await getFromStorage(['autoRunState', 'manualScrapeState']);
                const isRunning = currentState.autoRunState?.isRunning || currentState.manualScrapeState?.isRunning;
                
                // If something is running, ONLY queue newly-due regular schedules.
                // Do NOT re-process already pending schedules every minute (avoids log spam and confusion).
                if (isRunning) {
                    const runningSourceName =
                        currentState.autoRunState?.isRunning ? (currentState.autoRunState?.config?.sources?.[0] || null) :
                        currentState.manualScrapeState?.isRunning ? (currentState.manualScrapeState?.sourceName || null) :
                        null;

                    const dueSchedules = await checkSchedules(false, runningSourceName);
                    if (dueSchedules.length > 0) {
                        const pendingBefore = await getPendingSchedules();
                        const beforeIds = new Set(pendingBefore.map(s => s.id));
                        for (const schedule of dueSchedules) {
                            await addPendingSchedule(schedule);
                        }
                        const pendingAfter = await getPendingSchedules();
                        const newlyQueued = pendingAfter.filter(s => !beforeIds.has(s.id)).length;
                        console.log(`${LOG} ⏸️ Scrape already in progress, queued ${newlyQueued} new schedule(s) for later`);
                    }
                    break;
                }

                // Nothing running: if we have pending schedules, run them first.
                const pending = await getPendingSchedules();
                if (pending.length > 0) {
                    await processPendingSchedules();
                    break;
                }

                // Otherwise, run any currently-due schedules.
                const schedulesToRun = await checkSchedules(false, null);
                for (const schedule of schedulesToRun) {
                    // Re-check state before each schedule (in case something started)
                    const stateCheck = await getFromStorage(['autoRunState', 'manualScrapeState']);
                    if (stateCheck.autoRunState?.isRunning || stateCheck.manualScrapeState?.isRunning) {
                        await addPendingSchedule(schedule);
                        break;
                    }
                    console.log(`${LOG} 🚀 Triggering scheduled run for ${schedule.sourceName}`);
                    await executeScheduledRun(schedule);
                }
            } catch (e) {
                console.error(`${LOG} Schedule check error:`, e);
            }
            break;
            
        case ALARM_NAMES.AUTO_RUN_KEEPALIVE:
            console.log(`${LOG} Auto-run keep-alive ping`);
            const stored = await getFromStorage(['autoRunState']);
            if (!stored.autoRunState?.isRunning) {
                chrome.alarms.clear(ALARM_NAMES.AUTO_RUN_KEEPALIVE);
            }
            break;

        case ALARM_NAMES.TOKEN_REFRESH:
            console.log(`${LOG} Token refresh check`);
            try {
                await refreshTokenIfNeeded();
            } catch (e) {
                console.warn(`${LOG} Token refresh check failed:`, e?.message || e);
            }
            break;
    }
});

// ============================================================
// EXTENSION LIFECYCLE (Live Sync alarm restore)
// ============================================================
chrome.runtime.onInstalled.addListener(async () => {
    try {
        console.log(`${LOG} Extension installed/updated`);
        const cfg = await getWorkbookConfig();
        if (cfg?.workbookId) {
            const syncInterval = await getSyncInterval();
            chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, { periodInMinutes: syncInterval });
            console.log(`${LOG} Workbook sync alarm created on install (${syncInterval} min)`);
        }
    } catch (e) {
        console.warn(`${LOG} onInstalled workbook alarm restore failed:`, e?.message || e);
    }
});

chrome.runtime.onStartup.addListener(async () => {
    try {
        console.log(`${LOG} Extension startup`);
        const cfg = await getWorkbookConfig();
        if (cfg?.workbookId) {
            const syncInterval = await getSyncInterval();
            chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, { periodInMinutes: syncInterval });
            console.log(`${LOG} Workbook sync alarm restored (${syncInterval} min)`);
        }
    } catch (e) {
        console.warn(`${LOG} onStartup workbook alarm restore failed:`, e?.message || e);
    }
});

// ============================================================
// SCHEDULED EXECUTION
// ============================================================
async function executeScheduledRun(schedule) {
    console.log(`${LOG} Executing scheduled run for ${schedule.sourceName}`);
    
    // Ensure Google OAuth token is fresh before starting (prevents mid-scrape re-auth)
    try {
        await ensureFreshToken();
        console.log(`${LOG} ✅ Google OAuth token verified before scheduled run`);
    } catch (e) {
        console.error(`${LOG} ❌ Failed to ensure fresh token before scheduled run: ${e.message}`);
        await notifyGoogleAuthExpired(
            `Cannot start scheduled run: Google authentication required. ${e.message}`,
            schedule.sourceName
        ).catch(() => {});
        throw new Error(`Google authentication required: ${e.message}`);
    }
    
    // Create execution record
    const execution = await addExecutionRecord({
        scheduleId: schedule.id,
        sourceName: schedule.sourceName,
        totalSearches: 0  // Will be updated when we load searches
    });
    
    // Mark schedule as running
    await markScheduleRun(schedule.id, execution.id);
    
    // Send start notification
    await notifyScheduleStarted(schedule.sourceName, 0);
    
    try {
        // Load searches for this source from input sheet
        const { inputSheetId, sourceMapping } = await getFromStorage([
            STORAGE_KEYS.INPUT_SHEET_ID, 
            STORAGE_KEYS.SOURCE_MAPPING
        ]);
        
        if (!inputSheetId) {
            throw new Error('No input sheet configured');
        }
        
        // Read searches from input sheet (prefer Searches tab, fallback to Sheet1)
        const searchData = await readSheet(inputSheetId, "'Searches'!A:C")
            .catch(() => readSheet(inputSheetId, 'Sheet1!A:C'));
        let searches = searchData.slice(1) // Skip header
            .filter(row => row[0] === schedule.sourceName)
            .map(row => ({
                source: row[0],
                title: row[1],
                url: row[2]
            }));

        // Test mode: run only one selected search for fast overlap testing
        if (schedule.testEnabled === true) {
            const testUrl = schedule.testSearchUrl;
            const testTitle = schedule.testSearchTitle || 'Test Search';

            if (testUrl) {
                searches = [{
                    source: schedule.sourceName,
                    title: testTitle,
                    url: testUrl
                }];
            } else if (searches.length > 0) {
                // Fallback to first search if none selected
                searches = [searches[0]];
            }
        }
        
        if (searches.length === 0) {
            throw new Error(`No searches found for ${schedule.sourceName}`);
        }
        
        // Update execution with search count
        await updateExecutionRecord(execution.id, { totalSearches: searches.length });
        
        // Get workbook for this source
        const workbookId = sourceMapping?.[schedule.sourceName];
        if (!workbookId) {
            throw new Error(`No workbook mapped for ${schedule.sourceName}`);
        }
        
        // Ensure weekly tab exists
        const { tabName } = await ensureWeeklyTab(workbookId);
        
        // Update execution record with workbook and tab info
        await updateExecutionRecord(execution.id, {
            workbookId: workbookId,
            tabName: tabName
        });
        
        // Update state for auto-run
        autoRunState = {
            isRunning: true,
            isAborted: false,
            executionId: execution.id, // Store execution ID for live updates
            config: {
                sources: [schedule.sourceName],
                groupedSearches: { [schedule.sourceName]: searches },
                scrapeOptions: {
                    maxPages: schedule.testEnabled === true && typeof schedule.testMaxPages === 'number'
                        ? schedule.testMaxPages
                        : null
                }
            },
            progress: {
                currentSource: schedule.sourceName,
                currentSourceIndex: 0,
                currentSearchIndex: 0,
                completedSearches: 0,
                totalSearches: searches.length,
                totalProfiles: 0
            }
        };
        await saveToStorage({ autoRunState });
        
        // Start keep-alive
        chrome.alarms.create(ALARM_NAMES.AUTO_RUN_KEEPALIVE, { periodInMinutes: 0.3 });
        
        // Process searches
        await processAutoRunQueue();
        
        // Get final stats
        const finalState = await getFromStorage(['autoRunState']);
        const profilesScraped = finalState.autoRunState?.progress?.totalProfiles || 0;
        
        // Update execution record
        await updateExecutionRecord(execution.id, {
            status: 'completed',
            searchesCompleted: searches.length,
            profilesScraped
        });
        
        // Send completion notification
        await notifyScheduleCompleted(schedule.sourceName, profilesScraped, searches.length);
        
    } catch (error) {
        console.error(`${LOG} Scheduled run failed:`, error);
        
        await updateExecutionRecord(execution.id, {
            status: 'failed',
            error: error.message
        });
        
        await notifyScheduleFailed(schedule.sourceName, error);
    } finally {
        // Clear keep-alive
        chrome.alarms.clear(ALARM_NAMES.AUTO_RUN_KEEPALIVE);
        
        // Reset state
        autoRunState.isRunning = false;
        await saveToStorage({ autoRunState });
        
        // Check for pending schedules and run the next one
        await processPendingSchedules();
    }
}

// ============================================================
// DEDICATED SCRAPE TAB MANAGEMENT
// ============================================================

/**
 * Get or create the dedicated scrape tab
 * Always uses the same tab for scraping to avoid opening new tabs
 * @returns {Promise<chrome.tabs.Tab>} The dedicated scrape tab
 */
async function getOrCreateDedicatedScrapeTab() {
    // Check if we have a saved tab ID
    const stored = await getFromStorage([STORAGE_KEYS.DEDICATED_SCRAPE_TAB_ID]);
    let tabId = stored[STORAGE_KEYS.DEDICATED_SCRAPE_TAB_ID];
    
    if (tabId) {
        // Try to use the saved tab
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && !tab.url?.includes('chrome://') && !tab.url?.includes('chrome-extension://')) {
                // Tab exists and is valid, make it active
                await chrome.tabs.update(tabId, { active: true });
                return tab;
            }
        } catch (error) {
            // Tab was closed or doesn't exist, will create new one
            console.log(`${LOG} Saved tab ${tabId} no longer exists, creating new dedicated tab`);
        }
    }
    
    // Create a new dedicated tab
    console.log(`${LOG} Creating new dedicated scrape tab`);
    const newTab = await chrome.tabs.create({ 
        url: 'https://www.linkedin.com',
        active: true 
    });
    
    // Save the tab ID for future use
    await saveToStorage({ [STORAGE_KEYS.DEDICATED_SCRAPE_TAB_ID]: newTab.id });
    
    // Wait for tab to load
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    return newTab;
}

// ============================================================
// NOISE ACTIVITY (Anti-Detection)
// ============================================================
async function performNoiseActivity(tabId) {
    if (!CONFIG.NOISE_ACTIVITY_ENABLED) return;
    if (Math.random() > CONFIG.NOISE_CHANCE) return;
    
    const noiseUrl = CONFIG.NOISE_URLS[Math.floor(Math.random() * CONFIG.NOISE_URLS.length)];
    const duration = (CONFIG.NOISE_MIN_DURATION_SECONDS + 
        Math.random() * (CONFIG.NOISE_MAX_DURATION_SECONDS - CONFIG.NOISE_MIN_DURATION_SECONDS)) * 1000;
    
    console.log(`${LOG} 🎭 Noise activity: browsing ${noiseUrl} for ${(duration/1000).toFixed(0)}s`);
    
    try {
        await chrome.tabs.update(tabId, { url: noiseUrl });
        await new Promise(resolve => setTimeout(resolve, duration));
    } catch (e) {
        console.log(`${LOG} Noise activity skipped:`, e.message);
    }
}

function getSearchDelay() {
    const min = CONFIG.BETWEEN_SEARCH_MIN_SECONDS * 1000;
    const max = CONFIG.BETWEEN_SEARCH_MAX_SECONDS * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Process pending schedules that were deferred due to overlap
 * Runs the next schedule in the queue if nothing is currently running
 */
async function processPendingSchedules() {
    // Prevent re-entrancy (can be called from multiple places)
    if (processPendingSchedules._isRunning) return;
    processPendingSchedules._isRunning = true;

    try {
        while (true) {
            // Check if something is running
            const currentState = await getFromStorage(['autoRunState', 'manualScrapeState']);
            if (currentState.autoRunState?.isRunning || currentState.manualScrapeState?.isRunning) {
                return; // Still running, don't process pending
            }

            const pending = await getPendingSchedules();
            if (pending.length === 0) {
                return; // No pending schedules
            }

            // Get the first pending schedule (oldest queued)
            const nextSchedule = pending[0];
            const { queuedAt, ...schedule } = nextSchedule;

            // Validate against latest stored schedule and drop stale queue entries
            const schedules = await getSchedules();
            const latest = schedules.find(s => s.id === schedule.id);
            if (!latest || !latest.enabled) {
                console.log(`${LOG} 🧹 Dropping pending schedule ${schedule.sourceName} - no longer exists or disabled`);
                await removePendingSchedule(schedule.id);
                continue;
            }

            // If the schedule has run AFTER it was queued, this pending entry is stale and should be dropped.
            // This is safer than a blanket "ran recently" check (which can break test-mode re-runs).
            if (queuedAt && latest.lastRun) {
                const queuedAtTime = new Date(queuedAt).getTime();
                const lastRunTime = new Date(latest.lastRun).getTime();
                if (Number.isFinite(queuedAtTime) && Number.isFinite(lastRunTime) && lastRunTime > queuedAtTime) {
                    console.log(`${LOG} 🧹 Dropping stale pending schedule ${latest.sourceName} - it ran after being queued`);
                    await removePendingSchedule(latest.id);
                    continue;
                }
            }

            console.log(`${LOG} 🔄 Processing pending schedule: ${latest.sourceName} (was queued at ${queuedAt})`);

            // Remove from queue before executing
            await removePendingSchedule(latest.id);

            // Execute the schedule (this will set autoRunState.isRunning true)
            try {
                await executeScheduledRun(latest);
            } catch (error) {
                console.error(`${LOG} Failed to execute pending schedule ${latest.sourceName}:`, error);
                // Stop processing to avoid tight loops; next alarm tick will retry
                return;
            }
        }
    } finally {
        processPendingSchedules._isRunning = false;
    }
}

// ============================================================
// AUTO-RUN QUEUE PROCESSOR
// ============================================================
async function processAutoRunQueue() {
    console.log(`${LOG} Starting auto-run queue processor`);
    
    const stored = await getFromStorage(['autoRunState', 'sourceMapping']);
    let state = stored.autoRunState;
    const mapping = stored.sourceMapping || {};
    
    if (!state?.isRunning) {
        console.log(`${LOG} Auto-run not active`);
        return;
    }
    
    // Ensure Google OAuth token is fresh before processing (prevents mid-scrape re-auth)
    // Only check once per auto-run session (not on every queue tick)
    if (!state.tokenChecked) {
        try {
            await ensureFreshToken();
            console.log(`${LOG} ✅ Google OAuth token verified before auto-run`);
            state.tokenChecked = true;
            await saveToStorage({ autoRunState: state });
        } catch (e) {
            console.error(`${LOG} ❌ Failed to ensure fresh token before auto-run: ${e.message}`);
            await notifyGoogleAuthExpired(
                `Cannot start auto-run: Google authentication required. ${e.message}`,
                state.config?.sources?.[0] || 'Unknown'
            ).catch(() => {});
            state.isRunning = false;
            state.error = `Google authentication required: ${e.message}`;
            await saveToStorage({ autoRunState: state });
            return;
        }
    }
    
    const { config, progress } = state;
    const { sources, groupedSearches } = config;
    const maxPagesOverride = config?.scrapeOptions?.maxPages;
    
    // Process each search
    // WORKBOOK RESOLUTION: For each source, look up workbookId from sourceMapping
    // Source mapping is set via SET_SOURCE_MAPPING message from popup
    // If no mapping exists, the source's searches are skipped
    for (const source of sources) {
        const searches = groupedSearches[source] || [];
        const workbookId = mapping[source];
        
        if (!workbookId) {
            console.error(`${LOG} No workbook mapped for source "${source}", skipping ${searches.length} searches`);
            continue;
        }
        
        // Ensure weekly tab
        const { tabName } = await ensureWeeklyTab(workbookId);
        
        for (let i = progress.currentSearchIndex; i < searches.length; i++) {
            // Check for abort
            const currentState = await getFromStorage(['autoRunState']);
            if (currentState.autoRunState?.isAborted) {
                console.log(`${LOG} Auto-run aborted`);
                return;
            }
            
            const search = searches[i];
            console.log(`${LOG} Processing search ${i + 1}/${searches.length}: ${search.title}`);
            
            // Update progress
            progress.currentSearchIndex = i;
            await saveToStorage({ autoRunState: { ...state, progress } });
            
            // Navigate to search URL using dedicated scrape tab
            const tab = await getOrCreateDedicatedScrapeTab();
            await chrome.tabs.update(tab.id, { url: search.url });
            
            // Wait for page load
            await new Promise(resolve => setTimeout(resolve, 6000));
            
            // Wait for content script to be ready before sending messages
            const contentScriptReady = await waitForContentScriptReady(tab.id, 10, 1000);
            if (!contentScriptReady) {
                throw new Error(`Content script not ready after navigation to ${search.url}`);
            }

            // Auth gate (LinkedIn signed out / checkpoint)
            const authCheck = await checkLinkedInAuthBeforeScrape(tab.id, source);
            if (!authCheck.ok) {
                throw new Error(`LinkedIn auth failure (${authCheck.status}): ${authCheck.message}`);
            }
            
            // Send scraping command
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    action: MESSAGE_ACTIONS.START_SCRAPING,
                    sourceName: source,
                    maxPages: maxPagesOverride || undefined
                });
                
                // Wait for scraping to complete (listen for SCRAPING_COMPLETE)
                // Reduced timeout to 30 minutes (was 30 min, keeping same but adding better logging)
                const result = await waitForScrapingComplete(tab.id, 1800000);
                
                if (result?.timeout) {
                    console.error(`${LOG} ⚠️ Scraping timed out after 30 minutes - content script may be stuck`);
                    console.error(`${LOG} This usually means the scraper is stuck on the last page. Check content script logs.`);
                    // Continue to next search anyway to prevent getting stuck
                } else if (result?.aborted) {
                    console.log(`${LOG} Auto-run scrape aborted (${result.reason || 'unknown'})`);
                    return;
                }
                
            } catch (e) {
                console.error(`${LOG} Scraping error:`, e);
                // Continue to next search even on error to prevent getting stuck
            }
            
            // Update completed count
            progress.completedSearches++;
            
            // Update execution record with current progress
            const updatedState = await getFromStorage(['autoRunState']);
            if (updatedState.autoRunState?.executionId) {
                await updateExecutionRecord(updatedState.autoRunState.executionId, {
                    profilesScraped: progress.totalProfiles,
                    searchesCompleted: progress.completedSearches
                });
                
                // Notify popup of execution history update
                chrome.runtime.sendMessage({
                    action: MESSAGE_ACTIONS.EXECUTION_HISTORY_UPDATED
                }).catch(() => {});
            }
            
            // Random delay between searches (45-90 seconds)
            const delay = getSearchDelay();
            console.log(`${LOG} Waiting ${(delay/1000).toFixed(0)}s before next search...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Noise activity (40% chance) - browse LinkedIn naturally
            await performNoiseActivity(tab.id);
        }
        
        // Reset for next source
        progress.currentSearchIndex = 0;
    }
    
    console.log(`${LOG} Auto-run complete`);
}

// ============================================================
// MANUAL SCRAPE PROCESSOR (navigates through searches automatically)
// ============================================================
async function processManualScrape() {
    console.log(`${LOG} Starting manual scrape processor`);
    
    const stored = await getFromStorage(['manualScrapeState', STORAGE_KEYS.SOURCE_MAPPING]);
    let state = stored.manualScrapeState;
    const sourceMapping = stored[STORAGE_KEYS.SOURCE_MAPPING] || {};
    
    if (!state?.isRunning) {
        console.log(`${LOG} Manual scrape not active`);
        return;
    }
    
    // Ensure Google OAuth token is fresh before starting (prevents mid-scrape re-auth)
    // Only check once per manual scrape session
    if (!state.tokenChecked) {
        try {
            await ensureFreshToken();
            console.log(`${LOG} ✅ Google OAuth token verified before manual scrape`);
            state.tokenChecked = true;
            await saveToStorage({ manualScrapeState: state });
        } catch (e) {
            console.error(`${LOG} ❌ Failed to ensure fresh token before manual scrape: ${e.message}`);
            await notifyGoogleAuthExpired(
                `Cannot start manual scrape: Google authentication required. ${e.message}`,
                state.sourceName || 'Unknown'
            ).catch(() => {});
            state.isRunning = false;
            state.error = `Google authentication required: ${e.message}`;
            await saveToStorage({ manualScrapeState: state });
            return;
        }
    }
    
    const { sourceName, searches, currentSearchIndex, workbookId } = state;
    
    if (!workbookId) {
        console.error(`${LOG} No workbook mapped for source "${sourceName}"`);
        manualScrapeState.isRunning = false;
        await saveToStorage({ manualScrapeState });
        return;
    }
    
        // Ensure weekly tab and get tab name
        const { tabName } = await ensureWeeklyTab(workbookId);
        
        // Update execution record with workbook and tab info if it exists
        if (state.executionId) {
            await updateExecutionRecord(state.executionId, {
                workbookId: workbookId,
                tabName: tabName
            });
        }
        
        // Get or create dedicated scrape tab (always uses the same tab)
    const tab = await getOrCreateDedicatedScrapeTab();
    
    for (let i = currentSearchIndex; i < searches.length; i++) {
        // Check for abort
        const currentState = await getFromStorage(['manualScrapeState']);
        if (!currentState.manualScrapeState?.isRunning || currentState.manualScrapeState.isAborted) {
            console.log(`${LOG} Manual scrape aborted`);
            
            // Update execution record with current progress if aborted
            const abortedState = currentState.manualScrapeState || state;
            if (abortedState.executionId) {
                await updateExecutionRecord(abortedState.executionId, {
                    status: 'failed',
                    completedAt: new Date().toISOString(),
                    error: 'Manually aborted',
                    searchesCompleted: i,
                    profilesScraped: abortedState.totalProfiles || 0
                });
            }
            
            // Always reset state when aborted to prevent stuck state
            manualScrapeState.isRunning = false;
            manualScrapeState.isAborted = false;
            await saveToStorage({ manualScrapeState });
            
            // Process pending schedules after cleanup
            await processPendingSchedules();
            
            return;
        }
        
        const search = searches[i];
        console.log(`${LOG} Processing search ${i + 1}/${searches.length}: ${search.title}`);
        
        // Update progress
        state.currentSearchIndex = i;
        await saveToStorage({ manualScrapeState: state });
        
        // Send progress to popup
        chrome.runtime.sendMessage({
            action: MESSAGE_ACTIONS.MANUAL_SCRAPE_PROGRESS,
            progress: {
                completedSearches: i,
                totalSearches: searches.length,
                currentSearch: search.title
            }
        }).catch(() => {});
        
        // Navigate to search URL
        await chrome.tabs.update(tab.id, { url: search.url });
        
        // Wait for page load and content script injection
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Wait for content script to be ready before sending messages
        const contentScriptReady = await waitForContentScriptReady(tab.id, 10, 1000);
        if (!contentScriptReady) {
            throw new Error(`Content script not ready after navigation to ${search.url}`);
        }

        // Auth gate (LinkedIn signed out / checkpoint)
        const authCheck = await checkLinkedInAuthBeforeScrape(tab.id, sourceName);
        if (!authCheck.ok) {
            console.error(`${LOG} Auth check failed, stopping manual scrape: ${authCheck.status} - ${authCheck.message}`);

            // Update execution record if exists
            if (state.executionId) {
                await updateExecutionRecord(state.executionId, {
                    status: 'failed',
                    error: `Auth failure (${authCheck.status}): ${authCheck.message}`,
                    completedAt: new Date().toISOString()
                }).catch(() => {});
            }

            // Stop manual scrape cleanly
            state.isRunning = false;
            state.isAborted = false;
            await saveToStorage({ manualScrapeState: state });
            stopKeepAlive();

            // Run any pending schedules now that manual mode is stopped
            await processPendingSchedules();
            return;
        }
        
        // Send scraping command
        try {
            await chrome.tabs.sendMessage(tab.id, {
                action: MESSAGE_ACTIONS.START_SCRAPING,
                sourceName: sourceName
            });
            
            // Wait for scraping to complete
            const result = await waitForScrapingComplete(tab.id, 1800000);
            
            if (result?.timeout) {
                console.error(`${LOG} ⚠️ Scraping timed out after 30 minutes - content script may be stuck`);
                console.error(`${LOG} This usually means the scraper is stuck on the last page. Check content script logs.`);
                // Continue to next search anyway to prevent getting stuck
            } else if (result?.aborted) {
                console.log(`${LOG} Manual scrape aborted (${result.reason || 'unknown'})`);
                return;
            }
            
            // Reload state to get updated totalProfiles
            const updatedState = await getFromStorage(['manualScrapeState']);
            if (updatedState.manualScrapeState) {
                state = updatedState.manualScrapeState;
            }
            
        } catch (e) {
            const errorMessage = e?.message || String(e) || 'Unknown error';
            
            // Check if it's a content script connection error
            if (errorMessage.includes('Could not establish connection')) {
                console.error(`${LOG} Content script connection error for search "${search.title}": ${errorMessage}`);
                console.error(`${LOG} This usually means the content script wasn't injected or the tab navigated away`);
                
                // Try to check if tab still exists and is on LinkedIn
                try {
                    const tab = await chrome.tabs.get(tab.id);
                    console.log(`${LOG} Tab status: id=${tab.id}, url=${tab.url}, status=${tab.status}`);
                    
                    if (!tab.url?.includes('linkedin.com')) {
                        console.error(`${LOG} Tab is not on LinkedIn (${tab.url}), may have navigated away`);
                    }
                } catch (tabError) {
                    console.error(`${LOG} Could not get tab info:`, tabError);
                }
            } else {
                console.error(`${LOG} Scraping error for search "${search.title}":`, e);
            }
            
            // Send webhook notification for scraping errors
            await notifyScrapeFailed(
                'Search Process',
                search.title || 'Unknown Search',
                errorMessage.includes('Could not establish connection') ? 'content_script_error' : 'network_error',
                errorMessage,
                {
                    sourceName: sourceName, // Connection Source from Input Sheet
                    searchUrl: search.url,
                    searchIndex: i + 1,
                    totalSearches: searches.length,
                    errorStack: e?.stack
                }
            ).catch(err => console.error(`${LOG} Failed to send error webhook:`, err));
        }
        
        // Random delay between searches (45-90 seconds for anti-detection)
        const delay = getSearchDelay();
        console.log(`${LOG} Waiting ${(delay/1000).toFixed(0)}s before next search...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Noise activity between searches
        await performNoiseActivity(tab.id);
    }
    
    // Get final state to ensure we have the latest totalProfiles
    const finalState = await getFromStorage(['manualScrapeState']);
    const finalManualState = finalState.manualScrapeState || state;
    const totalProfilesScraped = finalManualState.totalProfiles || 0;
    
    console.log(`${LOG} Manual scrape complete: ${totalProfilesScraped} profiles from ${searches.length} searches`);
    
    // Update execution record with final stats
    if (finalManualState.executionId) {
        await updateExecutionRecord(finalManualState.executionId, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            searchesCompleted: searches.length,
            profilesScraped: totalProfilesScraped
        });
        
        // Send completion notification with correct total
        await notifyScheduleCompleted(sourceName, totalProfilesScraped, searches.length).catch(e => {
            console.error(`${LOG} Failed to send completion notification:`, e);
        });
    }
    
    manualScrapeState.isRunning = false;
    manualScrapeState.isAborted = false;
    await saveToStorage({ manualScrapeState });
    
    // Check for pending schedules after manual scrape completes
    await processPendingSchedules();
    
    // Send completion message
    chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.MANUAL_SCRAPE_PROGRESS,
        progress: {
            completedSearches: searches.length,
            totalSearches: searches.length,
            totalProfiles: totalProfilesScraped,
            completed: true
        }
    }).catch(() => {});
    
    chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.SCRAPING_COMPLETE,
        totalProfiles: totalProfilesScraped,
        totalPages: searches.length
    }).catch(() => {});
}

async function waitForScrapingComplete(tabId, timeout = 1800000) {
    return new Promise((resolve) => {
        // If there's already a waiter for this tab, abort it
        abortScrapeWait(tabId, 'replaced');

        const listener = (message, sender) => {
            if (sender.tab?.id === tabId && message.action === MESSAGE_ACTIONS.SCRAPING_COMPLETE) {
                cleanup();

                const profilesFromThisSearch = message.totalProfiles || 0;
                
                // Update total profiles for auto-run state
                getFromStorage(['autoRunState']).then(async ({ autoRunState }) => {
                    if (autoRunState?.progress) {
                        autoRunState.progress.totalProfiles += profilesFromThisSearch;
                        await saveToStorage({ autoRunState });
                        
                        // Update execution record with current profile count
                        if (autoRunState.executionId) {
                            await updateExecutionRecord(autoRunState.executionId, {
                                profilesScraped: autoRunState.progress.totalProfiles
                            });
                            
                            // Notify popup of execution history update
                            chrome.runtime.sendMessage({
                                action: MESSAGE_ACTIONS.EXECUTION_HISTORY_UPDATED
                            }).catch(() => {});
                        }
                    }
                });
                
                // Update total profiles for manual scrape state
                getFromStorage(['manualScrapeState']).then(async ({ manualScrapeState }) => {
                    if (manualScrapeState?.isRunning) {
                        manualScrapeState.totalProfiles = (manualScrapeState.totalProfiles || 0) + profilesFromThisSearch;
                        await saveToStorage({ manualScrapeState });
                        
                        // Update execution record with current profile count
                        if (manualScrapeState.executionId) {
                            await updateExecutionRecord(manualScrapeState.executionId, {
                                profilesScraped: manualScrapeState.totalProfiles
                            });
                            
                            // Notify popup of execution history update
                            chrome.runtime.sendMessage({
                                action: MESSAGE_ACTIONS.EXECUTION_HISTORY_UPDATED
                            }).catch(() => {});
                        }
                    }
                });
                
                // Also update execution record for auto-run if it exists
                getFromStorage(['autoRunState']).then(async ({ autoRunState }) => {
                    if (autoRunState?.isRunning && autoRunState?.executionId) {
                        const currentTotal = autoRunState.progress?.totalProfiles || 0;
                        // Note: auto-run executionId would need to be stored in autoRunState
                        // For now, we'll handle this in executeScheduledRun
                    }
                });

                resolve(message);
            }
        };

        const timeoutId = setTimeout(() => {
            cleanup();
            resolve({ timeout: true });
        }, timeout);

        function cleanup() {
            chrome.runtime.onMessage.removeListener(listener);
            clearTimeout(timeoutId);
            scrapeWaiters.delete(tabId);
        }

        scrapeWaiters.set(tabId, { resolve, cleanup });
        chrome.runtime.onMessage.addListener(listener);
    });
}

// ============================================================
// AUTO-RUN STATE MANAGEMENT
// ============================================================
async function updateAutoRunState(updates) {
    autoRunState = { ...autoRunState, ...updates };
    await saveToStorage({ autoRunState });
    
    chrome.runtime.sendMessage({
        action: MESSAGE_ACTIONS.AUTO_RUN_PROGRESS,
        progress: autoRunState.progress,
        isRunning: autoRunState.isRunning
    }).catch(() => {});
}

// ============================================================
// ACTION CLICK HANDLER (Open Side Panel)
// ============================================================
chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        console.log(`${LOG} Side panel opened`);
    } catch (error) {
        console.error(`${LOG} Failed to open side panel:`, error);
    }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action } = message;
    console.log(`${LOG} 📩 Received: ${action}`);
    
    (async () => {
        let response = { success: false };
        
        try {
            switch (action) {
                // --- KEEP-ALIVE ---
                case MESSAGE_ACTIONS.START_KEEPALIVE:
                    startKeepAlive();
                    response = { success: true };
                    break;
                    
                case MESSAGE_ACTIONS.STOP_KEEPALIVE:
                    stopKeepAlive();
                    response = { success: true };
                    break;
                
                // --- SCRAPING ---
                case MESSAGE_ACTIONS.DATA_SCRAPED: {
                    const { rows, pageNumber } = message;
                    console.log(`${LOG} Received ${rows.length} rows from page ${pageNumber}`);
                    
                    const { sourceMapping } = await getFromStorage([STORAGE_KEYS.SOURCE_MAPPING]);
                    const sourceName = rows[0]?.[4]; // Connection Source column
                    const workbookId = sourceMapping?.[sourceName] || currentOutputSheetId;
                    
                    if (workbookId) {
                        const { tabName } = await ensureWeeklyTab(workbookId);
                        await addToQueue(rows, workbookId, tabName);
                        
                        // Trigger immediate queue processing
                        processQueue().catch(e => console.error(`${LOG} Queue error:`, e));
                    }
                    
                    response = { success: true, queued: rows.length };
                    break;
                }
                
                case MESSAGE_ACTIONS.SCRAPE_ERROR: {
                    const { personName, searchName, failureType, error, errorDetails } = message;
                    console.error(`${LOG} Scrape error for ${personName} in ${searchName}:`, error);
                    
                    // Send webhook notification with detailed error info
                    await notifyScrapeFailed(
                        personName || 'Unknown Person',
                        searchName || 'Unknown Search',
                        failureType || 'unknown_error',
                        error || 'Unknown error',
                        {
                            sourceName: errorDetails?.sourceName || manualScrapeState.sourceName || 'Unknown Source', // Connection Source
                            ...errorDetails
                        }
                    ).catch(e => console.error(`${LOG} Failed to send error webhook:`, e));
                    
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.SCRAPING_COMPLETE: {
                    const { totalProfiles, totalPages, error } = message;
                    
                    if (error) {
                        console.error(`${LOG} Scraping completed with error:`, error);
                        // Send webhook notification for scraping failure
                        const currentSearch = manualScrapeState.searches?.[manualScrapeState.currentSearchIndex];
                        await notifyScrapeFailed(
                            'Scraping Process',
                            currentSearch?.title || 'Unknown Search',
                            'scraping_error',
                            error,
                            {
                                sourceName: manualScrapeState.sourceName || 'Unknown Source', // Connection Source
                                totalProfiles,
                                totalPages
                            }
                        ).catch(e => console.error(`${LOG} Failed to send error webhook:`, e));
                    } else {
                        console.log(`${LOG} Scraping complete: ${totalProfiles} profiles from ${totalPages} pages`);
                    }
                    
                    stopKeepAlive();
                    response = { success: true };
                    break;
                }
                
                case 'QUEUE_SYNC_FAILED': {
                    // Handle queue sync failures from sync_queue.js
                    const { queueItemId, spreadsheetId, tabName, rowsCount, error, retryCount, sourceName } = message;
                    console.error(`${LOG} Queue sync failed after ${retryCount} retries for item ${queueItemId}`);
                    
                    await notifyError(
                        new Error(`Queue sync failed after ${retryCount} retries: ${error}`),
                        {
                            queueItemId,
                            spreadsheetId,
                            tabName,
                            rowsCount,
                            retryCount,
                            sourceName: sourceName || 'Unknown Source' // Connection Source from Input Sheet
                        }
                    ).catch(e => console.error(`${LOG} Failed to send queue error webhook:`, e));
                    
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.GET_STATUS:
                    response = {
                        success: true,
                        isScrapingActive,
                        currentOutputSheetId,
                        currentTabName
                    };
                    break;
                
                // --- SHEETS ---
                case MESSAGE_ACTIONS.LOAD_INPUT_SHEET: {
                    const { sheetId } = message;
                    const validation = await validateSpreadsheet(sheetId);
                    
                    if (validation.valid) {
                        await saveToStorage({ [STORAGE_KEYS.INPUT_SHEET_ID]: sheetId });
                        response = { success: true, title: validation.title };
                    } else {
                        response = { success: false, error: validation.error };
                    }
                    break;
                }
                
                case MESSAGE_ACTIONS.GET_INPUT_SHEET_INFO: {
                    const { inputSheetId } = await getFromStorage([STORAGE_KEYS.INPUT_SHEET_ID]);
                    if (!inputSheetId) {
                        response = { success: true, sheetId: null, title: null };
                        break;
                    }
                    
                    try {
                        const title = await getSheetName(inputSheetId);
                        response = { success: true, sheetId: inputSheetId, title };
                    } catch (error) {
                        response = { success: true, sheetId: inputSheetId, title: null };
                    }
                    break;
                }
                
                case MESSAGE_ACTIONS.GET_SEARCHES: {
                    const { inputSheetId } = await getFromStorage([STORAGE_KEYS.INPUT_SHEET_ID]);
                    if (!inputSheetId) {
                        response = { success: false, error: 'No input sheet configured' };
                        break;
                    }
                    
                    const data = await readSheet(inputSheetId, "'Searches'!A:C")
                        .catch(() => readSheet(inputSheetId, 'Sheet1!A:C'));
                    const searches = data.slice(1).map(row => ({
                        source: row[0],
                        title: row[1],
                        url: row[2]
                    }));
                    
                    response = { success: true, searches };
                    break;
                }
                
                case MESSAGE_ACTIONS.ENSURE_WEEKLY_TAB: {
                    const { spreadsheetId } = message;
                    const result = await ensureWeeklyTab(spreadsheetId);
                    response = { success: true, ...result };
                    break;
                }
                
                case MESSAGE_ACTIONS.GET_TABS: {
                    const { spreadsheetId } = message;
                    const tabs = await getSheetTabs(spreadsheetId);
                    response = { success: true, tabs };
                    break;
                }
                
                case MESSAGE_ACTIONS.COMPARE_TABS: {
                    const { spreadsheetId, tab1Name, tab2Name, outputTabName, keyColumn } = message;
                    const result = await compareTabs(spreadsheetId, tab1Name, tab2Name, outputTabName, keyColumn);
                    response = result;
                    break;
                }
                
                case MESSAGE_ACTIONS.DEDUPLICATE: {
                    const { spreadsheetId, tabName } = message;
                    const result = await deduplicateSheet(spreadsheetId, tabName);
                    response = result;
                    break;
                }

                // --- LIVE WORKBOOK SYNC ---
                case MESSAGE_ACTIONS.GET_WORKBOOK_CONFIG: {
                    const stored = await getFromStorage([STORAGE_KEYS.WORKBOOK_CONFIG, STORAGE_KEYS.LAST_SYNC_CHANGES]);
                    response = {
                        success: true,
                        config: stored[STORAGE_KEYS.WORKBOOK_CONFIG] || null,
                        lastChanges: stored[STORAGE_KEYS.LAST_SYNC_CHANGES] || null
                    };
                    break;
                }

                case MESSAGE_ACTIONS.LOAD_WORKBOOK: {
                    const workbookUrl = message.workbookUrl;
                    if (!workbookUrl) throw new Error('Missing workbookUrl');

                    try {
                        console.log(`${LOG} ========================================`);
                        console.log(`${LOG} 📥 LOAD_WORKBOOK request received`);
                        console.log(`${LOG} Workbook URL: ${workbookUrl}`);
                        console.log(`${LOG} ========================================`);
                        
                        // Verify token is available before attempting to load
                        console.log(`${LOG} 🔍 Step 1: Checking token availability...`);
                        try {
                            const tokenCheck = await getAuthToken(false);
                            console.log(`${LOG} ✅ Token available (non-interactive check passed)`);
                        } catch (tokenError) {
                            console.log(`${LOG} ⚠️ Token not available via non-interactive: ${tokenError.message}`);
                            console.log(`${LOG} ℹ️ Will attempt interactive auth during workbook load if needed`);
                        }

                        console.log(`${LOG} 🔍 Step 2: Calling loadWorkbookConfig...`);
                        const config = await loadWorkbookConfig(workbookUrl);
                        console.log(`${LOG} ✅ loadWorkbookConfig completed`);

                        console.log(`${LOG} 🔍 Step 3: Setting up sync alarm...`);
                        // Create/refresh alarm AFTER successful load
                        const syncInterval = await getSyncInterval();
                        chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, { periodInMinutes: syncInterval });
                        console.log(`${LOG} ✅ Sync alarm created (${syncInterval} min interval)`);

                        console.log(`${LOG} 🔍 Step 4: Retrieving sync changes...`);
                        const stored = await getFromStorage([STORAGE_KEYS.LAST_SYNC_CHANGES]);
                        response = { success: true, config, changes: stored[STORAGE_KEYS.LAST_SYNC_CHANGES] || null };
                        console.log(`${LOG} ========================================`);
                        console.log(`${LOG} ✅ LOAD_WORKBOOK completed successfully`);
                        console.log(`${LOG} Connections: ${config?.stats?.totalConnections || 0}`);
                        console.log(`${LOG} Searches: ${config?.stats?.totalSearches || 0}`);
                        console.log(`${LOG} ========================================`);
                    } catch (error) {
                        console.error(`${LOG} ========================================`);
                        console.error(`${LOG} ❌ LOAD_WORKBOOK FAILED`);
                        console.error(`${LOG} Error: ${error?.message || String(error)}`);
                        console.error(`${LOG} Stack: ${error?.stack || 'No stack trace'}`);
                        console.error(`${LOG} ========================================`);
                        throw error; // Re-throw to be caught by outer handler
                    }
                    break;
                }

                case MESSAGE_ACTIONS.SYNC_WORKBOOK: {
                    const result = await syncWorkbookConfig();
                    if (result?.synced === false && result?.error) throw new Error(result.error);
                    response = { success: true, ...result };
                    break;
                }

                case MESSAGE_ACTIONS.CLEAR_WORKBOOK: {
                    await clearWorkbookConfig();
                    chrome.alarms.clear(ALARM_NAMES.WORKBOOK_SYNC);
                    response = { success: true };
                    break;
                }

                case MESSAGE_ACTIONS.SET_SYNC_INTERVAL: {
                    const minutes = Number(message.minutes);
                    if (!Number.isFinite(minutes)) throw new Error('Invalid minutes');

                    const newInterval = await setSyncInterval(minutes);

                    // If workbook configured, recreate alarm at new interval
                    const cfg = await getWorkbookConfig();
                    if (cfg?.workbookId) {
                        chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, { periodInMinutes: newInterval });
                    }

                    response = { success: true, minutes: newInterval };
                    break;
                }

                case MESSAGE_ACTIONS.GET_SYNC_STATUS: {
                    const cfg = await getWorkbookConfig();
                    response = { success: true, status: cfg?.syncStatus || 'none' };
                    break;
                }

                // --- SERVICE ACCOUNT ---
                case MESSAGE_ACTIONS.GET_SERVICE_ACCOUNT_STATUS: {
                    try {
                        const configured = await isServiceAccountConfigured();
                        const email = configured ? await getServiceAccountEmail() : null;
                        
                        let tokenValid = false;
                        if (message.testConnection && configured) {
                            try {
                                await getAuthToken();
                                tokenValid = true;
                            } catch (tokenError) {
                                response = { configured, email, tokenValid: false, error: tokenError.message };
                                break;
                            }
                        }
                        
                        response = { configured, email, tokenValid };
                    } catch (error) {
                        console.error(`${LOG} Error getting service account status:`, error);
                        response = { configured: false, error: error.message };
                    }
                    break;
                }

                case MESSAGE_ACTIONS.SETUP_SERVICE_ACCOUNT: {
                    try {
                        await setupServiceAccount(message.jsonKey);
                        const email = await getServiceAccountEmail();
                        console.log(`${LOG} Service account configured: ${email}`);
                        response = { success: true, email };
                    } catch (error) {
                        console.error(`${LOG} Error setting up service account:`, error);
                        response = { success: false, error: error.message };
                    }
                    break;
                }

                case MESSAGE_ACTIONS.CLEAR_SERVICE_ACCOUNT: {
                    try {
                        await chrome.storage.local.remove('serviceAccountCredentials');
                        await removeCachedToken(); // Clear any cached tokens
                        console.log(`${LOG} Service account credentials cleared`);
                        response = { success: true };
                    } catch (error) {
                        console.error(`${LOG} Error clearing service account:`, error);
                        response = { success: false, error: error.message };
                    }
                    break;
                }
                
                // --- WORKBOOKS ---
                case MESSAGE_ACTIONS.ADD_WORKBOOK: {
                    const { sheetId, sourceName } = message;
                    const validation = await validateSpreadsheet(sheetId);
                    
                    if (!validation.valid) {
                        response = { success: false, error: validation.error };
                        break;
                    }
                    
                    const { savedWorkbooks: existing } = await getFromStorage([STORAGE_KEYS.SAVED_WORKBOOKS]);
                    const workbooks = existing || [];
                    
                    // Check if already exists
                    if (workbooks.some(w => w.id === sheetId)) {
                        response = { success: false, error: 'Workbook already added' };
                        break;
                    }
                    
                    workbooks.push({
                        id: sheetId,
                        // Keep legacy "name" for existing UI paths, but also store Live Sync shape
                        name: validation.title,
                        title: validation.title,
                        url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
                        addedAt: new Date().toISOString()
                    });
                    
                    await saveToStorage({ [STORAGE_KEYS.SAVED_WORKBOOKS]: workbooks });
                    
                    // Also update source mapping if provided
                    if (sourceName) {
                        const { sourceMapping: existing } = await getFromStorage([STORAGE_KEYS.SOURCE_MAPPING]);
                        const mapping = existing || {};
                        mapping[sourceName] = sheetId;
                        await saveToStorage({ [STORAGE_KEYS.SOURCE_MAPPING]: mapping });
                    }
                    
                    response = { success: true, workbook: workbooks[workbooks.length - 1] };
                    break;
                }
                
                case MESSAGE_ACTIONS.REMOVE_WORKBOOK: {
                    const { sheetId } = message;
                    const { savedWorkbooks: existing } = await getFromStorage([STORAGE_KEYS.SAVED_WORKBOOKS]);
                    const workbooks = (existing || []).filter(w => w.id !== sheetId);
                    await saveToStorage({ [STORAGE_KEYS.SAVED_WORKBOOKS]: workbooks });
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.GET_WORKBOOKS: {
                    const { savedWorkbooks } = await getFromStorage([STORAGE_KEYS.SAVED_WORKBOOKS]);
                    response = { success: true, workbooks: savedWorkbooks || [] };
                    break;
                }
                
                case MESSAGE_ACTIONS.SET_SOURCE_MAPPING: {
                    const { sourceName, workbookId } = message;
                    const { sourceMapping: existing } = await getFromStorage([STORAGE_KEYS.SOURCE_MAPPING]);
                    const mapping = existing || {};
                    mapping[sourceName] = workbookId;
                    await saveToStorage({ [STORAGE_KEYS.SOURCE_MAPPING]: mapping });
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.GET_SOURCE_MAPPING: {
                    const { sourceMapping } = await getFromStorage([STORAGE_KEYS.SOURCE_MAPPING]);
                    response = { success: true, mapping: sourceMapping || {} };
                    break;
                }
                
                // --- AUTO-RUN ---
                case MESSAGE_ACTIONS.START_AUTO_RUN: {
                    const { sources, groupedSearches } = message;
                    
                    // WORKBOOK RESOLUTION FLOW:
                    // 1. Popup sends START_AUTO_RUN with sources and groupedSearches
                    // 2. processAutoRunQueue() looks up workbookId from sourceMapping[source]
                    // 3. If no workbook mapped, search is skipped with error log
                    // 4. Popup should verify all sources have workbook mappings before starting
                    autoRunState = {
                        isRunning: true,
                        isAborted: false,
                        config: { sources, groupedSearches },
                        progress: {
                            currentSourceIndex: 0,
                            currentSearchIndex: 0,
                            completedSearches: 0,
                            totalSearches: Object.values(groupedSearches).flat().length,
                            totalProfiles: 0
                        }
                    };
                    
                    await saveToStorage({ autoRunState });
                    chrome.alarms.create(ALARM_NAMES.AUTO_RUN_KEEPALIVE, { periodInMinutes: 0.3 });
                    
                    processAutoRunQueue().catch(e => {
                        console.error(`${LOG} Auto-run error:`, e);
                        updateAutoRunState({ isRunning: false, error: e.message });
                    });
                    
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.STOP_AUTO_RUN: {
                    autoRunState.isAborted = true;
                    autoRunState.isRunning = false;
                    await saveToStorage({ autoRunState });
                    chrome.alarms.clear(ALARM_NAMES.AUTO_RUN_KEEPALIVE);

                    // Try to stop the active content script scrape and unblock any waiter
                    try {
                        const stored = await getFromStorage([STORAGE_KEYS.DEDICATED_SCRAPE_TAB_ID]);
                        const tabId = stored[STORAGE_KEYS.DEDICATED_SCRAPE_TAB_ID];
                        if (tabId) {
                            abortScrapeWait(tabId, 'auto_run_stop');
                            await chrome.tabs.sendMessage(tabId, { action: MESSAGE_ACTIONS.STOP_SCRAPING }).catch(() => {});
                        }
                    } catch (e) {
                        // ignore
                    }

                    // Process pending schedules now that auto-run is stopped
                    await processPendingSchedules();
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.GET_AUTO_RUN_STATUS: {
                    const { autoRunState: state } = await getFromStorage(['autoRunState']);
                    response = { 
                        success: true, 
                        isRunning: state?.isRunning || false,
                        isAborted: state?.isAborted || false,
                        progress: state?.progress || null
                    };
                    break;
                }
                
                // --- MANUAL SCRAPE ---
                case MESSAGE_ACTIONS.START_MANUAL_SCRAPE: {
                    const { sourceName, searches } = message;
                    const { sourceMapping } = await getFromStorage([STORAGE_KEYS.SOURCE_MAPPING]);
                    const workbookId = sourceMapping?.[sourceName];
                    
                    if (!workbookId) {
                        response = { success: false, error: `No workbook mapped for ${sourceName}` };
                        break;
                    }
                    
                    // Create execution record for manual scrape
                    const execution = await addExecutionRecord({
                        scheduleId: null, // Manual scrape has no schedule
                        sourceName: sourceName,
                        totalSearches: searches.length
                    });
                    
                    manualScrapeState = {
                        isRunning: true,
                        isAborted: false,
                        sourceName,
                        searches,
                        currentSearchIndex: 0,
                        workbookId,
                        executionId: execution.id,
                        totalProfiles: 0
                    };
                    
                    await saveToStorage({ manualScrapeState });
                    startKeepAlive();
                    
                    processManualScrape().catch(e => {
                        console.error(`${LOG} Manual scrape error:`, e);
                        manualScrapeState.isRunning = false;
                        saveToStorage({ manualScrapeState });
                    });
                    
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.STOP_MANUAL_SCRAPE: {
                    manualScrapeState.isAborted = true;
                    manualScrapeState.isRunning = false; // Also set isRunning to false when stopping
                    await saveToStorage({ manualScrapeState });
                    stopKeepAlive();

                    // Stop the active content script scrape and unblock any waiter
                    try {
                        const stored = await getFromStorage([STORAGE_KEYS.DEDICATED_SCRAPE_TAB_ID]);
                        const tabId = stored[STORAGE_KEYS.DEDICATED_SCRAPE_TAB_ID];
                        if (tabId) {
                            abortScrapeWait(tabId, 'manual_stop');
                            await chrome.tabs.sendMessage(tabId, { action: MESSAGE_ACTIONS.STOP_SCRAPING }).catch(() => {});
                        }
                    } catch (e) {
                        // ignore
                    }
                    
                    // Process pending schedules now that manual scrape is stopped
                    await processPendingSchedules();
                    
                    response = { success: true };
                    break;
                }
                
                // --- SCHEDULES ---
                case MESSAGE_ACTIONS.GET_SCHEDULES: {
                    const schedules = await getSchedules();
                    response = { success: true, schedules };
                    break;
                }
                
                case MESSAGE_ACTIONS.SET_SCHEDULE: {
                    const { schedule } = message;

                    const validation = validateSchedule(schedule);
                    if (!validation.valid) {
                        response = { success: false, error: validation.error || 'Invalid schedule' };
                        break;
                    }

                    const result = await setSchedule(schedule);
                    response = { success: true, schedule: result };
                    break;
                }
                
                case MESSAGE_ACTIONS.DELETE_SCHEDULE: {
                    const { scheduleId } = message;
                    await deleteSchedule(scheduleId);
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.GET_EXECUTION_HISTORY: {
                    const { limit } = message;
                    const history = await getExecutionHistory(limit || 20);
                    
                    // Generate URLs for records that have workbookId and tabName (including running ones)
                    const historyWithUrls = await Promise.all(history.map(async (record) => {
                        if (record.workbookId && record.tabName) {
                            const url = await generateSheetUrlWithGid(record.workbookId, record.tabName);
                            return { ...record, sheetUrl: url };
                        }
                        return record;
                    }));
                    
                    response = { success: true, history: historyWithUrls };
                    break;
                }
                
                case MESSAGE_ACTIONS.TRIGGER_SCHEDULED_RUN: {
                    const { scheduleId } = message;
                    const schedules = await getSchedules();
                    const schedule = schedules.find(s => s.id === scheduleId);
                    
                    if (!schedule) {
                        response = { success: false, error: 'Schedule not found' };
                        break;
                    }
                    
                    executeScheduledRun(schedule);
                    response = { success: true, message: 'Scheduled run triggered' };
                    break;
                }
                
                // --- SETTINGS ---
                case MESSAGE_ACTIONS.SET_WEBHOOK_URL: {
                    const { url } = message;
                    await setWebhookUrl(url);
                    response = { success: true };
                    break;
                }
                
                case MESSAGE_ACTIONS.TEST_WEBHOOK: {
                    const result = await testWebhook();
                    response = result;
                    break;
                }
                
                // --- QUEUE ---
                case MESSAGE_ACTIONS.GET_QUEUE_STATUS: {
                    const status = await getQueueStatus();
                    response = { success: true, ...status };
                    break;
                }
                
                case MESSAGE_ACTIONS.RETRY_FAILED: {
                    const count = await retryFailedItems();
                    response = { success: true, retriedCount: count };
                    break;
                }
                
                case MESSAGE_ACTIONS.CLEAR_FAILED: {
                    const count = await clearFailedRows();
                    response = { success: true, clearedCount: count };
                    break;
                }
                
                // --- PING ---
                case MESSAGE_ACTIONS.PING:
                    response = { success: true, status: 'alive' };
                    break;
                
                default:
                    response = { success: false, error: `Unknown action: ${action}` };
            }
            
            sendResponse(response);
            
        } catch (error) {
            console.error(`${LOG} Error handling ${action}:`, error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    
    return true; // CRITICAL: Keep channel open for async response
});

// ============================================================
// INITIALIZATION
// ============================================================
(async () => {
    try {
        console.log(`${LOG} Initializing service worker...`);
        
        // Load state from storage
        const settings = await getFromStorage([
            STORAGE_KEYS.SAVED_WORKBOOKS,
            STORAGE_KEYS.SOURCE_MAPPING,
            'autoRunState'
        ]);
        
        savedWorkbooks = settings[STORAGE_KEYS.SAVED_WORKBOOKS] || [];
        sourceMapping = settings[STORAGE_KEYS.SOURCE_MAPPING] || {};
        autoRunState = settings.autoRunState || {
            isRunning: false,
            isAborted: false,
            config: null,
            progress: null
        };
        
        // Start background processors
        startQueueProcessor();
        startScheduleChecker();

        // Live Sync: restore alarm if workbook configured
        const storedSync = await getFromStorage([STORAGE_KEYS.WORKBOOK_CONFIG, STORAGE_KEYS.SYNC_INTERVAL_MINUTES]);
        const cfg = storedSync[STORAGE_KEYS.WORKBOOK_CONFIG];
        const interval = storedSync[STORAGE_KEYS.SYNC_INTERVAL_MINUTES] || 5;
        if (cfg?.workbookId) {
            chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, { periodInMinutes: interval });
            console.log(`${LOG} Workbook sync alarm restored from init (${interval} min)`);
        }

        // Startup auth checks (non-interactive)
        performStartupAuthChecks().catch(() => {});
        
        // Setup proactive token refresh alarm
        setupTokenRefreshAlarm().catch(() => {});
        
        // Clean up stuck states (isRunning but actually not running)
        const storedStates = await getFromStorage(['autoRunState', 'manualScrapeState']);
        let cleanedUp = false;
        
        // Check if manual scrape state is stuck (aborted but still marked as running)
        if (storedStates.manualScrapeState?.isAborted && storedStates.manualScrapeState?.isRunning) {
            console.log(`${LOG} 🧹 Cleaning up stuck manual scrape state (aborted but still marked as running)`);
            manualScrapeState = {
                isRunning: false,
                isAborted: false,
                sourceName: null,
                searches: [],
                currentSearchIndex: 0,
                workbookId: null,
                executionId: null,
                totalProfiles: 0
            };
            await saveToStorage({ manualScrapeState });
            cleanedUp = true;
        }
        
        // Resume auto-run if it was running
        if (autoRunState.isRunning && !autoRunState.isAborted) {
            // Important: on reload we must finalize/clear state ourselves, otherwise it stays "running" forever.
            resumeAutoRunAfterReload().catch(() => {});
        }
        
        // Process pending schedules if we cleaned up a stuck state
        if (cleanedUp) {
            await processPendingSchedules();
        }
        
        console.log(`${LOG} ✅ Service worker initialized (${SERVICE_WORKER_VERSION})`);
        console.log(`${LOG}    Workbooks: ${savedWorkbooks.length}`);
        console.log(`${LOG}    Mappings: ${Object.keys(sourceMapping).length}`);
        
    } catch (error) {
        console.error(`${LOG} Init error:`, error);
    }
})();
