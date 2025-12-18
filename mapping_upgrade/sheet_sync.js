// background/sheet_sync.js - Unified Workbook Sync Module
// Savvy Pirate v2.1 - Live Sheet Sync Feature

import { getAuthToken } from './auth.js';
import { readSheet, validateSpreadsheet, getSheetName } from './sheets_api.js';
import { STORAGE_KEYS, LOG_PREFIXES } from '../utils/constants.js';

const LOG = '[SYNC]';

// ============================================================
// SYNC CONFIGURATION
// ============================================================
export const SYNC_CONFIG = {
    DEFAULT_INTERVAL_MINUTES: 5,
    MIN_INTERVAL_MINUTES: 1,
    MAX_INTERVAL_MINUTES: 60,
    SEARCHES_TAB_NAME: 'Searches',
    MAPPINGS_TAB_NAME: 'Mapping and Schedules',
    SEARCHES_RANGE: 'A:C',
    MAPPINGS_RANGE: 'A:H',
};

// ============================================================
// STORAGE HELPERS
// ============================================================

async function getFromStorage(keys) {
    return new Promise(resolve => {
        chrome.storage.local.get(keys, resolve);
    });
}

async function saveToStorage(data) {
    return new Promise(resolve => {
        chrome.storage.local.set(data, resolve);
    });
}

// ============================================================
// URL PARSING
// ============================================================

/**
 * Extract spreadsheet ID from URL or return if already an ID
 */
export function extractSpreadsheetId(input) {
    if (!input) return null;
    
    const trimmed = input.trim();
    
    // Already an ID (no slashes, looks like a sheet ID - typically 44 chars)
    if (!trimmed.includes('/') && /^[a-zA-Z0-9-_]+$/.test(trimmed)) {
        return trimmed;
    }
    
    // URL format: https://docs.google.com/spreadsheets/d/{ID}/...
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

/**
 * Extract sheet ID from individual sheet URL
 */
export function extractSheetIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

// ============================================================
// DATA FETCHING
// ============================================================

/**
 * Fetch searches from the Searches tab
 * Expected columns: Source Connection | Target Job Title | LinkedIn Search URL
 */
async function fetchSearchesTab(spreadsheetId) {
    console.log(`${LOG} Fetching Searches tab...`);
    
    const tabName = SYNC_CONFIG.SEARCHES_TAB_NAME;
    const range = `'${tabName}'!${SYNC_CONFIG.SEARCHES_RANGE}`;
    
    try {
        const data = await readSheet(spreadsheetId, range);
        
        if (!data || data.length < 2) {
            console.log(`${LOG} No search data found in "${tabName}" tab (or only headers)`);
            // Try fallback
            return await fetchSearchesFallback(spreadsheetId);
        }
        
        // Skip header row, map to objects
        const searches = data.slice(1)
            .filter(row => row[0] && row[2]) // Must have source and URL
            .map(row => ({
                sourceConnection: (row[0] || '').trim(),
                targetJobTitle: (row[1] || '').trim(),
                linkedInUrl: (row[2] || '').trim()
            }));
        
        console.log(`${LOG} ✅ Fetched ${searches.length} searches from "${tabName}" tab`);
        return searches;
        
    } catch (error) {
        console.warn(`${LOG} Error fetching "${tabName}" tab:`, error.message);
        return await fetchSearchesFallback(spreadsheetId);
    }
}

/**
 * Fallback: try Sheet1 (original format)
 */
async function fetchSearchesFallback(spreadsheetId) {
    try {
        console.log(`${LOG} Trying fallback to Sheet1...`);
        const data = await readSheet(spreadsheetId, 'Sheet1!A:C');
        
        if (!data || data.length < 2) {
            console.log(`${LOG} No data in Sheet1 fallback`);
            return [];
        }
        
        const searches = data.slice(1)
            .filter(row => row[0] && row[2])
            .map(row => ({
                sourceConnection: (row[0] || '').trim(),
                targetJobTitle: (row[1] || '').trim(),
                linkedInUrl: (row[2] || '').trim()
            }));
        
        console.log(`${LOG} ✅ Fallback: Fetched ${searches.length} searches from Sheet1`);
        return searches;
        
    } catch (fallbackError) {
        console.error(`${LOG} ❌ Fallback also failed:`, fallbackError.message);
        return [];
    }
}

/**
 * Fetch mappings from the Mapping and Schedules tab
 * Expected columns: Name | Sheet_URL | Title | Company | Day | Day of Week | Time (24hr) | Frequency
 */
async function fetchMappingsTab(spreadsheetId) {
    console.log(`${LOG} Fetching Mapping and Schedules tab...`);
    
    const tabName = SYNC_CONFIG.MAPPINGS_TAB_NAME;
    const range = `'${tabName}'!${SYNC_CONFIG.MAPPINGS_RANGE}`;
    
    try {
        const data = await readSheet(spreadsheetId, range);
        
        if (!data || data.length < 2) {
            console.log(`${LOG} No mapping data found (or only headers)`);
            return [];
        }
        
        // Skip header row, map to objects
        const mappings = data.slice(1)
            .filter(row => row[0]) // Must have name
            .map(row => ({
                name: (row[0] || '').trim(),
                sheetUrl: (row[1] || '').trim(),
                sheetId: extractSheetIdFromUrl(row[1]),
                title: (row[2] || '').trim(),
                company: (row[3] || '').trim(),
                schedule: {
                    day: (row[4] || '').trim(),
                    dayOfWeek: (row[5] || '').trim(),
                    time: (row[6] || '').trim(),
                    frequency: (row[7] || '').trim()
                }
            }));
        
        console.log(`${LOG} ✅ Fetched ${mappings.length} mappings`);
        return mappings;
        
    } catch (error) {
        // Mappings tab is optional - return empty if not found
        console.warn(`${LOG} Mappings tab not found or error:`, error.message);
        console.log(`${LOG} Proceeding without mappings (tab may not exist)`);
        return [];
    }
}

// ============================================================
// CONFIG BUILDING
// ============================================================

/**
 * Merge searches and mappings into unified configuration
 */
function buildUnifiedConfig(searches, mappings, spreadsheetId, workbookUrl, workbookTitle) {
    console.log(`${LOG} Building unified config...`);
    
    // Create lookup map from mappings by Name
    const mappingsByName = {};
    mappings.forEach(m => {
        // Handle potential name variations (trim, case)
        const normalizedName = m.name.trim();
        mappingsByName[normalizedName] = {
            sheetUrl: m.sheetUrl,
            sheetId: m.sheetId,
            title: m.title,
            company: m.company,
            schedule: m.schedule
        };
    });
    
    // Group searches by Source Connection and enrich with mapping data
    const connectionMap = {};
    
    searches.forEach(s => {
        const name = s.sourceConnection;
        
        if (!connectionMap[name]) {
            // Try exact match first, then case-insensitive
            let mapping = mappingsByName[name];
            if (!mapping) {
                const lowerName = name.toLowerCase();
                const matchKey = Object.keys(mappingsByName).find(
                    k => k.toLowerCase() === lowerName
                );
                if (matchKey) mapping = mappingsByName[matchKey];
            }
            
            connectionMap[name] = {
                name,
                mapping: mapping || null,
                searches: []
            };
        }
        
        connectionMap[name].searches.push({
            targetTitle: s.targetJobTitle,
            linkedInUrl: s.linkedInUrl
        });
    });
    
    const connections = Object.values(connectionMap);
    
    // Sort connections alphabetically
    connections.sort((a, b) => a.name.localeCompare(b.name));
    
    // Count stats
    const stats = {
        totalConnections: connections.length,
        connectionsWithMapping: connections.filter(c => c.mapping).length,
        connectionsWithSchedule: connections.filter(c => c.mapping?.schedule?.dayOfWeek).length,
        totalSearches: searches.length,
        unmappedConnections: connections.filter(c => !c.mapping).map(c => c.name)
    };
    
    console.log(`${LOG} Config built:`, {
        connections: stats.totalConnections,
        withMapping: stats.connectionsWithMapping,
        withSchedule: stats.connectionsWithSchedule,
        searches: stats.totalSearches
    });
    
    if (stats.unmappedConnections.length > 0) {
        console.log(`${LOG} ⚠️ Unmapped connections:`, stats.unmappedConnections);
    }
    
    return {
        workbookId: spreadsheetId,
        workbookUrl: workbookUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        workbookTitle: workbookTitle || 'Untitled',
        lastSync: new Date().toISOString(),
        syncStatus: 'success',
        stats,
        connections
    };
}

// ============================================================
// CHANGE DETECTION
// ============================================================

/**
 * Compare two configs and detect changes
 */
export function detectConfigChanges(oldConfig, newConfig) {
    const changes = [];
    
    if (!oldConfig || !oldConfig.connections) {
        return [{ type: 'initial_load', message: 'Initial configuration loaded' }];
    }
    
    const oldNames = new Set(oldConfig.connections.map(c => c.name));
    const newNames = new Set(newConfig.connections.map(c => c.name));
    
    // New connections added
    newConfig.connections.forEach(c => {
        if (!oldNames.has(c.name)) {
            changes.push({ 
                type: 'connection_added', 
                name: c.name,
                message: `➕ Added: ${c.name}`
            });
        }
    });
    
    // Connections removed
    oldConfig.connections.forEach(c => {
        if (!newNames.has(c.name)) {
            changes.push({ 
                type: 'connection_removed', 
                name: c.name,
                message: `➖ Removed: ${c.name}`
            });
        }
    });
    
    // Check for modifications
    newConfig.connections.forEach(newConn => {
        const oldConn = oldConfig.connections.find(c => c.name === newConn.name);
        if (oldConn) {
            // Schedule changed
            const oldSchedule = JSON.stringify(oldConn.mapping?.schedule || {});
            const newSchedule = JSON.stringify(newConn.mapping?.schedule || {});
            if (oldSchedule !== newSchedule) {
                changes.push({ 
                    type: 'schedule_changed', 
                    name: newConn.name,
                    message: `📅 Schedule updated: ${newConn.name}`
                });
            }
            
            // Mapping changed (sheet URL)
            if (oldConn.mapping?.sheetId !== newConn.mapping?.sheetId) {
                changes.push({ 
                    type: 'mapping_changed', 
                    name: newConn.name,
                    message: `📁 Output sheet changed: ${newConn.name}`
                });
            }
            
            // Searches changed
            const oldSearchCount = oldConn.searches?.length || 0;
            const newSearchCount = newConn.searches?.length || 0;
            if (oldSearchCount !== newSearchCount) {
                const diff = newSearchCount - oldSearchCount;
                const direction = diff > 0 ? 'added' : 'removed';
                changes.push({ 
                    type: 'searches_changed', 
                    name: newConn.name,
                    message: `🔍 ${Math.abs(diff)} search(es) ${direction}: ${newConn.name}`
                });
            }
        }
    });
    
    return changes;
}

// ============================================================
// MAIN SYNC FUNCTIONS
// ============================================================

/**
 * Load workbook configuration from URL (initial load)
 */
export async function loadWorkbookConfig(workbookUrl) {
    console.log(`${LOG} 📥 Loading workbook config from: ${workbookUrl}`);
    
    const spreadsheetId = extractSpreadsheetId(workbookUrl);
    if (!spreadsheetId) {
        throw new Error('Invalid workbook URL - could not extract spreadsheet ID');
    }
    
    // Validate access
    const validation = await validateSpreadsheet(spreadsheetId);
    if (!validation.valid) {
        throw new Error(`Cannot access workbook: ${validation.error}`);
    }
    
    console.log(`${LOG} Workbook validated: "${validation.title}"`);
    
    // Fetch both tabs in parallel
    const [searches, mappings] = await Promise.all([
        fetchSearchesTab(spreadsheetId),
        fetchMappingsTab(spreadsheetId)
    ]);
    
    if (searches.length === 0) {
        throw new Error('No searches found. Ensure the "Searches" tab exists with data in columns A-C.');
    }
    
    // Build unified config
    const config = buildUnifiedConfig(
        searches, 
        mappings, 
        spreadsheetId, 
        workbookUrl,
        validation.title
    );
    
    // Save to storage
    await saveToStorage({ 
        workbookConfig: config 
    });
    
    // Update legacy storage for backward compatibility
    await updateLegacyStorage(config);
    
    console.log(`${LOG} ✅ Workbook config loaded and saved`);
    return config;
}

/**
 * Sync workbook configuration (periodic refresh)
 */
export async function syncWorkbookConfig() {
    console.log(`${LOG} 🔄 Syncing workbook config...`);
    
    // Get existing config
    const { workbookConfig: existingConfig } = await getFromStorage(['workbookConfig']);
    
    if (!existingConfig?.workbookId) {
        console.log(`${LOG} No workbook configured, skipping sync`);
        return { synced: false, reason: 'no_workbook' };
    }
    
    // Update status to syncing
    await saveToStorage({
        workbookConfig: {
            ...existingConfig,
            syncStatus: 'syncing'
        }
    });
    
    try {
        // Fetch fresh data
        const [searches, mappings] = await Promise.all([
            fetchSearchesTab(existingConfig.workbookId),
            fetchMappingsTab(existingConfig.workbookId)
        ]);
        
        // Get current title
        let title = existingConfig.workbookTitle;
        try {
            title = await getSheetName(existingConfig.workbookId);
        } catch (e) {
            // Keep existing title
        }
        
        // Build new config
        const newConfig = buildUnifiedConfig(
            searches,
            mappings,
            existingConfig.workbookId,
            existingConfig.workbookUrl,
            title
        );
        
        // Detect changes
        const changes = detectConfigChanges(existingConfig, newConfig);
        
        // Save updated config
        await saveToStorage({ 
            workbookConfig: newConfig,
            lastSyncChanges: changes.length > 0 ? changes : null
        });
        
        // Update legacy storage
        await updateLegacyStorage(newConfig);
        
        if (changes.length > 0) {
            console.log(`${LOG} ✅ Sync complete with ${changes.length} change(s):`);
            changes.forEach(c => console.log(`${LOG}   ${c.message}`));
        } else {
            console.log(`${LOG} ✅ Sync complete, no changes`);
        }
        
        return { 
            synced: true, 
            changes,
            config: newConfig 
        };
        
    } catch (error) {
        console.error(`${LOG} ❌ Sync failed:`, error.message);
        
        // Update status to error but keep existing data
        await saveToStorage({
            workbookConfig: {
                ...existingConfig,
                syncStatus: 'error',
                lastSyncError: error.message,
                lastSyncAttempt: new Date().toISOString()
            }
        });
        
        return { 
            synced: false, 
            error: error.message 
        };
    }
}

/**
 * Update legacy storage keys for backward compatibility
 * This ensures existing scheduler and scraping code continues to work
 */
async function updateLegacyStorage(config) {
    console.log(`${LOG} Updating legacy storage for compatibility...`);
    
    // Build source mapping from connections
    const sourceMapping = {};
    config.connections.forEach(conn => {
        if (conn.mapping?.sheetId) {
            sourceMapping[conn.name] = conn.mapping.sheetId;
        }
    });
    
    // Build saved workbooks list (unique sheet IDs with deduplication)
    const workbookMap = {};
    config.connections.forEach(conn => {
        if (conn.mapping?.sheetId && conn.mapping?.sheetUrl) {
            // Use sheetId as key to prevent duplicates
            if (!workbookMap[conn.mapping.sheetId]) {
                workbookMap[conn.mapping.sheetId] = {
                    id: conn.mapping.sheetId,
                    url: conn.mapping.sheetUrl,
                    title: conn.mapping.title || `${conn.name} - Output`,
                    addedAt: new Date().toISOString()
                };
            }
        }
    });
    const savedWorkbooks = Object.values(workbookMap);
    
    // Build schedules from mappings
    const schedules = config.connections
        .filter(conn => conn.mapping?.schedule?.dayOfWeek && conn.mapping?.schedule?.time)
        .map(conn => {
            // Parse time string to components
            const timeStr = conn.mapping.schedule.time;
            const timeParts = timeStr.match(/(\d{1,2}):(\d{2})/);
            const hour = timeParts ? parseInt(timeParts[1]) : 0;
            const minute = timeParts ? parseInt(timeParts[2]) : 0;
            
            return {
                id: `schedule_${conn.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
                sourceName: conn.name,
                dayOfWeek: conn.mapping.schedule.dayOfWeek,
                hour,
                minute,
                time: timeStr,
                frequency: conn.mapping.schedule.frequency || 'weekly',
                enabled: true,
                lastRun: null,
                nextRun: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        });
    
    // Get existing storage to preserve any non-sync data
    const existing = await getFromStorage([
        'inputSheetId', 
        'sourceMapping', 
        'savedWorkbooks',
        'schedules'
    ]);
    
    // Merge: prefer synced data but preserve manually added items
    await saveToStorage({
        inputSheetId: config.workbookId,
        sourceMapping: sourceMapping,
        savedWorkbooks: savedWorkbooks,
        schedules: schedules
    });
    
    console.log(`${LOG} Legacy storage updated:`, {
        inputSheetId: config.workbookId,
        sourceMappings: Object.keys(sourceMapping).length,
        savedWorkbooks: savedWorkbooks.length,
        schedules: schedules.length
    });
}

/**
 * Get current workbook configuration
 */
export async function getWorkbookConfig() {
    const { workbookConfig } = await getFromStorage(['workbookConfig']);
    return workbookConfig || null;
}

/**
 * Clear workbook configuration
 */
export async function clearWorkbookConfig() {
    console.log(`${LOG} Clearing workbook config...`);
    
    await saveToStorage({
        workbookConfig: null,
        lastSyncChanges: null
    });
    
    console.log(`${LOG} ✅ Workbook config cleared`);
}

/**
 * Set sync interval
 */
export async function setSyncInterval(minutes) {
    const interval = Math.max(
        SYNC_CONFIG.MIN_INTERVAL_MINUTES,
        Math.min(SYNC_CONFIG.MAX_INTERVAL_MINUTES, minutes)
    );
    
    await saveToStorage({
        syncIntervalMinutes: interval
    });
    
    console.log(`${LOG} Sync interval set to ${interval} minutes`);
    return interval;
}

/**
 * Get sync interval
 */
export async function getSyncInterval() {
    const { syncIntervalMinutes } = await getFromStorage(['syncIntervalMinutes']);
    return syncIntervalMinutes || SYNC_CONFIG.DEFAULT_INTERVAL_MINUTES;
}

// ============================================================
// HELPER EXPORTS FOR SCHEDULER INTEGRATION
// ============================================================

/**
 * Get searches for a specific source (for scheduler compatibility)
 */
export async function getSearchesForSource(sourceName) {
    const config = await getWorkbookConfig();
    if (!config) return [];
    
    const connection = config.connections.find(c => c.name === sourceName);
    if (!connection) return [];
    
    return connection.searches.map(s => ({
        source: sourceName,
        title: s.targetTitle,
        url: s.linkedInUrl
    }));
}

/**
 * Get all sources with their search counts
 */
export async function getAllSources() {
    const config = await getWorkbookConfig();
    if (!config) return [];
    
    return config.connections.map(c => ({
        name: c.name,
        searchCount: c.searches.length,
        hasMapping: !!c.mapping,
        hasSchedule: !!(c.mapping?.schedule?.dayOfWeek),
        outputSheetId: c.mapping?.sheetId || null,
        schedule: c.mapping?.schedule || null
    }));
}

/**
 * Get output sheet ID for a source
 */
export async function getOutputSheetForSource(sourceName) {
    const config = await getWorkbookConfig();
    if (!config) return null;
    
    const connection = config.connections.find(c => c.name === sourceName);
    return connection?.mapping?.sheetId || null;
}
