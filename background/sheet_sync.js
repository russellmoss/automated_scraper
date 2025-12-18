// background/sheet_sync.js - Unified Workbook Sync Module
// Manages sync between Google Sheets workbook and extension storage

import { readSheet, validateSpreadsheet, getSheetName } from './sheets_api.js';
import { getSchedules, setSchedule, deleteSchedule } from './scheduler.js';
import { STORAGE_KEYS, LOG_PREFIXES } from '../utils/constants.js';

const LOG = LOG_PREFIXES.SYNC || '[SYNC]';

// ============================================================
// CONFIGURATION
// ============================================================
export const SYNC_CONFIG = {
    DEFAULT_INTERVAL_MINUTES: 5,
    MIN_INTERVAL_MINUTES: 1,
    MAX_INTERVAL_MINUTES: 60,
    SEARCHES_TAB_NAME: 'Searches',
    MAPPINGS_TAB_NAME: 'Mapping and Schedules',
    SEARCHES_RANGE: 'A:C',
    MAPPINGS_RANGE: 'A:H',
    MANAGED_BY_TAG: 'workbookSync', // Tag for schedules we manage
};

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
// PARSING HELPERS
// ============================================================

export function extractSpreadsheetId(input) {
    if (!input) return null;
    const trimmed = input.trim();
    if (!trimmed.includes('/') && /^[a-zA-Z0-9-_]+$/.test(trimmed)) {
        return trimmed;
    }
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

export function extractSheetIdFromUrl(url) {
    if (!url) return null;
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

function parseDayOfWeekToNumber(dayStr) {
    const s = String(dayStr || '').trim().toLowerCase();
    const map = {
        sunday: 0, sun: 0,
        monday: 1, mon: 1,
        tuesday: 2, tue: 2, tues: 2,
        wednesday: 3, wed: 3,
        thursday: 4, thu: 4, thurs: 4,
        friday: 5, fri: 5,
        saturday: 6, sat: 6,
    };
    if (map[s] != null) return map[s];
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 6 ? n : null;
}

function parseTime24h(timeStr) {
    const m = String(timeStr || '').trim().match(/^([0-1]?\d|2[0-3]):([0-5]\d)$/);
    if (!m) return null;
    return { hour: Number(m[1]), minute: Number(m[2]) };
}

function parseFrequency(freqStr) {
    const s = String(freqStr || '').trim().toLowerCase();
    if (s.includes('1st') && s.includes('3rd')) return { frequency: 'biweekly', weekPattern: 'odd' };
    if (s.includes('2nd') && s.includes('4th')) return { frequency: 'biweekly', weekPattern: 'even' };
    if (s.includes('biweekly') && s.includes('odd')) return { frequency: 'biweekly', weekPattern: 'odd' };
    if (s.includes('biweekly') && s.includes('even')) return { frequency: 'biweekly', weekPattern: 'even' };
    return { frequency: 'weekly', weekPattern: null };
}

// ============================================================
// DATA FETCHING
// ============================================================

async function fetchSearchesTab(spreadsheetId) {
    console.log(`${LOG} Fetching Searches tab...`);

    const tabName = SYNC_CONFIG.SEARCHES_TAB_NAME;
    const range = `'${tabName}'!${SYNC_CONFIG.SEARCHES_RANGE}`;

    try {
        const data = await readSheet(spreadsheetId, range);

        if (!data || data.length < 2) {
            console.log(`${LOG} No data in "${tabName}" tab, trying Sheet1 fallback...`);
            return await fetchSearchesFallback(spreadsheetId);
        }

        const searches = data.slice(1)
            .filter(row => row[0] && row[2])
            .map(row => ({
                sourceConnection: (row[0] || '').trim(),
                targetJobTitle: (row[1] || '').trim(),
                linkedInUrl: (row[2] || '').trim()
            }));

        console.log(`${LOG} ✅ Fetched ${searches.length} searches`);
        return searches;

    } catch (error) {
        console.warn(`${LOG} Error fetching Searches tab:`, error.message);
        return await fetchSearchesFallback(spreadsheetId);
    }
}

async function fetchSearchesFallback(spreadsheetId) {
    try {
        const data = await readSheet(spreadsheetId, 'Sheet1!A:C');
        if (!data || data.length < 2) return [];

        const searches = data.slice(1)
            .filter(row => row[0] && row[2])
            .map(row => ({
                sourceConnection: (row[0] || '').trim(),
                targetJobTitle: (row[1] || '').trim(),
                linkedInUrl: (row[2] || '').trim()
            }));

        console.log(`${LOG} ✅ Fallback: Fetched ${searches.length} searches from Sheet1`);
        return searches;
    } catch (e) {
        console.error(`${LOG} ❌ Fallback failed:`, e.message);
        return [];
    }
}

async function fetchMappingsTab(spreadsheetId) {
    console.log(`${LOG} Fetching Mapping and Schedules tab...`);

    const tabName = SYNC_CONFIG.MAPPINGS_TAB_NAME;
    const range = `'${tabName}'!${SYNC_CONFIG.MAPPINGS_RANGE}`;

    try {
        const data = await readSheet(spreadsheetId, range);

        if (!data || data.length < 2) {
            console.log(`${LOG} No mapping data found`);
            return [];
        }

        const mappings = data.slice(1)
            .filter(row => row[0])
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
        console.warn(`${LOG} Mappings tab not found (optional):`, error.message);
        return [];
    }
}

// ============================================================
// CONFIG BUILDING
// ============================================================

function buildUnifiedConfig(searches, mappings, spreadsheetId, workbookUrl, workbookTitle) {
    console.log(`${LOG} Building unified config...`);

    // Create lookup map from mappings
    const mappingsByName = {};
    mappings.forEach(m => {
        mappingsByName[m.name] = {
            sheetUrl: m.sheetUrl,
            sheetId: m.sheetId,
            title: m.title,
            company: m.company,
            schedule: m.schedule
        };
    });

    // Group searches by source and enrich with mappings
    const connectionMap = {};

    searches.forEach(s => {
        const name = s.sourceConnection;

        if (!connectionMap[name]) {
            // Try exact match, then case-insensitive
            let mapping = mappingsByName[name];
            if (!mapping) {
                const lowerName = name.toLowerCase();
                const matchKey = Object.keys(mappingsByName).find(k => k.toLowerCase() === lowerName);
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

    const connections = Object.values(connectionMap).sort((a, b) => a.name.localeCompare(b.name));

    const stats = {
        totalConnections: connections.length,
        connectionsWithMapping: connections.filter(c => c.mapping).length,
        connectionsWithSchedule: connections.filter(c => c.mapping?.schedule?.dayOfWeek).length,
        totalSearches: searches.length,
        unmappedConnections: connections.filter(c => !c.mapping).map(c => c.name)
    };

    console.log(`${LOG} Config built:`, stats);

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

export function detectConfigChanges(oldConfig, newConfig) {
    const changes = [];

    if (!oldConfig?.connections) {
        return [{ type: 'initial_load', message: 'Initial configuration loaded' }];
    }

    const oldNames = new Set(oldConfig.connections.map(c => c.name));
    const newNames = new Set(newConfig.connections.map(c => c.name));

    // Additions
    newConfig.connections.forEach(c => {
        if (!oldNames.has(c.name)) {
            changes.push({ type: 'connection_added', name: c.name, message: `➕ Added: ${c.name}` });
        }
    });

    // Removals
    oldConfig.connections.forEach(c => {
        if (!newNames.has(c.name)) {
            changes.push({ type: 'connection_removed', name: c.name, message: `➖ Removed: ${c.name}` });
        }
    });

    // Modifications
    newConfig.connections.forEach(newConn => {
        const oldConn = oldConfig.connections.find(c => c.name === newConn.name);
        if (!oldConn) return;

        // Schedule changed
        if (JSON.stringify(oldConn.mapping?.schedule) !== JSON.stringify(newConn.mapping?.schedule)) {
            changes.push({ type: 'schedule_changed', name: newConn.name, message: `📅 Schedule updated: ${newConn.name}` });
        }

        // Mapping changed
        if (oldConn.mapping?.sheetId !== newConn.mapping?.sheetId) {
            changes.push({ type: 'mapping_changed', name: newConn.name, message: `📁 Output sheet changed: ${newConn.name}` });
        }

        // Search count changed
        const oldCount = oldConn.searches?.length || 0;
        const newCount = newConn.searches?.length || 0;
        if (oldCount !== newCount) {
            const diff = newCount - oldCount;
            changes.push({ type: 'searches_changed', name: newConn.name, message: `🔍 ${Math.abs(diff)} search(es) ${diff > 0 ? 'added' : 'removed'}: ${newConn.name}` });
        }
    });

    return changes;
}

// ============================================================
// SCHEDULE RECONCILIATION (via scheduler.js APIs)
// ============================================================

async function reconcileSchedulesFromConfig(config) {
    console.log(`${LOG} Reconciling schedules...`);

    const MANAGED_BY = SYNC_CONFIG.MANAGED_BY_TAG;

    // Get existing schedules
    const existing = await getSchedules();
    const managedExisting = existing.filter(s => s.managedBy === MANAGED_BY);

    // Build desired schedules from config
    const desired = [];
    for (const conn of config.connections || []) {
        const sched = conn?.mapping?.schedule;
        const dow = parseDayOfWeekToNumber(sched?.dayOfWeek);
        const time = parseTime24h(sched?.time);

        if (dow == null || !time) continue;

        const { frequency, weekPattern } = parseFrequency(sched?.frequency);

        desired.push({
            id: `ws_${conn.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
            sourceName: conn.name,
            dayOfWeek: dow,
            hour: time.hour,
            minute: time.minute,
            frequency,
            weekPattern,
            enabled: true,
            managedBy: MANAGED_BY
        });
    }

    const desiredBySource = new Map(desired.map(s => [s.sourceName, s]));

    // Upsert desired schedules
    for (const sched of desired) {
        await setSchedule(sched);
    }
    console.log(`${LOG} ✅ Upserted ${desired.length} schedules`);

    // Remove orphaned managed schedules
    let removed = 0;
    for (const old of managedExisting) {
        if (!desiredBySource.has(old.sourceName)) {
            await deleteSchedule(old.id);
            removed++;
        }
    }
    if (removed > 0) {
        console.log(`${LOG} 🗑️ Removed ${removed} orphaned schedules`);
    }
}

// ============================================================
// LEGACY STORAGE UPDATE (backward compatibility)
// ============================================================

async function updateLegacyMappingKeys(config) {
    console.log(`${LOG} Updating legacy storage keys...`);

    // INPUT_SHEET_ID = master workbook ID
    const inputSheetId = config.workbookId;

    // Build sourceMapping: sourceName -> outputWorkbookId
    const sourceMapping = {};

    for (const conn of config.connections || []) {
        const outId = conn?.mapping?.sheetId;
        if (outId) {
            sourceMapping[conn.name] = outId;
        }
    }

    // Build savedWorkbooks list (migration-safe: preserve addedAt, but allow upgrading labels)
    const stored = await getFromStorage([STORAGE_KEYS.SAVED_WORKBOOKS]);
    const existingSaved = stored[STORAGE_KEYS.SAVED_WORKBOOKS] || [];
    const savedById = new Map(existingSaved.map(w => [w.id, w]));

    // For workbook labels, prefer the actual spreadsheet title (not the "Title" column from the mapping tab,
    // which is typically a person's role title like "CEO & Co-Founder").
    for (const conn of config.connections || []) {
        const outId = conn?.mapping?.sheetId;
        const outUrl = conn?.mapping?.sheetUrl;
        if (!outId) continue;

        const existing = savedById.get(outId) || {};

        let workbookTitle = null;
        try {
            workbookTitle = await getSheetName(outId);
        } catch (e) {
            workbookTitle = null;
        }

        // If we can't access the output workbook title (common when not shared),
        // keep existing label if present, otherwise fall back to the ID.
        const label = workbookTitle || existing.title || existing.name || outId;
        const addedAt = existing.addedAt || new Date().toISOString();

        savedById.set(outId, {
            ...existing,
            id: outId,
            url: outUrl || existing.url || `https://docs.google.com/spreadsheets/d/${outId}`,
            // Keep both legacy + new label fields for UI compatibility
            name: label,
            title: label,
            addedAt
        });
    }

    const savedWorkbooks = Array.from(savedById.values());

    await saveToStorage({
        [STORAGE_KEYS.INPUT_SHEET_ID]: inputSheetId,
        [STORAGE_KEYS.SOURCE_MAPPING]: sourceMapping,
        [STORAGE_KEYS.SAVED_WORKBOOKS]: savedWorkbooks
    });

    console.log(`${LOG} ✅ Legacy keys updated: inputSheetId=${inputSheetId}, mappings=${Object.keys(sourceMapping).length}, workbooks=${savedWorkbooks.length}`);
}

// ============================================================
// MAIN SYNC FUNCTIONS
// ============================================================

export async function loadWorkbookConfig(workbookUrl) {
    console.log(`${LOG} 📥 Loading workbook: ${workbookUrl}`);

    const spreadsheetId = extractSpreadsheetId(workbookUrl);
    if (!spreadsheetId) {
        throw new Error('Invalid workbook URL');
    }

    const validation = await validateSpreadsheet(spreadsheetId);
    if (!validation.valid) {
        throw new Error(`Cannot access workbook: ${validation.error}`);
    }

    console.log(`${LOG} Workbook validated: "${validation.title}"`);

    const [searches, mappings] = await Promise.all([
        fetchSearchesTab(spreadsheetId),
        fetchMappingsTab(spreadsheetId)
    ]);

    if (searches.length === 0) {
        throw new Error('No searches found. Ensure "Searches" tab has data in columns A-C.');
    }

    const config = buildUnifiedConfig(searches, mappings, spreadsheetId, workbookUrl, validation.title);

    await saveToStorage({ [STORAGE_KEYS.WORKBOOK_CONFIG]: config });
    await updateLegacyMappingKeys(config);
    await reconcileSchedulesFromConfig(config);

    console.log(`${LOG} ✅ Workbook loaded successfully`);
    return config;
}

export async function syncWorkbookConfig() {
    console.log(`${LOG} 🔄 Syncing workbook...`);

    const stored = await getFromStorage([STORAGE_KEYS.WORKBOOK_CONFIG, STORAGE_KEYS.INPUT_SHEET_ID]);
    let existingConfig = stored[STORAGE_KEYS.WORKBOOK_CONFIG];

    // Fallback: if workbookConfig is missing but legacy INPUT_SHEET_ID exists, treat it as the master workbook.
    // This makes Sync work even if the user only ever configured the legacy flow or storage was partially cleared.
    if (!existingConfig?.workbookId && stored[STORAGE_KEYS.INPUT_SHEET_ID]) {
        const workbookId = stored[STORAGE_KEYS.INPUT_SHEET_ID];
        existingConfig = {
            workbookId,
            workbookUrl: `https://docs.google.com/spreadsheets/d/${workbookId}`,
            workbookTitle: 'Untitled',
            lastSync: null,
            syncStatus: 'success',
            connections: []
        };
        console.log(`${LOG} Using legacy INPUT_SHEET_ID as workbookId: ${workbookId}`);
    }

    if (!existingConfig?.workbookId) {
        console.log(`${LOG} No workbook configured, skipping sync`);
        return { synced: false, reason: 'no_workbook' };
    }

    // Mark as syncing
    await saveToStorage({
        [STORAGE_KEYS.WORKBOOK_CONFIG]: { ...existingConfig, syncStatus: 'syncing' }
    });

    try {
        const [searches, mappings] = await Promise.all([
            fetchSearchesTab(existingConfig.workbookId),
            fetchMappingsTab(existingConfig.workbookId)
        ]);

        let title = existingConfig.workbookTitle;
        try { title = await getSheetName(existingConfig.workbookId); } catch (e) {}

        const newConfig = buildUnifiedConfig(searches, mappings, existingConfig.workbookId, existingConfig.workbookUrl, title);
        const changes = detectConfigChanges(existingConfig, newConfig);

        await saveToStorage({
            [STORAGE_KEYS.WORKBOOK_CONFIG]: newConfig,
            [STORAGE_KEYS.LAST_SYNC_CHANGES]: changes.length > 0 ? changes : null
        });

        await updateLegacyMappingKeys(newConfig);
        await reconcileSchedulesFromConfig(newConfig);

        console.log(`${LOG} ✅ Sync complete, ${changes.length} change(s)`);
        return { synced: true, changes, config: newConfig };

    } catch (error) {
        console.error(`${LOG} ❌ Sync failed:`, error.message);

        await saveToStorage({
            [STORAGE_KEYS.WORKBOOK_CONFIG]: {
                ...existingConfig,
                syncStatus: 'error',
                lastSyncError: error.message,
                lastSyncAttempt: new Date().toISOString()
            }
        });

        return { synced: false, error: error.message };
    }
}

export async function getWorkbookConfig() {
    const { [STORAGE_KEYS.WORKBOOK_CONFIG]: config } = await getFromStorage([STORAGE_KEYS.WORKBOOK_CONFIG]);
    return config || null;
}

export async function clearWorkbookConfig() {
    console.log(`${LOG} Clearing workbook config...`);
    await saveToStorage({
        [STORAGE_KEYS.WORKBOOK_CONFIG]: null,
        [STORAGE_KEYS.LAST_SYNC_CHANGES]: null
    });
}

export async function setSyncInterval(minutes) {
    const interval = Math.max(SYNC_CONFIG.MIN_INTERVAL_MINUTES, Math.min(SYNC_CONFIG.MAX_INTERVAL_MINUTES, minutes));
    await saveToStorage({ [STORAGE_KEYS.SYNC_INTERVAL_MINUTES]: interval });
    console.log(`${LOG} Sync interval set to ${interval} minutes`);
    return interval;
}

export async function getSyncInterval() {
    const { [STORAGE_KEYS.SYNC_INTERVAL_MINUTES]: interval } = await getFromStorage([STORAGE_KEYS.SYNC_INTERVAL_MINUTES]);
    return interval || SYNC_CONFIG.DEFAULT_INTERVAL_MINUTES;
}


