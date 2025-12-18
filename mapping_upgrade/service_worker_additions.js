// ============================================================
// SERVICE WORKER ADDITIONS FOR LIVE SHEET SYNC
// Add these modifications to your existing background/service_worker.js
// ============================================================

// ============================================================
// STEP 1: ADD THIS IMPORT AT THE TOP (with other imports)
// ============================================================
/*
import {
    loadWorkbookConfig,
    syncWorkbookConfig,
    getWorkbookConfig,
    clearWorkbookConfig,
    setSyncInterval,
    getSyncInterval,
    detectConfigChanges,
    getSearchesForSource,
    getAllSources,
    getOutputSheetForSource,
    SYNC_CONFIG
} from './sheet_sync.js';
*/


// ============================================================
// STEP 2: ADD TO chrome.runtime.onInstalled LISTENER
// (Inside the existing onInstalled handler, add this block)
// ============================================================
/*
chrome.runtime.onInstalled.addListener(async () => {
    console.log(`${LOG} Extension installed/updated`);
    
    // ... your existing alarm setup code ...
    
    // NEW: Set up workbook sync alarm
    try {
        const syncInterval = await getSyncInterval();
        chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, {
            periodInMinutes: syncInterval
        });
        console.log(`${LOG} Workbook sync alarm set for every ${syncInterval} minutes`);
    } catch (e) {
        console.error(`${LOG} Error setting up sync alarm:`, e);
    }
});
*/


// ============================================================
// STEP 3: ADD TO chrome.alarms.onAlarm SWITCH STATEMENT
// (Add this case to your existing alarm handler)
// ============================================================
/*
chrome.alarms.onAlarm.addListener(async (alarm) => {
    switch (alarm.name) {
        // ... your existing alarm cases ...
        
        case ALARM_NAMES.WORKBOOK_SYNC:
            console.log(`${LOG} 🔄 Workbook sync alarm triggered`);
            try {
                const result = await syncWorkbookConfig();
                
                if (result.changes && result.changes.length > 0) {
                    // Notify UI of changes via badge
                    chrome.action.setBadgeText({ text: '!' });
                    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
                    
                    // Log changes
                    console.log(`${LOG} 📝 ${result.changes.length} change(s) detected:`);
                    result.changes.forEach(change => {
                        console.log(`${LOG}   ${change.message}`);
                    });
                }
            } catch (error) {
                console.error(`${LOG} Workbook sync error:`, error);
            }
            break;
    }
});
*/


// ============================================================
// STEP 4: ADD THESE MESSAGE HANDLERS TO YOUR SWITCH STATEMENT
// (Add these cases to your existing message handler in the
//  chrome.runtime.onMessage.addListener)
// ============================================================

// --- WORKBOOK SYNC MESSAGE HANDLERS ---

case MESSAGE_ACTIONS.LOAD_WORKBOOK: {
    const { workbookUrl } = message;
    try {
        console.log(`${LOG} Loading workbook: ${workbookUrl}`);
        const config = await loadWorkbookConfig(workbookUrl);
        
        // Restart sync alarm with current interval
        const syncInterval = await getSyncInterval();
        chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, {
            periodInMinutes: syncInterval
        });
        console.log(`${LOG} Sync alarm restarted (${syncInterval} min interval)`);
        
        response = { 
            success: true, 
            config,
            message: `Loaded ${config.stats.totalConnections} connections with ${config.stats.totalSearches} searches`
        };
    } catch (error) {
        console.error(`${LOG} Load workbook error:`, error);
        response = { success: false, error: error.message };
    }
    break;
}

case MESSAGE_ACTIONS.SYNC_WORKBOOK: {
    try {
        console.log(`${LOG} Manual sync triggered`);
        const result = await syncWorkbookConfig();
        
        // Clear badge after manual sync
        chrome.action.setBadgeText({ text: '' });
        
        response = { 
            success: true, 
            ...result 
        };
    } catch (error) {
        console.error(`${LOG} Sync error:`, error);
        response = { success: false, error: error.message };
    }
    break;
}

case MESSAGE_ACTIONS.GET_WORKBOOK_CONFIG: {
    try {
        const config = await getWorkbookConfig();
        const { lastSyncChanges } = await getFromStorage(['lastSyncChanges']);
        response = { 
            success: true, 
            config,
            lastChanges: lastSyncChanges || []
        };
    } catch (error) {
        console.error(`${LOG} Get config error:`, error);
        response = { success: false, error: error.message };
    }
    break;
}

case MESSAGE_ACTIONS.CLEAR_WORKBOOK: {
    try {
        await clearWorkbookConfig();
        chrome.alarms.clear(ALARM_NAMES.WORKBOOK_SYNC);
        console.log(`${LOG} Workbook config cleared and sync alarm stopped`);
        response = { success: true };
    } catch (error) {
        console.error(`${LOG} Clear workbook error:`, error);
        response = { success: false, error: error.message };
    }
    break;
}

case MESSAGE_ACTIONS.SET_SYNC_INTERVAL: {
    const { minutes } = message;
    try {
        const interval = await setSyncInterval(minutes);
        
        // Restart alarm with new interval
        chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, {
            periodInMinutes: interval
        });
        
        console.log(`${LOG} Sync interval updated to ${interval} minutes`);
        response = { success: true, interval };
    } catch (error) {
        console.error(`${LOG} Set interval error:`, error);
        response = { success: false, error: error.message };
    }
    break;
}

case MESSAGE_ACTIONS.GET_SYNC_STATUS: {
    try {
        const config = await getWorkbookConfig();
        const interval = await getSyncInterval();
        const alarm = await chrome.alarms.get(ALARM_NAMES.WORKBOOK_SYNC);
        
        response = {
            success: true,
            status: config?.syncStatus || 'not_configured',
            lastSync: config?.lastSync || null,
            lastError: config?.lastSyncError || null,
            syncInterval: interval,
            nextSync: alarm?.scheduledTime 
                ? new Date(alarm.scheduledTime).toISOString() 
                : null,
            stats: config?.stats || null
        };
    } catch (error) {
        console.error(`${LOG} Get sync status error:`, error);
        response = { success: false, error: error.message };
    }
    break;
}


// ============================================================
// STEP 5: OPTIONAL - UPDATE GET_SEARCHES TO USE SYNC DATA
// (Replace your existing GET_SEARCHES handler with this improved version
//  that tries synced config first, then falls back to legacy)
// ============================================================

case MESSAGE_ACTIONS.GET_SEARCHES: {
    try {
        // Try to get searches from unified config first
        const config = await getWorkbookConfig();
        
        if (config?.connections) {
            // Flatten searches from unified config
            const searches = [];
            config.connections.forEach(conn => {
                conn.searches.forEach(s => {
                    searches.push({
                        source: conn.name,
                        title: s.targetTitle,
                        url: s.linkedInUrl
                    });
                });
            });
            
            console.log(`${LOG} GET_SEARCHES: Returning ${searches.length} searches from unified config`);
            response = { success: true, searches };
            break;
        }
        
        // Fallback: Legacy behavior - read from input sheet
        const { inputSheetId } = await getFromStorage([STORAGE_KEYS.INPUT_SHEET_ID]);
        if (!inputSheetId) {
            response = { success: false, error: 'No workbook configured' };
            break;
        }
        
        // Try Searches tab first, then Sheet1 fallback
        let data;
        try {
            data = await readSheet(inputSheetId, "'Searches'!A:C");
        } catch (e) {
            data = await readSheet(inputSheetId, 'Sheet1!A:C');
        }
        
        const searches = data.slice(1).map(row => ({
            source: row[0],
            title: row[1],
            url: row[2]
        }));
        
        console.log(`${LOG} GET_SEARCHES: Returning ${searches.length} searches from legacy storage`);
        response = { success: true, searches };
    } catch (error) {
        console.error(`${LOG} GET_SEARCHES error:`, error);
        response = { success: false, error: error.message };
    }
    break;
}


// ============================================================
// STEP 6: OPTIONAL - ENHANCE executeScheduledRun TO USE SYNC DATA
// (If you want scheduled runs to use the unified config)
// ============================================================

/*
// At the start of executeScheduledRun function, add this:

async function executeScheduledRun(schedule) {
    console.log(`${LOG} Executing scheduled run for ${schedule.sourceName}`);
    
    // Try to get searches from unified config first
    const config = await getWorkbookConfig();
    let searches = [];
    let workbookId = null;
    
    if (config) {
        const connection = config.connections.find(c => c.name === schedule.sourceName);
        if (connection) {
            searches = connection.searches.map(s => ({
                source: schedule.sourceName,
                title: s.targetTitle,
                url: s.linkedInUrl
            }));
            workbookId = connection.mapping?.sheetId;
            console.log(`${LOG} Using unified config: ${searches.length} searches, workbook: ${workbookId}`);
        }
    }
    
    // If not found in unified config, fall back to legacy
    if (searches.length === 0) {
        // ... your existing legacy code to read from inputSheetId ...
    }
    
    // ... rest of your executeScheduledRun function ...
}
*/


// ============================================================
// COMPLETE EXAMPLE: FULL SERVICE WORKER WITH SYNC INTEGRATION
// ============================================================
/*
// Here's how the imports section should look:

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
    generateSheetUrlWithGid, addPendingSchedule, removePendingSchedule,
    getPendingSchedules, validateSchedule
} from './scheduler.js';
import {
    setWebhookUrl, getWebhookUrl, testWebhook,
    notifyScheduleStarted, notifyScheduleCompleted, notifyScheduleFailed, 
    notifyError, notifyScrapeFailed, notifyLinkedInSignedOut,
    notifyLinkedInCheckpoint, notifyGoogleAuthExpired
} from './notifications.js';
import { 
    CONFIG, ALARM_NAMES, MESSAGE_ACTIONS, STORAGE_KEYS, 
    LOG_PREFIXES, SYNC_CONFIG 
} from '../utils/constants.js';

// NEW: Sheet Sync imports
import {
    loadWorkbookConfig,
    syncWorkbookConfig,
    getWorkbookConfig,
    clearWorkbookConfig,
    setSyncInterval,
    getSyncInterval,
    detectConfigChanges,
    getSearchesForSource,
    getAllSources,
    getOutputSheetForSource
} from './sheet_sync.js';
*/
