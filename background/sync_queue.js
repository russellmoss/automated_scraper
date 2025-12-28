// background/sync_queue.js - Local-First Data Queue with Retry Logic

import { appendRowsToTab, countRowsInTab } from './sheets_api.js';
import { STORAGE_KEYS, CONFIG, LOG_PREFIXES } from '../utils/constants.js';
import * as bigquerySync from './bigquery_sync.js';

const LOG = LOG_PREFIXES.QUEUE;
const MAX_RETRIES = CONFIG.MAX_RETRIES;
const BASE_DELAY_MS = CONFIG.BASE_DELAY_MS;

// ============================================================
// STORAGE HELPERS
// ============================================================

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

// ============================================================
// QUEUE OPERATIONS
// ============================================================

/**
 * Generate unique ID for queue items
 */
function generateQueueId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get current queue from storage
 * @returns {Promise<Array>} Queue items
 */
async function getQueue() {
    const result = await getFromStorage([STORAGE_KEYS.SYNC_QUEUE]);
    return result[STORAGE_KEYS.SYNC_QUEUE] || [];
}

/**
 * Save queue to storage
 * @param {Array} queue - Queue items
 */
async function saveQueue(queue) {
    await saveToStorage({ [STORAGE_KEYS.SYNC_QUEUE]: queue });
}

/**
 * Get failed rows from storage
 * @returns {Promise<Array>} Failed items
 */
export async function getFailedRows() {
    const result = await getFromStorage([STORAGE_KEYS.FAILED_ROWS]);
    return result[STORAGE_KEYS.FAILED_ROWS] || [];
}

/**
 * Save failed rows to storage
 * @param {Array} failed - Failed items
 */
async function saveFailedRows(failed) {
    await saveToStorage({ [STORAGE_KEYS.FAILED_ROWS]: failed });
}

/**
 * Add rows to the sync queue
 * @param {Array} rows - Data rows to queue
 * @param {string} spreadsheetId - Target spreadsheet
 * @param {string} tabName - Target tab
 * @returns {Promise<Object>} Queue item created
 */
export async function addToQueue(rows, spreadsheetId, tabName) {
    if (!rows || rows.length === 0) {
        console.log(`${LOG} No rows to queue`);
        return null;
    }
    
    const queue = await getQueue();
    
    const queueItem = {
        id: generateQueueId(),
        spreadsheetId,
        tabName,
        rows,
        retryCount: 0,
        createdAt: new Date().toISOString(),
        lastAttempt: null,
        error: null
    };
    
    queue.push(queueItem);
    await saveQueue(queue);
    
    console.log(`${LOG} ✅ Queued ${rows.length} rows → ${tabName} (ID: ${queueItem.id})`);
    return queueItem;
}

/**
 * Process all items in the queue
 * @returns {Promise<{synced: number, failed: number, pending: number}>}
 */
export async function processQueue() {
    const queue = await getQueue();
    
    if (queue.length === 0) {
        return { synced: 0, failed: 0, pending: 0 };
    }
    
    console.log(`${LOG} Processing ${queue.length} queued items...`);
    
    let synced = 0;
    let failed = 0;
    const remainingQueue = [];
    const newFailedRows = [];
    
    for (const item of queue) {
        try {
            // Attempt to sync to Google Sheets
            await appendRowsToTab(item.spreadsheetId, item.tabName, item.rows);
            
            synced++;
            console.log(`${LOG} ✅ Synced ${item.rows.length} rows to Sheets (ID: ${item.id})`);
            
            // NEW: Sync to BigQuery (non-blocking - failures don't break the flow)
            try {
                // Check if BigQuery is configured by checking Chrome storage directly
                const { bigquery_config } = await getFromStorage(['bigquery_config']);
                const isBQConfigured = bigquery_config?.appsScriptWebAppUrl && 
                                      bigquery_config.appsScriptWebAppUrl.includes('script.google.com');
                
                console.log(`${LOG} 🔍 BigQuery check: configured=${!!isBQConfigured}, url=${bigquery_config?.appsScriptWebAppUrl?.substring(0, 50)}...`);
                
                if (isBQConfigured) {
                    console.log(`${LOG} ✅ BigQuery sync module available`);
                    // Ensure config is loaded in the module
                    await bigquerySync.initBigQueryConfig().catch(() => {});
                    
                    // Extract source name from first row (column 4 = Connection Source)
                    const sourceName = item.rows?.[0]?.[4] || null;
                    console.log(`${LOG} 🔍 Source name from row: "${sourceName}" (row[4])`);
                    
                    if (sourceName) {
                        console.log(`${LOG} 🔄 Syncing ${item.rows.length} profiles to BigQuery for ${sourceName}...`);
                        
                        try {
                            // Get or create recruiter in BigQuery
                            const recruiterId = await bigquerySync.getOrCreateRecruiter(sourceName);
                            if (recruiterId) {
                                // Sync profiles to BigQuery
                                const result = await bigquerySync.syncProfilesToBigQuery(
                                    item.rows,
                                    recruiterId,
                                    sourceName,
                                    null, // searchType - not available in queue context
                                    null  // scrapeRunId - not available in queue context
                                );
                                console.log(`${LOG} ✅ BigQuery sync: ${result.synced} synced, ${result.errors} errors for ${sourceName}`);
                                
                                // Record observations (point-in-time data) - pass advisor_ids from sync result
                                // This ensures we capture all scraped profiles for historical analysis with correct advisor_id linkage
                                try {
                                    // Pass advisorIds from sync result to observations (ensures correct linkage)
                                    await bigquerySync.recordSearchObservations(
                                        null, // scrapeRunId - not available in queue context
                                        recruiterId,
                                        null, // searchId - not available in queue context
                                        null, // searchJobTitle - not available in queue context
                                        item.rows, // profiles as Sheets row format
                                        result.advisorIds // Pass advisor_ids from sync result - THIS IS THE KEY FIX!
                                    );
                                    console.log(`${LOG} ✅ Observations recorded for ${item.rows.length} profiles with advisor_ids`);
                                } catch (obsError) {
                                    // Don't fail the whole sync if observations fail
                                    console.warn(`${LOG} ⚠️ Failed to record observations (non-critical):`, obsError);
                                }
                            } else {
                                console.warn(`${LOG} ⚠️ Failed to get/create recruiter for ${sourceName}`);
                            }
                        } catch (syncError) {
                            console.error(`${LOG} ⚠️ BigQuery sync error:`, syncError);
                        }
                    } else {
                        console.warn(`${LOG} ⚠️ No source name found in row[4], skipping BigQuery sync`);
                        console.log(`${LOG} 🔍 Row sample:`, item.rows?.[0]?.slice(0, 6));
                    }
                } else {
                    console.log(`${LOG} ℹ️ BigQuery not configured, skipping sync`);
                }
            } catch (bqError) {
                // BigQuery sync failures are non-critical - log but don't fail the queue item
                console.error(`${LOG} ⚠️ BigQuery sync failed (non-critical):`, bqError);
            }
            
            // Update execution history with actual row count from sheet
            // This gives us the real count of what's in the sheet (excluding header)
            try {
                const rowCount = await countRowsInTab(item.spreadsheetId, item.tabName);
                
                // Find the active execution record for this workbook/tab
                const { autoRunState, manualScrapeState } = await getFromStorage(['autoRunState', 'manualScrapeState']);
                const executionId = autoRunState?.executionId || manualScrapeState?.executionId;
                
                if (executionId) {
                    // Check if this execution matches the workbook/tab we just wrote to
                    const { executionHistory } = await getFromStorage(['executionHistory']);
                    const execution = executionHistory?.find(e => e.id === executionId);
                    
                    if (execution && execution.workbookId === item.spreadsheetId && execution.tabName === item.tabName) {
                        // Update with actual row count from sheet
                        const { updateExecutionRecord } = await import('./scheduler.js');
                        await updateExecutionRecord(executionId, {
                            profilesScraped: rowCount
                        }).catch(err => console.warn(`${LOG} Failed to update execution record:`, err));
                    }
                }
            } catch (updateError) {
                // Don't fail the sync if execution update fails
                console.warn(`${LOG} Failed to update execution record with row count:`, updateError);
            }
            
        } catch (error) {
            console.error(`${LOG} ❌ Sync failed for ${item.id}:`, error.message);
            
            item.retryCount++;
            item.lastAttempt = new Date().toISOString();
            item.error = error.message;
            
            if (item.retryCount >= MAX_RETRIES) {
                // Move to failed queue after max retries
                console.error(`${LOG} 💀 Max retries exceeded for ${item.id}, moving to failed queue`);
                newFailedRows.push(item);
                failed++;
                
                // Extract sourceName from first row if available (column 4 = Connection Source)
                const sourceName = item.rows?.[0]?.[4] || 'Unknown Source';
                
                // Send error notification for persistent queue failures via chrome.runtime message
                // This will be handled by service worker which has access to notifications
                chrome.runtime.sendMessage({
                    action: 'QUEUE_SYNC_FAILED',
                    queueItemId: item.id,
                    spreadsheetId: item.spreadsheetId,
                    tabName: item.tabName,
                    rowsCount: item.rows.length,
                    error: error.message,
                    retryCount: item.retryCount,
                    sourceName: sourceName // Connection Source from Input Sheet
                }).catch(() => {}); // Ignore if no listener
            } else {
                // Keep in queue for retry with exponential backoff
                const backoffMs = BASE_DELAY_MS * Math.pow(2, item.retryCount);
                console.log(`${LOG} ⏳ Will retry ${item.id} in ${backoffMs}ms (attempt ${item.retryCount}/${MAX_RETRIES})`);
                remainingQueue.push(item);
            }
        }
    }
    
    // Save updated queues
    await saveQueue(remainingQueue);
    
    if (newFailedRows.length > 0) {
        const existingFailed = await getFailedRows();
        await saveFailedRows([...existingFailed, ...newFailedRows]);
    }
    
    console.log(`${LOG} Queue processing complete: ${synced} synced, ${failed} failed, ${remainingQueue.length} pending`);
    
    return {
        synced,
        failed,
        pending: remainingQueue.length
    };
}

/**
 * Get queue status for UI display
 * @returns {Promise<Object>} Status object
 */
export async function getQueueStatus() {
    const queue = await getQueue();
    const failed = await getFailedRows();
    
    const pendingRows = queue.reduce((sum, item) => sum + item.rows.length, 0);
    const failedRows = failed.reduce((sum, item) => sum + item.rows.length, 0);
    
    return {
        pending: queue.length,
        pendingRows,
        failed: failed.length,
        failedRows,
        oldestPending: queue.length > 0 ? queue[0].createdAt : null,
        newestPending: queue.length > 0 ? queue[queue.length - 1].createdAt : null
    };
}

/**
 * Clear all failed rows (after user review)
 * @returns {Promise<number>} Number of items cleared
 */
export async function clearFailedRows() {
    const failed = await getFailedRows();
    const count = failed.length;
    await saveFailedRows([]);
    console.log(`${LOG} Cleared ${count} failed items`);
    return count;
}

/**
 * Retry all failed items by moving them back to pending queue
 * @returns {Promise<number>} Number of items moved
 */
export async function retryFailedItems() {
    const failed = await getFailedRows();
    
    if (failed.length === 0) {
        console.log(`${LOG} No failed items to retry`);
        return 0;
    }
    
    // Reset retry counts and move to pending queue
    const queue = await getQueue();
    
    const resetItems = failed.map(item => ({
        ...item,
        retryCount: 0,
        error: null,
        lastAttempt: null
    }));
    
    await saveQueue([...queue, ...resetItems]);
    await saveFailedRows([]);
    
    console.log(`${LOG} Moved ${failed.length} failed items back to pending queue`);
    return failed.length;
}

/**
 * Update tab name for all pending items (used when weekly tab changes)
 * @param {string} newTabName - New tab name
 * @returns {Promise<number>} Number of items updated
 */
export async function updateQueueTabName(newTabName) {
    const queue = await getQueue();
    
    if (queue.length === 0) {
        return 0;
    }
    
    const updatedQueue = queue.map(item => ({
        ...item,
        tabName: newTabName
    }));
    
    await saveQueue(updatedQueue);
    console.log(`${LOG} Updated tab name to "${newTabName}" for ${queue.length} queued items`);
    return queue.length;
}

/**
 * Remove a specific item from the queue
 * @param {string} itemId - Queue item ID
 * @returns {Promise<boolean>} Success
 */
export async function removeFromQueue(itemId) {
    const queue = await getQueue();
    const filtered = queue.filter(item => item.id !== itemId);
    
    if (filtered.length === queue.length) {
        return false; // Item not found
    }
    
    await saveQueue(filtered);
    console.log(`${LOG} Removed item ${itemId} from queue`);
    return true;
}

/**
 * Get a specific queue item by ID
 * @param {string} itemId - Queue item ID
 * @returns {Promise<Object|null>} Queue item or null
 */
export async function getQueueItem(itemId) {
    const queue = await getQueue();
    return queue.find(item => item.id === itemId) || null;
}

