// background/service_worker.js - Main Service Worker Orchestrator

// ============================================================
// IMPORTS
// ============================================================
import { getAuthToken, removeCachedToken } from './auth.js';
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
    generateSheetUrlWithGid
} from './scheduler.js';
import {
    setWebhookUrl, getWebhookUrl, testWebhook,
    notifyScheduleStarted, notifyScheduleCompleted, notifyScheduleFailed, notifyError,
    notifyScrapeFailed
} from './notifications.js';
import { CONFIG, ALARM_NAMES, MESSAGE_ACTIONS, STORAGE_KEYS, LOG_PREFIXES } from '../utils/constants.js';

const LOG = LOG_PREFIXES.SERVICE_WORKER;

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
            
        case ALARM_NAMES.SCHEDULE_CHECK:
            console.log(`${LOG} Schedule check tick`);
            try {
                const schedulesToRun = await checkSchedules();
                for (const schedule of schedulesToRun) {
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
    }
});

// ============================================================
// SCHEDULED EXECUTION
// ============================================================
async function executeScheduledRun(schedule) {
    console.log(`${LOG} Executing scheduled run for ${schedule.sourceName}`);
    
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
        
        // Read searches from input sheet
        const searchData = await readSheet(inputSheetId, 'Sheet1!A:C');
        const searches = searchData.slice(1) // Skip header
            .filter(row => row[0] === schedule.sourceName)
            .map(row => ({
                source: row[0],
                title: row[1],
                url: row[2]
            }));
        
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
                groupedSearches: { [schedule.sourceName]: searches }
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
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return newTab;
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
    
    const { config, progress } = state;
    const { sources, groupedSearches } = config;
    
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
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Send scraping command
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    action: MESSAGE_ACTIONS.START_SCRAPING,
                    sourceName: source
                });
                
                // Wait for scraping to complete (listen for SCRAPING_COMPLETE)
                await waitForScrapingComplete(tab.id);
                
            } catch (e) {
                console.error(`${LOG} Scraping error:`, e);
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
            
            // Random delay between searches (30-60 seconds)
            const delay = 30000 + Math.random() * 30000;
            console.log(`${LOG} Waiting ${(delay/1000).toFixed(0)}s before next search...`);
            await new Promise(resolve => setTimeout(resolve, delay));
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
                    error: 'Manually aborted',
                    searchesCompleted: i,
                    profilesScraped: abortedState.totalProfiles || 0
                });
            }
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
        
        // Send scraping command
        try {
            await chrome.tabs.sendMessage(tab.id, {
                action: MESSAGE_ACTIONS.START_SCRAPING,
                sourceName: sourceName
            });
            
            // Wait for scraping to complete
            await waitForScrapingComplete(tab.id);
            
            // Reload state to get updated totalProfiles
            const updatedState = await getFromStorage(['manualScrapeState']);
            if (updatedState.manualScrapeState) {
                state = updatedState.manualScrapeState;
            }
            
        } catch (e) {
            console.error(`${LOG} Scraping error for search "${search.title}":`, e);
            
            // Send webhook notification for scraping errors
            await notifyScrapeFailed(
                'Search Process',
                search.title || 'Unknown Search',
                'network_error',
                e?.message || String(e) || 'Unknown error',
                {
                    sourceName: sourceName, // Connection Source from Input Sheet
                    searchUrl: search.url,
                    searchIndex: i + 1,
                    totalSearches: searches.length,
                    errorStack: e?.stack
                }
            ).catch(err => console.error(`${LOG} Failed to send error webhook:`, err));
        }
        
        // Random delay between searches (5-10 seconds for manual scrape)
        const delay = 5000 + Math.random() * 5000;
        console.log(`${LOG} Waiting ${(delay/1000).toFixed(1)}s before next search...`);
        await new Promise(resolve => setTimeout(resolve, delay));
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
        const startTime = Date.now();
        
        const listener = (message, sender) => {
            if (sender.tab?.id === tabId && message.action === MESSAGE_ACTIONS.SCRAPING_COMPLETE) {
                chrome.runtime.onMessage.removeListener(listener);
                
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
        
        chrome.runtime.onMessage.addListener(listener);
        
        // Timeout fallback
        setTimeout(() => {
            chrome.runtime.onMessage.removeListener(listener);
            resolve({ timeout: true });
        }, timeout);
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
                    
                    const data = await readSheet(inputSheetId, 'Sheet1!A:C');
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
                        name: validation.title,
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
                    await saveToStorage({ autoRunState });
                    chrome.alarms.clear(ALARM_NAMES.AUTO_RUN_KEEPALIVE);
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
                    await saveToStorage({ manualScrapeState });
                    stopKeepAlive();
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
        
        // Resume auto-run if it was running
        if (autoRunState.isRunning && !autoRunState.isAborted) {
            console.log(`${LOG} Resuming auto-run after reload`);
            chrome.alarms.create(ALARM_NAMES.AUTO_RUN_KEEPALIVE, { periodInMinutes: 0.3 });
            processAutoRunQueue().catch(error => {
                console.error(`${LOG} Auto-run resume error:`, error);
                updateAutoRunState({ isRunning: false, error: error.message });
            });
        }
        
        console.log(`${LOG} ✅ Service worker initialized`);
        console.log(`${LOG}    Workbooks: ${savedWorkbooks.length}`);
        console.log(`${LOG}    Mappings: ${Object.keys(sourceMapping).length}`);
        
    } catch (error) {
        console.error(`${LOG} Init error:`, error);
    }
})();
