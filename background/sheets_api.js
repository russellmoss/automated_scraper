// background/sheets_api.js - Google Sheets API Wrapper with Retry Logic

import { getAuthToken, removeCachedToken } from './auth.js';
import { notifyGoogleAuthExpired } from './notifications.js';
import { SHEETS_API_BASE, HEADERS_ROW, LOG_PREFIXES } from '../utils/constants.js';

const LOG = LOG_PREFIXES.SHEETS;

// ============================================================
// CORE API FUNCTIONS
// ============================================================

/**
 * Fetch with automatic token refresh on 401
 */
async function fetchWithRetry(url, options, retryCount = 0) {
    try {
        const response = await fetch(url, options);
        
        if (response.status === 401 && retryCount < 1) {
            console.log(`${LOG} 401 detected, refreshing token...`);

            const oldToken = options.headers.Authorization.split(' ')[1];
            await removeCachedToken(oldToken).catch(() => {});
            
            let newToken;
            try {
                newToken = await getAuthToken(false);
            } catch (e) {
                // For service accounts, token refresh failure means:
                // 1. Service account not configured (missing credentials)
                // 2. Invalid credentials (wrong JSON key)
                // 3. Service account deleted/disabled in Google Cloud
                // Only notify if it's a configuration issue (not a transient network error)
                const errorMsg = e?.message || String(e);
                if (errorMsg.includes('not configured') || errorMsg.includes('missing required field') || errorMsg.includes('Service account')) {
                    await notifyGoogleAuthExpired(
                        `Service account configuration error: ${errorMsg}. Check service account setup in extension popup.`,
                        null
                    ).catch(() => {});
                }
                throw e;
            }
            options.headers.Authorization = `Bearer ${newToken}`;
            
            return fetchWithRetry(url, options, retryCount + 1);
        }
        
        return response;
    } catch (e) {
        console.error(`${LOG} Fetch error:`, e);
        throw e;
    }
}

/**
 * Make authenticated API call
 * For service accounts, the interactive parameter is ignored (no user interaction needed)
 */
async function apiCall(endpoint, options = {}) {
    let token;
    
    // Service accounts don't require interactive auth - just get the token
    try {
        console.log(`${LOG} 🔑 Retrieving service account token...`);
        token = await getAuthToken(false); // interactive parameter ignored for service accounts
        console.log(`${LOG} ✅ Token retrieved successfully`);
    } catch (e) {
        console.error(`${LOG} ❌ Token retrieval failed: ${e?.message || String(e)}`);
        // For service accounts, token retrieval failure means configuration issue
        // Only notify for configuration errors (not transient network errors)
        const errorMsg = e?.message || String(e);
        if (errorMsg.includes('not configured') || errorMsg.includes('missing required field') || errorMsg.includes('Service account')) {
            await notifyGoogleAuthExpired(
                `Service account not configured or invalid: ${errorMsg}. Configure service account in extension popup.`,
                null
            ).catch(() => {});
        }
        throw e;
    }
    const url = endpoint.startsWith('http') ? endpoint : `${SHEETS_API_BASE}${endpoint}`;
    
    const fetchOptions = {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    };
    
    console.log(`${LOG} ${options.method || 'GET'} ${url.substring(0, 80)}...`);
    
    const response = await fetchWithRetry(url, fetchOptions);

    // If we are still getting 401 here, it means refresh retry didn't fix it.
    // With service accounts, 401 usually means:
    // 1. Service account doesn't have access to the sheet (permissions issue)
    // 2. Service account was deleted/disabled in Google Cloud
    // 3. Invalid credentials (though this would fail earlier)
    if (response.status === 401) {
        let body = '';
        try {
            body = await response.text();
        } catch (e) {
            // ignore
        }
        // Only notify for persistent 401s (likely permission issue, not transient)
        // Check if error mentions permissions/access
        const bodyStr = String(body).toLowerCase();
        if (bodyStr.includes('permission') || bodyStr.includes('access') || bodyStr.includes('forbidden') || bodyStr.includes('insufficient')) {
            await notifyGoogleAuthExpired(
                `Service account lacks access to Google Sheet. Share the sheet with the service account email. Endpoint: ${endpoint}`,
                null
            ).catch(() => {});
        }
        throw new Error(`Google Sheets API 401: Service account may lack access to this sheet. Share the sheet with the service account email.`);
    }
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`${LOG} API Error ${response.status}:`, errorText);
        throw new Error(`Sheets API Error: ${response.status} - ${errorText.substring(0, 200)}`);
    }
    
    return response.json();
}

/**
 * Format tab name for range (handle special characters)
 */
function formatTabNameForRange(tabName) {
    if (/[ _\-'!]/.test(tabName)) {
        return `'${tabName.replace(/'/g, "''")}'`;
    }
    return tabName;
}

/**
 * Get today's date as tab name (Eastern Time)
 */
export function getTodayTabName() {
    const now = new Date();
    const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const month = String(eastern.getMonth() + 1).padStart(2, '0');
    const day = String(eastern.getDate()).padStart(2, '0');
    const year = String(eastern.getFullYear()).slice(-2);
    return `${month}_${day}_${year}`;
}

/**
 * Normalize LinkedIn URL for comparison
 */
function normalizeLinkedInUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let normalized = url.trim();
    if (normalized.includes('?')) normalized = normalized.split('?')[0];
    normalized = normalized.replace(/\/+$/, '');
    normalized = normalized.replace(/^http:\/\//i, 'https://');
    return normalized.toLowerCase();
}

// ============================================================
// SPREADSHEET OPERATIONS
// ============================================================

/**
 * Create a new spreadsheet with headers
 */
export async function createSheet(title) {
    console.log(`${LOG} Creating spreadsheet: "${title}"`);
    
    const spreadsheet = await apiCall('', {
        method: 'POST',
        body: JSON.stringify({ properties: { title } })
    });
    
    const { spreadsheetId, spreadsheetUrl } = spreadsheet;
    await appendRows(spreadsheetId, [HEADERS_ROW], false, 'Sheet1');
    
    console.log(`${LOG} Created: ${spreadsheetId}`);
    return { spreadsheetId, spreadsheetUrl };
}

/**
 * Read data from a range
 */
export async function readSheet(spreadsheetId, range) {
    const data = await apiCall(`/${spreadsheetId}/values/${encodeURIComponent(range)}`);
    return data.values || [];
}

/**
 * Get spreadsheet name/title
 */
export async function getSheetName(spreadsheetId) {
    const data = await apiCall(`/${spreadsheetId}?fields=properties.title`);
    return data.properties?.title || 'Untitled';
}

/**
 * Validate spreadsheet is accessible
 */
export async function validateSpreadsheet(spreadsheetId) {
    try {
        const data = await apiCall(`/${spreadsheetId}?fields=properties.title`);
        return { valid: true, title: data.properties?.title || 'Untitled' };
    } catch (error) {
        return { valid: false, title: '', error: error.message };
    }
}

/**
 * Get all tabs in a spreadsheet
 */
export async function getSheetTabs(spreadsheetId) {
    const data = await apiCall(`/${spreadsheetId}?fields=sheets.properties`);
    return (data.sheets || []).map(sheet => ({
        sheetId: sheet.properties.sheetId,
        title: sheet.properties.title,
        index: sheet.properties.index
    }));
}

/**
 * Create a new tab
 */
export async function createTab(spreadsheetId, tabName) {
    console.log(`${LOG} Creating tab "${tabName}"...`);
    
    const result = await apiCall(`/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
            requests: [{ addSheet: { properties: { title: tabName } } }]
        })
    });
    
    const newSheet = result.replies?.[0]?.addSheet?.properties;
    return { sheetId: newSheet?.sheetId, title: newSheet?.title };
}

/**
 * Write headers to a tab
 */
export async function writeHeadersToTab(spreadsheetId, tabName) {
    const range = `${formatTabNameForRange(tabName)}!A1:L1`;
    
    await apiCall(`/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        body: JSON.stringify({ values: [HEADERS_ROW] })
    });
    
    console.log(`${LOG} Headers written to "${tabName}"`);
}

/**
 * Ensure today's weekly tab exists
 */
export async function ensureWeeklyTab(spreadsheetId) {
    const tabName = getTodayTabName();
    const tabs = await getSheetTabs(spreadsheetId);
    
    if (tabs.some(t => t.title === tabName)) {
        console.log(`${LOG} Tab "${tabName}" exists`);
        return { tabName, isNew: false, spreadsheetId };
    }
    
    await createTab(spreadsheetId, tabName);
    await writeHeadersToTab(spreadsheetId, tabName);
    
    console.log(`${LOG} ✅ Created weekly tab "${tabName}"`);
    return { tabName, isNew: true, spreadsheetId };
}

/**
 * Append rows to a specific tab
 */
export async function appendRowsToTab(spreadsheetId, tabName, rows) {
    if (!rows || rows.length === 0) return null;
    
    console.log(`${LOG} Appending ${rows.length} rows to "${tabName}"...`);
    
    const range = `${formatTabNameForRange(tabName)}!A1`;
    
    try {
        const result = await apiCall(
            `/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
            { method: 'POST', body: JSON.stringify({ values: rows }) }
        );
        
        console.log(`${LOG} ✅ Appended ${rows.length} rows`);
        return result;
    } catch (error) {
        if (error.message?.includes('Unable to parse range')) {
            // Tab might not exist, try creating it
            const tabs = await getSheetTabs(spreadsheetId);
            if (!tabs.some(t => t.title === tabName)) {
                await createTab(spreadsheetId, tabName);
                await writeHeadersToTab(spreadsheetId, tabName);
                return appendRowsToTab(spreadsheetId, tabName, rows);
            }
        }
        throw error;
    }
}

/**
 * Append rows with optional deduplication
 */
export async function appendRows(spreadsheetId, rows, deduplicate = false, tabName = 'Sheet1') {
    if (!rows || rows.length === 0) return null;
    
    if (deduplicate) {
        try {
            const existing = await readSheet(spreadsheetId, `${tabName}!A:Z`);
            const existingUrls = new Set();
            
            for (let i = 1; i < existing.length; i++) {
                const url = normalizeLinkedInUrl(existing[i][5]);
                if (url) existingUrls.add(url);
            }
            
            rows = rows.filter(row => {
                const url = normalizeLinkedInUrl(row[5]);
                if (!url) return true;
                if (existingUrls.has(url)) return false;
                existingUrls.add(url);
                return true;
            });
            
            if (rows.length === 0) {
                console.log(`${LOG} All rows were duplicates`);
                return { updatedRows: 0 };
            }
        } catch (e) {
            console.warn(`${LOG} Dedup check failed, appending all:`, e.message);
        }
    }
    
    return appendRowsToTab(spreadsheetId, tabName, rows);
}

/**
 * Get all data from a tab
 */
export async function getTabData(spreadsheetId, tabName) {
    const range = `${formatTabNameForRange(tabName)}!A:Z`;
    const values = await readSheet(spreadsheetId, range);
    
    if (values.length === 0) {
        return { headers: [], rows: [], rowCount: 0 };
    }
    
    return {
        headers: values[0] || [],
        rows: values.slice(1),
        rowCount: values.length - 1
    };
}

// ============================================================
// COMPARE TABS - DIFFERENTIAL ANALYSIS
// ============================================================

/**
 * Compare two tabs and find new entries
 * 
 * @param {string} spreadsheetId - Workbook ID
 * @param {string} tab1Name - Baseline tab (older data)
 * @param {string} tab2Name - Compare tab (newer data)
 * @param {string} outputTabName - Name for output tab
 * @param {number} keyColumn - Column index for comparison (1=Name, 5=LinkedIn URL)
 * @returns {Promise<Object>} Result with newEntries count
 */
export async function compareTabs(spreadsheetId, tab1Name, tab2Name, outputTabName, keyColumn = 1) {
    console.log(`${LOG} Comparing tabs: "${tab1Name}" vs "${tab2Name}"`);
    
    // Validate inputs
    if (!spreadsheetId) {
        return { success: false, error: 'No spreadsheet selected' };
    }
    if (!tab1Name || !tab2Name) {
        return { success: false, error: 'Please select two tabs to compare' };
    }
    if (tab1Name === tab2Name) {
        return { success: false, error: 'Please select two different tabs' };
    }
    if (!outputTabName) {
        return { success: false, error: 'Please enter a name for the output tab' };
    }
    
    try {
        // Check if output tab already exists
        const existingTabs = await getSheetTabs(spreadsheetId);
        if (existingTabs.some(t => t.title === outputTabName)) {
            return { success: false, error: `Tab "${outputTabName}" already exists` };
        }
        
        // Read both tabs
        const tab1Data = await getTabData(spreadsheetId, tab1Name);
        const tab2Data = await getTabData(spreadsheetId, tab2Name);
        
        console.log(`${LOG} Tab 1 (${tab1Name}): ${tab1Data.rowCount} rows`);
        console.log(`${LOG} Tab 2 (${tab2Name}): ${tab2Data.rowCount} rows`);
        
        // Build set of keys from baseline (Tab 1)
        const tab1Keys = new Set();
        for (const row of tab1Data.rows) {
            const keyValue = row[keyColumn];
            if (keyValue) {
                tab1Keys.add(String(keyValue).toLowerCase().trim());
            }
        }
        
        // Find new entries in Tab 2
        const newRows = [];
        const seenInTab2 = new Set();
        
        for (const row of tab2Data.rows) {
            const keyValue = row[keyColumn];
            if (!keyValue) continue;
            
            const normalizedKey = String(keyValue).toLowerCase().trim();
            
            // Check if NOT in baseline AND not already seen in Tab 2
            if (!tab1Keys.has(normalizedKey) && !seenInTab2.has(normalizedKey)) {
                newRows.push(row);
                seenInTab2.add(normalizedKey);
            }
        }
        
        console.log(`${LOG} Found ${newRows.length} new entries`);
        
        // Create output tab
        await createTab(spreadsheetId, outputTabName);
        
        // Write headers
        if (tab2Data.headers.length > 0) {
            const headerRange = `${formatTabNameForRange(outputTabName)}!A1`;
            await apiCall(
                `/${spreadsheetId}/values/${encodeURIComponent(headerRange)}?valueInputOption=USER_ENTERED`,
                { method: 'PUT', body: JSON.stringify({ values: [tab2Data.headers] }) }
            );
        }
        
        // Write new entries
        if (newRows.length > 0) {
            await appendRowsToTab(spreadsheetId, outputTabName, newRows);
        }
        
        console.log(`${LOG} ✅ Comparison complete: ${newRows.length} new entries → "${outputTabName}"`);
        
        return {
            success: true,
            newEntries: newRows.length,
            tab1Count: tab1Data.rowCount,
            tab2Count: tab2Data.rowCount,
            outputTabName
        };
        
    } catch (error) {
        console.error(`${LOG} Compare error:`, error);
        return { success: false, error: error.message };
    }
}

// ============================================================
// DEDUPLICATION
// ============================================================

/**
 * Remove duplicate rows from a tab based on LinkedIn URL
 */
export async function deduplicateSheet(spreadsheetId, tabName) {
    console.log(`${LOG} Deduplicating "${tabName}"...`);
    
    const tabData = await getTabData(spreadsheetId, tabName);
    
    if (tabData.rowCount === 0) {
        return { success: true, duplicatesRemoved: 0 };
    }
    
    // Find duplicates by LinkedIn URL (column 5)
    const seen = new Set();
    const duplicateRowIndices = [];
    
    tabData.rows.forEach((row, index) => {
        const url = normalizeLinkedInUrl(row[5]);
        if (url && seen.has(url)) {
            duplicateRowIndices.push(index + 2); // +2 for header and 0-indexing
        } else if (url) {
            seen.add(url);
        }
    });
    
    if (duplicateRowIndices.length === 0) {
        console.log(`${LOG} No duplicates found`);
        return { success: true, duplicatesRemoved: 0 };
    }
    
    // Get sheet ID for batchUpdate
    const tabs = await getSheetTabs(spreadsheetId);
    const tab = tabs.find(t => t.title === tabName);
    
    if (!tab) {
        return { success: false, error: `Tab "${tabName}" not found` };
    }
    
    // Delete rows from bottom to top to preserve indices
    const deleteRequests = duplicateRowIndices
        .sort((a, b) => b - a)
        .map(rowIndex => ({
            deleteDimension: {
                range: {
                    sheetId: tab.sheetId,
                    dimension: 'ROWS',
                    startIndex: rowIndex - 1,
                    endIndex: rowIndex
                }
            }
        }));
    
    await apiCall(`/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: deleteRequests })
    });
    
    console.log(`${LOG} ✅ Removed ${duplicateRowIndices.length} duplicates`);
    return { success: true, duplicatesRemoved: duplicateRowIndices.length };
}

/**
 * Load/validate a spreadsheet (convenience function)
 */
export async function loadSheet(spreadsheetId) {
    const validation = await validateSpreadsheet(spreadsheetId);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    
    const tabs = await getSheetTabs(spreadsheetId);
    
    return {
        spreadsheetId,
        title: validation.title,
        tabs,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
    };
}

/**
 * Add a new tab to a sheet (alias for createTab with headers)
 */
export async function addTabToSheet(spreadsheetId, tabName, includeHeaders = true) {
    await createTab(spreadsheetId, tabName);
    if (includeHeaders) {
        await writeHeadersToTab(spreadsheetId, tabName);
    }
    return { success: true, tabName };
}

