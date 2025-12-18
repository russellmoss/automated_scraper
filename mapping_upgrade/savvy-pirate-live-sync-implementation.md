# Savvy Pirate Live Workbook Sync (Agentic Implementation Plan)

This file is the **agentic, codebase-aligned** implementation plan for the “Live Sheet Sync / Mapping Upgrade”.

It is written so an AI coding agent can implement it **step-by-step** inside this repo without guessing how your existing system works.

## What this upgrade does (target behavior)

- **Single workbook URL** becomes the system-of-record.
- The extension reads two tabs from that workbook:
  - **`Searches`**: *Source Connection | Target Job Title | LinkedIn Search URL*
  - **`Mapping and Schedules`**: *Name | Sheet_URL | Title | Company | Day | Day of Week | Time (24hr) | Frequency*
- It builds a unified config and stores it in `chrome.storage.local`.
- It periodically **polls + diffs** the sheet and applies changes:
  - updates searches
  - updates output workbook mappings (`sourceMapping` / `savedWorkbooks`)
  - updates schedules (`schedules`) in a way that works with your current `background/scheduler.js`

## How this meshes with the current codebase

### Current reality (important for correctness)

- **Searches** today are loaded via:
  - `STORAGE_KEYS.INPUT_SHEET_ID` (`inputSheetId`)
  - `background/service_worker.js` → `GET_SEARCHES` reads `Sheet1!A:C` (not `Searches`)
- **Workbook mapping** today:
  - `STORAGE_KEYS.SOURCE_MAPPING` maps `sourceName -> workbookId`
- `STORAGE_KEYS.SAVED_WORKBOOKS` stores items like `{ id, url, title, addedAt }`
- **Schedules** today are owned by `background/scheduler.js`:
  - canonical API is `setSchedule()`, which computes `nextRun` and merges updates safely
  - schedule fields are `dayOfWeek (0-6), hour, minute, enabled` plus your new biweekly fields:
    - `frequency: 'weekly'|'biweekly'`
    - `weekPattern: 'odd'|'even'`

### Key design choice (to avoid breaking existing features)

This upgrade will:

1. Store unified workbook sync state under **new keys**:
   - `STORAGE_KEYS.WORKBOOK_CONFIG`
   - `STORAGE_KEYS.SYNC_INTERVAL_MINUTES`
   - `STORAGE_KEYS.LAST_SYNC_CHANGES`
2. Keep backward compatibility by **also updating the existing keys your app already uses**:
   - `INPUT_SHEET_ID` (points to the “master workbook” ID)
   - `SOURCE_MAPPING` (source → output workbook ID from Sheet_URL)
   - `SAVED_WORKBOOKS` (ensure output workbooks exist with `url/title`)
   - `SCHEDULES` (reconciled via `scheduler.setSchedule()` instead of raw writes)

## Implementation strategy (step-by-step, agentic)

### Step 0 — Pre-Implementation Verification (REQUIRED)

Before making any code changes, verify these assumptions about the existing codebase:

#### 0a. Verify `scheduler.js` supports custom fields

Open `background/scheduler.js` and check the `setSchedule()` function. It must be able to store arbitrary fields on schedule objects (like `managedBy`).

**If `setSchedule()` uses a strict schema that rejects unknown fields (commonly in the “create new schedule” branch)**, you must first modify it to preserve extra fields.

**CRITICAL**: In this repo, `setSchedule()` currently **generates a random ID on create**. For workbook sync, we MUST preserve a stable ID (`ws_<source>`) so repeated syncs don’t create duplicate schedules.

```javascript
// In setSchedule(), ensure unknown fields are preserved on CREATE:
// (The UPDATE path usually spreads ...scheduleData already.)

// Inside the "Create new" schedule object:
id: scheduleData.id || generateId(),        // CHANGE THIS (do NOT always generateId)
managedBy: scheduleData.managedBy || null,  // ADD THIS LINE
```

#### 0b. Verify `savedWorkbooks` structure

Run this in the service worker console to check the current structure:

```javascript
chrome.storage.local.get('savedWorkbooks', r => console.log(r.savedWorkbooks));
```

Expected structure per item: `{ id, url, title, addedAt }`

If the structure differs (common legacy shape is `{ id, name, addedAt }`), note the actual fields and adjust `updateLegacyMappingKeys()` in Step 2 accordingly **or** keep both via a migration-safe write (Step 2 already writes `url/title` and Step 6 will render `title || name`).

#### 0c. Verify existing `STORAGE_KEYS` and `MESSAGE_ACTIONS`

Open `utils/constants.js` and confirm these keys do NOT already exist (to avoid duplicates):
- `WORKBOOK_CONFIG`
- `SYNC_INTERVAL_MINUTES`
- `LAST_SYNC_CHANGES`
- `LOAD_WORKBOOK`
- `SYNC_WORKBOOK`
- `GET_WORKBOOK_CONFIG`
- `SET_SYNC_INTERVAL`
- `GET_SYNC_STATUS`
- `CLEAR_WORKBOOK`
- `WORKBOOK_SYNC` (in `ALARM_NAMES`)

#### 0d. Check for PI-specific timing constants

If this codebase has Raspberry Pi deployment with adjusted timeouts, note any `CONFIG.API_TIMEOUT` or similar values. The sync module should respect these.

**Gate Check 0**: All verifications pass. Document any deviations found.

### Step 1 — Add constants (minimal additions only)

**File**: `utils/constants.js`

If missing, add the following keys (do NOT duplicate if they already exist):

```javascript
// STORAGE_KEYS additions
WORKBOOK_CONFIG: 'workbookConfig',
SYNC_INTERVAL_MINUTES: 'syncIntervalMinutes',
LAST_SYNC_CHANGES: 'lastSyncChanges',

// MESSAGE_ACTIONS additions
LOAD_WORKBOOK: 'LOAD_WORKBOOK',
SYNC_WORKBOOK: 'SYNC_WORKBOOK',
GET_WORKBOOK_CONFIG: 'GET_WORKBOOK_CONFIG',
SET_SYNC_INTERVAL: 'SET_SYNC_INTERVAL',
GET_SYNC_STATUS: 'GET_SYNC_STATUS',
CLEAR_WORKBOOK: 'CLEAR_WORKBOOK',

// ALARM_NAMES additions
WORKBOOK_SYNC: 'workbook-sync-alarm',
```

**Gate Check 1**: Verify constants are available (service worker console after reload):

```javascript
// Should print the string values (not undefined)
console.log('WORKBOOK_CONFIG=', (typeof STORAGE_KEYS !== 'undefined') && STORAGE_KEYS.WORKBOOK_CONFIG);
console.log('LOAD_WORKBOOK=', (typeof MESSAGE_ACTIONS !== 'undefined') && MESSAGE_ACTIONS.LOAD_WORKBOOK);
console.log('WORKBOOK_SYNC=', (typeof ALARM_NAMES !== 'undefined') && ALARM_NAMES.WORKBOOK_SYNC);
```

### Step 2 — Create `background/sheet_sync.js` (new module)

**File to create**: `background/sheet_sync.js`

Create the following file from scratch:

Create this file with the following complete contents:

```javascript
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
    MANAGED_BY_TAG: 'workbookSync',  // Tag for schedules we manage
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

    // Build savedWorkbooks list
    const stored = await getFromStorage([STORAGE_KEYS.SAVED_WORKBOOKS]);
    const existingSaved = stored[STORAGE_KEYS.SAVED_WORKBOOKS] || [];
    const savedById = new Map(existingSaved.map(w => [w.id, w]));

    for (const conn of config.connections || []) {
        const outId = conn?.mapping?.sheetId;
        const outUrl = conn?.mapping?.sheetUrl;
        if (!outId || savedById.has(outId)) continue;

        savedById.set(outId, {
            id: outId,
            url: outUrl || `https://docs.google.com/spreadsheets/d/${outId}`,
            title: conn.mapping?.title || `${conn.name} - Output`,
            addedAt: new Date().toISOString()
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

    const { [STORAGE_KEYS.WORKBOOK_CONFIG]: existingConfig } = await getFromStorage([STORAGE_KEYS.WORKBOOK_CONFIG]);

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
```

**Gate Check 2**: File created, no syntax errors when loaded.

### Step 3 — Wire into the service worker (alarm + message handlers)

**File**: `background/service_worker.js`

#### 3.0 Add imports

At the top of `background/service_worker.js`, add:

```javascript
import {
    loadWorkbookConfig,
    syncWorkbookConfig,
    getWorkbookConfig,
    clearWorkbookConfig,
    setSyncInterval,
    getSyncInterval
} from './sheet_sync.js';
```

#### 3.1 Add message handlers

In `background/service_worker.js`, find the big `chrome.runtime.onMessage.addListener(...)` switch over `action`.

Add these new cases (use your existing async IIFE pattern and `sendResponse` like other cases):

```javascript
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

    const config = await loadWorkbookConfig(workbookUrl);

    // Create/refresh alarm AFTER successful load
    const syncInterval = await getSyncInterval();
    chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, { periodInMinutes: syncInterval });

    // For UI convenience, return latest changes if present
    const { [STORAGE_KEYS.LAST_SYNC_CHANGES]: lastChanges } = await getFromStorage([STORAGE_KEYS.LAST_SYNC_CHANGES]);
    response = { success: true, config, changes: lastChanges || null };
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
```

#### 3.2 Make searches load from `Searches` tab (critical for “Load workbook” to work)

Your current service worker reads searches from `Sheet1!A:C`. With Live Sync, the system-of-record is the `Searches` tab.

Make these two changes in `background/service_worker.js`:

1) In the `GET_SEARCHES` handler, prefer `'Searches'!A:C` and fall back to `Sheet1!A:C`:

```javascript
// Replace:
// const searchData = await readSheet(inputSheetId, 'Sheet1!A:C');
// With:
const searchData = await readSheet(inputSheetId, "'Searches'!A:C").catch(() => readSheet(inputSheetId, 'Sheet1!A:C'));
```

2) In `executeScheduledRun()`, do the same:

```javascript
// Replace:
// const searchData = await readSheet(inputSheetId, 'Sheet1!A:C');
// With:
const searchData = await readSheet(inputSheetId, "'Searches'!A:C").catch(() => readSheet(inputSheetId, 'Sheet1!A:C'));
```

#### 3a. Alarm handler (`WORKBOOK_SYNC`) with race-condition guard

Add `WORKBOOK_SYNC` alarm handling inside your existing `chrome.alarms.onAlarm` switch.

**IMPORTANT**: Skip sync if scraping is active (prevent race conditions).

```javascript
case ALARM_NAMES.WORKBOOK_SYNC:
    console.log(`${LOG} 🔄 Workbook sync alarm triggered`);
    try {
        // IMPORTANT: Skip sync if scraping is active (prevent race conditions)
        const { autoRunState, manualScrapeState } = await getFromStorage([
            'autoRunState', 'manualScrapeState'
        ]);
        if (autoRunState?.isRunning || manualScrapeState?.isRunning) {
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
```

#### 3b. Extension Startup Behavior

On `chrome.runtime.onInstalled`:
- Create the sync alarm (does NOT trigger immediately)
- First sync happens after `syncInterval` minutes OR when user clicks Load

Add this (near your other runtime listeners):

```javascript
chrome.runtime.onInstalled.addListener(async () => {
    console.log(`${LOG} Extension installed/updated`);
    // Do not force-load a workbook. Only ensure an alarm exists if a workbook is already configured.
    const config = await getWorkbookConfig();
    if (config?.workbookId) {
        const syncInterval = await getSyncInterval();
        chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, { periodInMinutes: syncInterval });
        console.log(`${LOG} Workbook sync alarm created on install (${syncInterval} min)`);
    }
});
```

On `chrome.runtime.onStartup` (browser restart):
- Recreate alarm if workbook was previously configured:

```javascript
chrome.runtime.onStartup.addListener(async () => {
    console.log(`${LOG} Extension startup`);

    const config = await getWorkbookConfig();
    if (config?.workbookId) {
        const syncInterval = await getSyncInterval();
        chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, {
            periodInMinutes: syncInterval
        });
        console.log(`${LOG} Workbook sync alarm restored (${syncInterval} min)`);
    }
});
```

#### 3c. Match this repo’s existing initialization pattern (recommended)

This codebase already uses an initialization async IIFE at the bottom of `background/service_worker.js`.

Inside that existing initialization block, after loading state from storage, restore the workbook sync alarm if a workbook is configured:

```javascript
const stored = await getFromStorage([STORAGE_KEYS.WORKBOOK_CONFIG, STORAGE_KEYS.SYNC_INTERVAL_MINUTES]);
const cfg = stored[STORAGE_KEYS.WORKBOOK_CONFIG];
const interval = stored[STORAGE_KEYS.SYNC_INTERVAL_MINUTES] || 5;

if (cfg?.workbookId) {
    chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, { periodInMinutes: interval });
    console.log(`${LOG} Workbook sync alarm restored from init (${interval} min)`);
}
```

**Gate Check 3**: Verify service worker wiring (after reload):

```javascript
chrome.runtime.sendMessage({action: 'GET_WORKBOOK_CONFIG'}, r => console.log(r));
// Should return something like: { success: true, config: null, lastChanges: null }

// If you loaded a workbook already, you should also see the alarm:
chrome.alarms.get('workbook-sync-alarm', a => console.log('workbook alarm=', a));
```

### Step 4 — Modify `popup/popup.html`

#### 4a. Replace the Input Sheet section

Find this section:

```html
<!-- SECTION: Input Sheet -->
<section class="section" id="section-input">
```

Replace the ENTIRE section (from opening `<section>` to its closing `</section>`) with:

```html
<!-- SECTION: Workbook Configuration (Live Sync) -->
<section class="section" id="section-workbook-config">
    <div class="section-header" data-section="workbook-config">
        <span>📘 Workbook Configuration (Live Sync)</span>
        <span class="chevron">▼</span>
    </div>
    <div class="section-content">
        <div class="input-group">
            <input type="text" id="workbook-url" name="workbook-url" placeholder="Master workbook URL or ID">
            <button id="load-workbook-btn" class="btn btn-primary">Load</button>
        </div>

        <div class="input-group">
            <button id="sync-workbook-btn" class="btn btn-secondary">Sync Now</button>
            <button id="clear-workbook-btn" class="btn btn-outline">Clear</button>
        </div>

        <div class="input-group">
            <label for="sync-interval-select">Sync interval</label>
            <select id="sync-interval-select" name="sync-interval-select">
                <option value="1">1 min</option>
                <option value="5" selected>5 min</option>
                <option value="10">10 min</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="60">60 min</option>
            </select>
        </div>

        <div id="sync-status-container" class="info-box hidden"></div>
        <div id="sync-changes-container" class="results-box hidden"></div>
    </div>
</section>

```

#### 4b. Verify no duplicate IDs

Ensure these IDs don't exist elsewhere in the file:
- `workbook-url`
- `load-workbook-btn`
- `sync-status-container`
- `sync-changes-container`
- `sync-interval-select`
- `sync-workbook-btn`
- `clear-workbook-btn`

**Gate Check 4**: HTML valid, popup opens without errors:
- □ Open popup, no console errors
- □ “Workbook Configuration (Live Sync)” section visible
- □ Buttons and dropdown render

### Step 5 — Modify `popup/popup.css`

#### 5a. Add sync status styles at end of file

Append these styles to the END of `popup/popup.css`:

```css
/* ============================================================
   LIVE WORKBOOK SYNC
   ============================================================ */
.sync-status-success { border-left: 4px solid var(--accent-green); }
.sync-status-error { border-left: 4px solid var(--accent-red); }
.sync-status-syncing { border-left: 4px solid var(--accent-gold); }

#sync-changes-container {
    max-height: 140px;
    overflow-y: auto;
}
```

**Gate Check 5**: No CSS syntax errors, styles apply (status box shows with left border).

### Step 6 — Modify `popup/popup.js`

#### 6a. Add to state object (near top of file)

Find:

```javascript
let state = {
```

Add these properties:

```javascript
    workbookConfig: null,
    lastSyncChanges: null,
```

#### 6b. Add to `cacheElements()` function

Inside `cacheElements()`, do BOTH:

1) **Remove/disable the legacy Input Sheet element caching** (because Step 4 removed that HTML). Delete or comment out:

```javascript
    // Input Sheet
    elements.inputSheetUrl = document.getElementById('input-sheet-url');
    elements.loadSheetBtn = document.getElementById('load-sheet-btn');
    elements.inputSheetInfo = document.getElementById('input-sheet-info');
    elements.inputSheetLink = document.getElementById('input-sheet-link');
    elements.searchCount = document.getElementById('search-count');
```

2) Add the new Live Sync elements:

```javascript
    // Live Sync (Workbook Config)
    elements.workbookUrl = document.getElementById('workbook-url');
    elements.loadWorkbookBtn = document.getElementById('load-workbook-btn');
    elements.syncWorkbookBtn = document.getElementById('sync-workbook-btn');
    elements.clearWorkbookBtn = document.getElementById('clear-workbook-btn');
    elements.syncIntervalSelect = document.getElementById('sync-interval-select');
    elements.syncStatusContainer = document.getElementById('sync-status-container');
    elements.syncChangesContainer = document.getElementById('sync-changes-container');
```

#### 6c. Add to `setupEventListeners()` function

Inside `setupEventListeners()`, do BOTH:

1) **Remove/disable the legacy Input Sheet listener** (because the button no longer exists). Delete or comment out:

```javascript
    // Input Sheet
    elements.loadSheetBtn.addEventListener('click', loadInputSheet);
```

2) Add the new Live Sync listeners:

```javascript
    // Live Sync (Workbook Config)
    elements.loadWorkbookBtn.addEventListener('click', loadWorkbookConfigFromPopup);
    elements.syncWorkbookBtn.addEventListener('click', syncWorkbookNowFromPopup);
    elements.clearWorkbookBtn.addEventListener('click', clearWorkbookFromPopup);
    elements.syncIntervalSelect.addEventListener('change', onSyncIntervalChange);
```

#### 6d. Add new functions (before `loadInitialData()`)

Add these functions BEFORE `loadInitialData()`:

```javascript
function renderSyncStatus(config) {
    if (!elements.syncStatusContainer) return;

    if (!config) {
        elements.syncStatusContainer.classList.add('hidden');
        elements.syncStatusContainer.textContent = '';
        elements.syncStatusContainer.classList.remove('sync-status-success', 'sync-status-error', 'sync-status-syncing');
        return;
    }

    const status = config.syncStatus || 'unknown';
    elements.syncStatusContainer.classList.remove('hidden');
    elements.syncStatusContainer.classList.remove('sync-status-success', 'sync-status-error', 'sync-status-syncing');

    if (status === 'success') elements.syncStatusContainer.classList.add('sync-status-success');
    if (status === 'error') elements.syncStatusContainer.classList.add('sync-status-error');
    if (status === 'syncing') elements.syncStatusContainer.classList.add('sync-status-syncing');

    const title = config.workbookTitle || 'Untitled';
    const lastSync = config.lastSync ? formatDate(config.lastSync) : '-';
    const err = config.lastSyncError ? ` • Error: ${config.lastSyncError}` : '';

    elements.syncStatusContainer.textContent = `${title} • Status: ${status} • Last sync: ${lastSync}${err}`;
}

function renderSyncChanges(changes) {
    if (!elements.syncChangesContainer) return;

    if (!changes || changes.length === 0) {
        elements.syncChangesContainer.classList.add('hidden');
        elements.syncChangesContainer.textContent = '';
        return;
    }

    elements.syncChangesContainer.classList.remove('hidden');
    elements.syncChangesContainer.innerHTML = changes.map(c => `<div>${c.message || JSON.stringify(c)}</div>`).join('');
}

async function loadWorkbookConfigFromPopup() {
    const url = elements.workbookUrl?.value?.trim();
    if (!url) return showToast('Please enter a workbook URL or ID', 'error');

    setButtonLoading(elements.loadWorkbookBtn, true);
    try {
        const r = await sendMessage('LOAD_WORKBOOK', { workbookUrl: url });
        state.workbookConfig = r.config || null;
        state.lastSyncChanges = r.changes || null;
        renderSyncStatus(state.workbookConfig);
        renderSyncChanges(state.lastSyncChanges);
        showToast('Workbook loaded', 'success');

        // Reload legacy-driven UI (searches/workbooks/mappings/schedules)
        await loadInitialData();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        setButtonLoading(elements.loadWorkbookBtn, false);
    }
}

async function syncWorkbookNowFromPopup() {
    setButtonLoading(elements.syncWorkbookBtn, true);
    try {
        const r = await sendMessage('SYNC_WORKBOOK');
        state.workbookConfig = r.config || state.workbookConfig;
        state.lastSyncChanges = r.changes || null;
        renderSyncStatus(state.workbookConfig);
        renderSyncChanges(state.lastSyncChanges);
        showToast('Sync complete', 'success');

        await loadInitialData();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        setButtonLoading(elements.syncWorkbookBtn, false);
    }
}

async function clearWorkbookFromPopup() {
    setButtonLoading(elements.clearWorkbookBtn, true);
    try {
        await sendMessage('CLEAR_WORKBOOK');
        state.workbookConfig = null;
        state.lastSyncChanges = null;
        renderSyncStatus(null);
        renderSyncChanges(null);
        showToast('Workbook cleared', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        setButtonLoading(elements.clearWorkbookBtn, false);
    }
}

async function onSyncIntervalChange() {
    const minutes = Number(elements.syncIntervalSelect.value);
    try {
        const r = await sendMessage('SET_SYNC_INTERVAL', { minutes });
        showToast(`Sync interval set to ${r.minutes} min`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}
```

#### 6e. Modify `loadInitialData()` function (beginning)

At the start of `loadInitialData()`, add a workbook-config fetch:

```javascript
        // Live Sync: load workbook config + last changes (non-fatal)
        const cfg = await sendMessage('GET_WORKBOOK_CONFIG').catch(() => ({ config: null, lastChanges: null }));
        state.workbookConfig = cfg.config || null;
        state.lastSyncChanges = cfg.lastChanges || null;
        renderSyncStatus(state.workbookConfig);
        renderSyncChanges(state.lastSyncChanges);
```

Then remove/disable the legacy Input Sheet UI population block (because Step 4 removed those DOM nodes). Delete or comment out this entire section:

```javascript
        // Load saved input sheet ID and display it
        const inputSheetResult = await sendMessage('GET_INPUT_SHEET_INFO').catch(() => ({ sheetId: null, title: null }));
        if (inputSheetResult.sheetId) {
            state.inputSheetId = inputSheetResult.sheetId;
            state.inputSheetTitle = inputSheetResult.title;
            elements.inputSheetUrl.value = `https://docs.google.com/spreadsheets/d/${inputSheetResult.sheetId}`;
            elements.inputSheetInfo.classList.remove('hidden');
            elements.inputSheetLink.href = `https://docs.google.com/spreadsheets/d/${inputSheetResult.sheetId}`;
            if (inputSheetResult.title) {
                elements.inputSheetLink.textContent = inputSheetResult.title;
            }
        }
```

Finally, after you load `state.searches`, if a workbook is configured, populate the workbook URL input:

```javascript
        if (state.workbookConfig?.workbookUrl && elements.workbookUrl) {
            elements.workbookUrl.value = state.workbookConfig.workbookUrl;
        }
```

Also remove/disable the legacy search-count UI block (because Step 4 removed `#search-count` / `#input-sheet-info`):

```javascript
        // Update search count
        if (state.searches.length > 0) {
            elements.inputSheetInfo.classList.remove('hidden');
            elements.searchCount.textContent = `${state.searches.length} searches loaded`;
        }
```

#### 6f. Make workbook rendering migration-safe (`title || name`)

Add this helper near the top of the file (utilities section is fine):

```javascript
function getWorkbookLabel(w) {
    if (!w) return '';
    return w.title || w.name || w.id;
}
```

Then update `renderWorkbookMappings()`:

```javascript
// Replace:
// <span class="mapping-workbook">${workbook ? workbook.name : 'Not mapped'}</span>
// With:
<span class="mapping-workbook">${workbook ? getWorkbookLabel(workbook) : 'Not mapped'}</span>
```

And update the workbook dropdown option label:

```javascript
// Replace:
// ${w.name}
// With:
${getWorkbookLabel(w)}
```

Also update any other dropdowns that render workbook names (ex: compare dropdowns) to use `getWorkbookLabel(w)`.

#### 6g. Add storage change listener (keep popup in sync)

Append to the END of `popup/popup.js`:

```javascript
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.workbookConfig) {
        state.workbookConfig = changes.workbookConfig.newValue || null;
        renderSyncStatus(state.workbookConfig);
    }
    if (changes.lastSyncChanges) {
        state.lastSyncChanges = changes.lastSyncChanges.newValue || null;
        renderSyncChanges(state.lastSyncChanges);
    }
});
```

**Gate Check 6**: Popup functions correctly:
- □ Load workbook URL → shows status/stats
- □ Sync Now works
- □ Clear works
- □ Interval selector works (no console errors)
- □ Existing mapping UI still renders (workbook names show)

## Error Recovery

### "Cannot access workbook" on Load
1. Check the workbook is shared with the Google account used for OAuth
2. Verify the URL is correct (not a specific tab URL)
3. Try re-authenticating: `chrome.identity.removeCachedAuthToken()`

### Sync stuck in "syncing" state
1. Open service worker console
2. Run: `chrome.storage.local.get('workbookConfig', r => console.log(r))`
3. If `syncStatus: 'syncing'` persists, manually reset:

```javascript
chrome.storage.local.get('workbookConfig', r => {
    if (r.workbookConfig) {
        r.workbookConfig.syncStatus = 'error';
        chrome.storage.local.set({workbookConfig: r.workbookConfig});
    }
});
```

### Schedules not updating from sheet
1. Verify `managedBy` field is preserved in `scheduler.js` (Step 0a)
2. Check service worker logs for "Reconciling schedules"
3. Verify schedule format in sheet matches expected: `Day of Week` = "Monday", `Time (24hr)` = "14:30"

### Legacy storage out of sync
Run manual resync:

```javascript
chrome.runtime.sendMessage({action: 'SYNC_WORKBOOK'}, r => console.log(r));
```

### Step 7 — Testing checklist (agentic-ready)

- Load workbook URL (should populate sources)
- Verify sourceMapping auto-populates from the mapping tab
- Verify schedules are created/updated (and biweekly strings map to your new schedule fields)
- Make a change in the sheet, wait for poll, confirm badge + UI updates

---

## ⛔ END OF IMPLEMENTATION STEPS ⛔

**STOP HERE.** Everything below this line is archived reference material and should NOT be implemented.

---

## Legacy Reference (ARCHIVED - DO NOT IMPLEMENT)

The remainder of this document is the original v2.1 draft + full code dumps that inspired the upgrade.

## Overview

This implementation adds the ability to:
1. Load a single workbook URL and automatically fetch **both** the "Searches" tab and "Mapping and Schedules" tab
2. Merge the data into a unified configuration
3. Keep the extension synced with live changes via polling
4. Auto-detect when sources are added, removed, or modified

---

## Data Structure

### Searches Tab (columns A:C)
```
Source Connection | Target Job Title | LinkedIn Search URL
Jeff Nash         | Financial Advisor | https://linkedin.com/search/...
Jeff Nash         | Wealth Manager    | https://linkedin.com/search/...
```

### Mapping and Schedules Tab (columns A:H)
```
Name | Sheet_URL | Title | Company | Day | Day of Week | Time (24hr) | Frequency
Jeff Nash | https://docs.google.com/spreadsheets/d/... | CEO & Co-Founder | Bridgemark | Saturday 8:30 AM | Tuesday | 12:23 | 1st & 3rd week of month
```

### Unified Config (in chrome.storage.local)
```javascript
{
  workbookConfig: {
    workbookId: "spreadsheet_id",
    workbookUrl: "https://docs.google.com/.../d/spreadsheet_id",
    lastSync: "2024-12-18T10:30:00Z",
    syncStatus: "success" | "error" | "syncing",
    connections: [
      {
        name: "Jeff Nash",
        mapping: {
          sheetUrl: "https://docs.google.com/spreadsheets/d/...",
          sheetId: "extracted_id",
          title: "CEO & Co-Founder",
          company: "Bridgemark Strategies",
          schedule: {
            day: "Saturday 8:30 AM",
            dayOfWeek: "Tuesday",
            time: "12:23",
            frequency: "1st & 3rd week of month"
          }
        },
        searches: [
          { targetTitle: "Financial Advisor", linkedInUrl: "https://..." },
          { targetTitle: "Wealth Manager", linkedInUrl: "https://..." }
        ]
      }
    ]
  }
}
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `utils/constants.js` | Modify | Add new storage keys, message actions, alarm names |
| `background/sheet_sync.js` | **New** | Unified workbook sync logic |
| `background/service_worker.js` | Modify | Add message handlers and alarm integration |
| `popup/popup.html` | Modify | Add sync status UI elements |
| `popup/popup.js` | Modify | Add sync functions and UI updates |
| `popup/popup.css` | Modify | Add sync status styling |

---

## Implementation Files

### 1. utils/constants.js (ADDITIONS)

Add these to your existing constants file:

```javascript
// ============================================================
// ADD TO EXISTING STORAGE_KEYS
// ============================================================
export const STORAGE_KEYS = {
    // ... existing keys ...
    
    // NEW: Unified Workbook Config
    WORKBOOK_CONFIG: 'workbookConfig',
    SYNC_INTERVAL_MINUTES: 'syncIntervalMinutes',
    LAST_SYNC_CHANGES: 'lastSyncChanges',
};

// ============================================================
// ADD TO EXISTING MESSAGE_ACTIONS
// ============================================================
export const MESSAGE_ACTIONS = {
    // ... existing actions ...
    
    // NEW: Workbook Sync
    LOAD_WORKBOOK: 'LOAD_WORKBOOK',
    SYNC_WORKBOOK: 'SYNC_WORKBOOK',
    GET_WORKBOOK_CONFIG: 'GET_WORKBOOK_CONFIG',
    SET_SYNC_INTERVAL: 'SET_SYNC_INTERVAL',
    GET_SYNC_STATUS: 'GET_SYNC_STATUS',
    CLEAR_WORKBOOK: 'CLEAR_WORKBOOK',
};

// ============================================================
// ADD TO EXISTING ALARM_NAMES
// ============================================================
export const ALARM_NAMES = {
    // ... existing alarms ...
    
    // NEW: Workbook Sync
    WORKBOOK_SYNC: 'workbook-sync-alarm',
};

// ============================================================
// NEW: Sync Configuration
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
```

---

### 2. background/sheet_sync.js (NEW FILE)

```javascript
// background/sheet_sync.js - Unified Workbook Sync Module

import { getAuthToken } from './auth.js';
import { readSheet, validateSpreadsheet, getSheetName } from './sheets_api.js';
import { STORAGE_KEYS, SYNC_CONFIG, LOG_PREFIXES } from '../utils/constants.js';

const LOG = '[SYNC]';

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
    
    // Already an ID (no slashes, looks like a sheet ID)
    if (!input.includes('/') && /^[a-zA-Z0-9-_]+$/.test(input.trim())) {
        return input.trim();
    }
    
    // URL format: https://docs.google.com/spreadsheets/d/{ID}/...
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
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
            console.log(`${LOG} No search data found (or only headers)`);
            return [];
        }
        
        // Skip header row, map to objects
        const searches = data.slice(1)
            .filter(row => row[0] && row[2]) // Must have source and URL
            .map(row => ({
                sourceConnection: (row[0] || '').trim(),
                targetJobTitle: (row[1] || '').trim(),
                linkedInUrl: (row[2] || '').trim()
            }));
        
        console.log(`${LOG} Fetched ${searches.length} searches`);
        return searches;
        
    } catch (error) {
        // Tab might not exist or different name
        console.error(`${LOG} Error fetching Searches tab:`, error.message);
        
        // Try fallback to Sheet1 (original format)
        try {
            console.log(`${LOG} Trying fallback to Sheet1...`);
            const data = await readSheet(spreadsheetId, 'Sheet1!A:C');
            
            if (!data || data.length < 2) return [];
            
            const searches = data.slice(1)
                .filter(row => row[0] && row[2])
                .map(row => ({
                    sourceConnection: (row[0] || '').trim(),
                    targetJobTitle: (row[1] || '').trim(),
                    linkedInUrl: (row[2] || '').trim()
                }));
            
            console.log(`${LOG} Fallback: Fetched ${searches.length} searches from Sheet1`);
            return searches;
            
        } catch (fallbackError) {
            console.error(`${LOG} Fallback also failed:`, fallbackError.message);
            throw new Error(`Could not read searches: ${error.message}`);
        }
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
        
        console.log(`${LOG} Fetched ${mappings.length} mappings`);
        return mappings;
        
    } catch (error) {
        console.error(`${LOG} Error fetching Mappings tab:`, error.message);
        // Mappings tab is optional - return empty if not found
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
        mappingsByName[m.name] = {
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
            connectionMap[name] = {
                name,
                mapping: mappingsByName[name] || null,
                searches: []
            };
        }
        
        connectionMap[name].searches.push({
            targetTitle: s.targetJobTitle,
            linkedInUrl: s.linkedInUrl
        });
    });
    
    const connections = Object.values(connectionMap);
    
    // Count stats
    const stats = {
        totalConnections: connections.length,
        connectionsWithMapping: connections.filter(c => c.mapping).length,
        connectionsWithSchedule: connections.filter(c => c.mapping?.schedule?.dayOfWeek).length,
        totalSearches: searches.length
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

/**
 * Compare two configs and detect changes
 */
export function detectConfigChanges(oldConfig, newConfig) {
    const changes = [];
    
    if (!oldConfig) {
        return [{ type: 'initial_load', message: 'Initial configuration loaded' }];
    }
    
    const oldNames = new Set(oldConfig.connections?.map(c => c.name) || []);
    const newNames = new Set(newConfig.connections?.map(c => c.name) || []);
    
    // New connections added
    newConfig.connections.forEach(c => {
        if (!oldNames.has(c.name)) {
            changes.push({ 
                type: 'connection_added', 
                name: c.name,
                message: `New connection added: ${c.name}`
            });
        }
    });
    
    // Connections removed
    oldConfig.connections?.forEach(c => {
        if (!newNames.has(c.name)) {
            changes.push({ 
                type: 'connection_removed', 
                name: c.name,
                message: `Connection removed: ${c.name}`
            });
        }
    });
    
    // Check for modifications
    newConfig.connections.forEach(newConn => {
        const oldConn = oldConfig.connections?.find(c => c.name === newConn.name);
        if (oldConn) {
            // Schedule changed
            const oldSchedule = JSON.stringify(oldConn.mapping?.schedule || {});
            const newSchedule = JSON.stringify(newConn.mapping?.schedule || {});
            if (oldSchedule !== newSchedule) {
                changes.push({ 
                    type: 'schedule_changed', 
                    name: newConn.name,
                    message: `Schedule updated for: ${newConn.name}`
                });
            }
            
            // Mapping changed (sheet URL)
            if (oldConn.mapping?.sheetId !== newConn.mapping?.sheetId) {
                changes.push({ 
                    type: 'mapping_changed', 
                    name: newConn.name,
                    message: `Output sheet changed for: ${newConn.name}`
                });
            }
            
            // Searches changed
            if (oldConn.searches.length !== newConn.searches.length) {
                changes.push({ 
                    type: 'searches_changed', 
                    name: newConn.name,
                    message: `Search count changed for: ${newConn.name} (${oldConn.searches.length} → ${newConn.searches.length})`
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
    console.log(`${LOG} Loading workbook config from: ${workbookUrl}`);
    
    const spreadsheetId = extractSpreadsheetId(workbookUrl);
    if (!spreadsheetId) {
        throw new Error('Invalid workbook URL');
    }
    
    // Validate access
    const validation = await validateSpreadsheet(spreadsheetId);
    if (!validation.valid) {
        throw new Error(`Cannot access workbook: ${validation.error}`);
    }
    
    // Fetch both tabs in parallel
    const [searches, mappings] = await Promise.all([
        fetchSearchesTab(spreadsheetId),
        fetchMappingsTab(spreadsheetId)
    ]);
    
    if (searches.length === 0) {
        throw new Error('No searches found in workbook. Check that the "Searches" tab exists with data.');
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
        [STORAGE_KEYS.WORKBOOK_CONFIG]: config 
    });
    
    // Also update legacy storage for backward compatibility
    await updateLegacyStorage(config);
    
    console.log(`${LOG} ✅ Workbook config loaded and saved`);
    return config;
}

/**
 * Sync workbook configuration (periodic refresh)
 */
export async function syncWorkbookConfig() {
    console.log(`${LOG} Syncing workbook config...`);
    
    // Get existing config
    const { workbookConfig: existingConfig } = await getFromStorage([STORAGE_KEYS.WORKBOOK_CONFIG]);
    
    if (!existingConfig?.workbookId) {
        console.log(`${LOG} No workbook configured, skipping sync`);
        return { synced: false, reason: 'no_workbook' };
    }
    
    // Update status to syncing
    await saveToStorage({
        [STORAGE_KEYS.WORKBOOK_CONFIG]: {
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
            [STORAGE_KEYS.WORKBOOK_CONFIG]: newConfig,
            [STORAGE_KEYS.LAST_SYNC_CHANGES]: changes
        });
        
        // Update legacy storage
        await updateLegacyStorage(newConfig);
        
        if (changes.length > 0) {
            console.log(`${LOG} ✅ Sync complete with ${changes.length} changes:`, changes);
        } else {
            console.log(`${LOG} ✅ Sync complete, no changes detected`);
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
            [STORAGE_KEYS.WORKBOOK_CONFIG]: {
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
    
    // Build saved workbooks list (unique sheet IDs)
    const workbookMap = {};
    config.connections.forEach(conn => {
        if (conn.mapping?.sheetId && conn.mapping?.sheetUrl) {
            workbookMap[conn.mapping.sheetId] = {
                id: conn.mapping.sheetId,
                url: conn.mapping.sheetUrl,
                title: `${conn.name} - Output`,
                addedAt: new Date().toISOString()
            };
        }
    });
    const savedWorkbooks = Object.values(workbookMap);
    
    // Build schedules from mappings
    const schedules = config.connections
        .filter(conn => conn.mapping?.schedule?.dayOfWeek && conn.mapping?.schedule?.time)
        .map(conn => ({
            id: `schedule_${conn.name.replace(/\s+/g, '_').toLowerCase()}`,
            sourceName: conn.name,
            dayOfWeek: conn.mapping.schedule.dayOfWeek,
            time: conn.mapping.schedule.time,
            frequency: conn.mapping.schedule.frequency,
            enabled: true,
            lastRun: null,
            createdAt: new Date().toISOString()
        }));
    
    await saveToStorage({
        [STORAGE_KEYS.INPUT_SHEET_ID]: config.workbookId,
        [STORAGE_KEYS.SOURCE_MAPPING]: sourceMapping,
        [STORAGE_KEYS.SAVED_WORKBOOKS]: savedWorkbooks,
        [STORAGE_KEYS.SCHEDULES]: schedules
    });
    
    console.log(`${LOG} Legacy storage updated:`, {
        inputSheetId: config.workbookId,
        sourceMappingCount: Object.keys(sourceMapping).length,
        savedWorkbooksCount: savedWorkbooks.length,
        schedulesCount: schedules.length
    });
}

/**
 * Get current workbook configuration
 */
export async function getWorkbookConfig() {
    const { workbookConfig } = await getFromStorage([STORAGE_KEYS.WORKBOOK_CONFIG]);
    return workbookConfig || null;
}

/**
 * Clear workbook configuration
 */
export async function clearWorkbookConfig() {
    console.log(`${LOG} Clearing workbook config...`);
    
    await saveToStorage({
        [STORAGE_KEYS.WORKBOOK_CONFIG]: null,
        [STORAGE_KEYS.LAST_SYNC_CHANGES]: null
    });
    
    // Optionally clear legacy storage too
    // await saveToStorage({
    //     [STORAGE_KEYS.INPUT_SHEET_ID]: null,
    //     [STORAGE_KEYS.SOURCE_MAPPING]: {},
    //     [STORAGE_KEYS.SAVED_WORKBOOKS]: [],
    // });
    
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
        [STORAGE_KEYS.SYNC_INTERVAL_MINUTES]: interval
    });
    
    console.log(`${LOG} Sync interval set to ${interval} minutes`);
    return interval;
}

/**
 * Get sync interval
 */
export async function getSyncInterval() {
    const { syncIntervalMinutes } = await getFromStorage([STORAGE_KEYS.SYNC_INTERVAL_MINUTES]);
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
        outputSheetId: c.mapping?.sheetId || null
    }));
}
```

---

### 3. background/service_worker.js (MODIFICATIONS)

Add these imports at the top:

```javascript
// ADD TO IMPORTS
import {
    loadWorkbookConfig,
    syncWorkbookConfig,
    getWorkbookConfig,
    clearWorkbookConfig,
    setSyncInterval,
    getSyncInterval,
    detectConfigChanges,
    getSearchesForSource,
    getAllSources
} from './sheet_sync.js';
```

Add alarm setup in the `onInstalled` listener:

```javascript
// ADD TO chrome.runtime.onInstalled.addListener
chrome.runtime.onInstalled.addListener(async () => {
    console.log(`${LOG} Extension installed/updated`);
    
    // ... existing alarm setup ...
    
    // NEW: Set up workbook sync alarm
    const syncInterval = await getSyncInterval();
    chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, {
        periodInMinutes: syncInterval
    });
    console.log(`${LOG} Workbook sync alarm set for every ${syncInterval} minutes`);
});
```

Add alarm handler:

```javascript
// ADD TO chrome.alarms.onAlarm.addListener switch statement
case ALARM_NAMES.WORKBOOK_SYNC:
    console.log(`${LOG} Workbook sync alarm triggered`);
    try {
        const result = await syncWorkbookConfig();
        if (result.changes && result.changes.length > 0) {
            // Notify UI of changes via badge
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
            
            // Log changes
            result.changes.forEach(change => {
                console.log(`${LOG} 📝 Change detected: ${change.message}`);
            });
        }
    } catch (error) {
        console.error(`${LOG} Workbook sync error:`, error);
    }
    break;
```

Add message handlers:

```javascript
// ADD TO message handler switch statement

case MESSAGE_ACTIONS.LOAD_WORKBOOK: {
    const { workbookUrl } = message;
    try {
        const config = await loadWorkbookConfig(workbookUrl);
        
        // Restart sync alarm with current interval
        const syncInterval = await getSyncInterval();
        chrome.alarms.create(ALARM_NAMES.WORKBOOK_SYNC, {
            periodInMinutes: syncInterval
        });
        
        response = { 
            success: true, 
            config,
            message: `Loaded ${config.stats.totalConnections} connections with ${config.stats.totalSearches} searches`
        };
    } catch (error) {
        response = { success: false, error: error.message };
    }
    break;
}

case MESSAGE_ACTIONS.SYNC_WORKBOOK: {
    try {
        const result = await syncWorkbookConfig();
        
        // Clear badge after manual sync
        chrome.action.setBadgeText({ text: '' });
        
        response = { 
            success: true, 
            ...result 
        };
    } catch (error) {
        response = { success: false, error: error.message };
    }
    break;
}

case MESSAGE_ACTIONS.GET_WORKBOOK_CONFIG: {
    try {
        const config = await getWorkbookConfig();
        const { lastSyncChanges } = await getFromStorage([STORAGE_KEYS.LAST_SYNC_CHANGES]);
        response = { 
            success: true, 
            config,
            lastChanges: lastSyncChanges || []
        };
    } catch (error) {
        response = { success: false, error: error.message };
    }
    break;
}

case MESSAGE_ACTIONS.CLEAR_WORKBOOK: {
    try {
        await clearWorkbookConfig();
        chrome.alarms.clear(ALARM_NAMES.WORKBOOK_SYNC);
        response = { success: true };
    } catch (error) {
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
        
        response = { success: true, interval };
    } catch (error) {
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
            nextSync: alarm?.scheduledTime ? new Date(alarm.scheduledTime).toISOString() : null
        };
    } catch (error) {
        response = { success: false, error: error.message };
    }
    break;
}
```

---

### 4. popup/popup.html (MODIFICATIONS)

Replace the Input Sheet section with unified Workbook section:

```html
<!-- SECTION: Workbook Configuration (replaces Input Sheet) -->
<section class="section" id="section-workbook">
    <div class="section-header" data-section="workbook">
        <span>📋 Workbook Configuration</span>
        <span class="chevron">▼</span>
    </div>
    <div class="section-content">
        <div class="input-group">
            <input type="text" id="workbook-url" name="workbook-url" 
                   placeholder="Google Sheets Workbook URL">
            <button id="load-workbook-btn" class="btn btn-primary">Load</button>
        </div>
        
        <!-- Sync Status -->
        <div id="sync-status-container" class="sync-status hidden">
            <div class="sync-header">
                <a id="workbook-link" href="#" target="_blank" class="workbook-title"></a>
                <div class="sync-actions">
                    <button id="sync-now-btn" class="btn btn-small btn-secondary" title="Sync Now">
                        🔄
                    </button>
                    <button id="clear-workbook-btn" class="btn btn-small btn-danger" title="Disconnect">
                        ✕
                    </button>
                </div>
            </div>
            
            <div class="sync-stats">
                <span id="connection-count" class="stat-badge"></span>
                <span id="search-count" class="stat-badge"></span>
                <span id="schedule-count" class="stat-badge"></span>
            </div>
            
            <div class="sync-info">
                <span id="sync-status-text" class="sync-status-indicator"></span>
                <span id="last-sync-time" class="text-muted"></span>
            </div>
            
            <!-- Recent Changes -->
            <div id="sync-changes" class="sync-changes hidden">
                <div class="changes-header">Recent Changes:</div>
                <ul id="changes-list"></ul>
            </div>
        </div>
        
        <!-- Sync Settings -->
        <div id="sync-settings" class="sync-settings hidden">
            <label class="setting-row">
                <span>Auto-sync every:</span>
                <select id="sync-interval-select">
                    <option value="1">1 minute</option>
                    <option value="5" selected>5 minutes</option>
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                </select>
            </label>
        </div>
    </div>
</section>
```

---

### 5. popup/popup.css (ADDITIONS)

```css
/* ============================================================
   SYNC STATUS STYLES
   ============================================================ */

.sync-status {
    margin-top: 12px;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: var(--radius);
    border: 1px solid var(--border-color);
}

.sync-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}

.workbook-title {
    font-weight: 600;
    color: var(--accent-blue);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
}

.workbook-title:hover {
    text-decoration: underline;
}

.sync-actions {
    display: flex;
    gap: 4px;
}

.btn-small {
    padding: 4px 8px;
    font-size: 12px;
    min-width: auto;
}

.btn-danger {
    background: var(--accent-red);
    color: white;
}

.btn-danger:hover {
    background: #c0392b;
}

.sync-stats {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
}

.stat-badge {
    background: var(--bg-tertiary);
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 11px;
    color: var(--text-secondary);
}

.sync-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
}

.sync-status-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
}

.sync-status-indicator::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
}

.sync-status-indicator.success::before {
    background: var(--accent-green);
}

.sync-status-indicator.syncing::before {
    background: var(--accent-yellow);
    animation: pulse 1s infinite;
}

.sync-status-indicator.error::before {
    background: var(--accent-red);
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.sync-changes {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-color);
}

.changes-header {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 4px;
}

.sync-changes ul {
    margin: 0;
    padding-left: 16px;
    font-size: 11px;
}

.sync-changes li {
    color: var(--text-secondary);
    margin-bottom: 2px;
}

.sync-changes li.added {
    color: var(--accent-green);
}

.sync-changes li.removed {
    color: var(--accent-red);
}

.sync-changes li.changed {
    color: var(--accent-yellow);
}

.sync-settings {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color);
}

.setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
}

.setting-row select {
    padding: 4px 8px;
    border-radius: var(--radius);
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
}
```

---

### 6. popup/popup.js (MODIFICATIONS)

Add these new functions and update initialization:

```javascript
// ============================================================
// ADD TO DOM ELEMENTS CACHE (in cacheElements function)
// ============================================================
// Workbook elements
elements.workbookUrl = document.getElementById('workbook-url');
elements.loadWorkbookBtn = document.getElementById('load-workbook-btn');
elements.syncStatusContainer = document.getElementById('sync-status-container');
elements.workbookLink = document.getElementById('workbook-link');
elements.syncNowBtn = document.getElementById('sync-now-btn');
elements.clearWorkbookBtn = document.getElementById('clear-workbook-btn');
elements.connectionCount = document.getElementById('connection-count');
elements.searchCount = document.getElementById('search-count');
elements.scheduleCount = document.getElementById('schedule-count');
elements.syncStatusText = document.getElementById('sync-status-text');
elements.lastSyncTime = document.getElementById('last-sync-time');
elements.syncChanges = document.getElementById('sync-changes');
elements.changesList = document.getElementById('changes-list');
elements.syncSettings = document.getElementById('sync-settings');
elements.syncIntervalSelect = document.getElementById('sync-interval-select');

// ============================================================
// ADD EVENT LISTENERS (in setupEventListeners function)
// ============================================================
elements.loadWorkbookBtn?.addEventListener('click', loadWorkbook);
elements.syncNowBtn?.addEventListener('click', syncWorkbookNow);
elements.clearWorkbookBtn?.addEventListener('click', clearWorkbook);
elements.syncIntervalSelect?.addEventListener('change', updateSyncInterval);

// ============================================================
// WORKBOOK SYNC FUNCTIONS
// ============================================================

/**
 * Load workbook configuration
 */
async function loadWorkbook() {
    const url = elements.workbookUrl.value.trim();
    if (!url) {
        showToast('Please enter a workbook URL', 'error');
        return;
    }
    
    setButtonLoading(elements.loadWorkbookBtn, true);
    
    try {
        const result = await sendMessage('LOAD_WORKBOOK', { workbookUrl: url });
        
        if (result.config) {
            state.workbookConfig = result.config;
            renderWorkbookStatus(result.config);
            
            // Also update searches for compatibility
            await refreshSearchesFromConfig(result.config);
            
            showToast(result.message || 'Workbook loaded', 'success');
            
            // Clear badge if any
            chrome.action?.setBadgeText?.({ text: '' });
        }
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.loadWorkbookBtn, false);
    }
}

/**
 * Sync workbook now (manual trigger)
 */
async function syncWorkbookNow() {
    setButtonLoading(elements.syncNowBtn, true, '⏳');
    
    try {
        const result = await sendMessage('SYNC_WORKBOOK');
        
        if (result.synced && result.config) {
            state.workbookConfig = result.config;
            renderWorkbookStatus(result.config, result.changes);
            
            // Refresh searches
            await refreshSearchesFromConfig(result.config);
            
            if (result.changes?.length > 0) {
                showToast(`Synced: ${result.changes.length} changes detected`, 'success');
            } else {
                showToast('Synced: No changes', 'info');
            }
        } else if (result.error) {
            showToast(`Sync failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`Sync error: ${error.message}`, 'error');
    } finally {
        setButtonLoading(elements.syncNowBtn, false, '🔄');
    }
}

/**
 * Clear workbook configuration
 */
async function clearWorkbook() {
    if (!confirm('Disconnect this workbook? This will clear all configuration.')) {
        return;
    }
    
    try {
        await sendMessage('CLEAR_WORKBOOK');
        
        state.workbookConfig = null;
        state.searches = [];
        
        elements.syncStatusContainer.classList.add('hidden');
        elements.syncSettings.classList.add('hidden');
        elements.workbookUrl.value = '';
        
        // Clear dropdowns
        renderSourceDropdown();
        
        showToast('Workbook disconnected', 'info');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

/**
 * Update sync interval
 */
async function updateSyncInterval() {
    const minutes = parseInt(elements.syncIntervalSelect.value, 10);
    
    try {
        await sendMessage('SET_SYNC_INTERVAL', { minutes });
        showToast(`Sync interval set to ${minutes} minute(s)`, 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

/**
 * Render workbook status UI
 */
function renderWorkbookStatus(config, changes = null) {
    if (!config) {
        elements.syncStatusContainer.classList.add('hidden');
        elements.syncSettings.classList.add('hidden');
        return;
    }
    
    elements.syncStatusContainer.classList.remove('hidden');
    elements.syncSettings.classList.remove('hidden');
    
    // Workbook link
    elements.workbookLink.href = config.workbookUrl;
    elements.workbookLink.textContent = config.workbookTitle || 'Workbook';
    
    // Stats
    elements.connectionCount.textContent = `${config.stats?.totalConnections || 0} connections`;
    elements.searchCount.textContent = `${config.stats?.totalSearches || 0} searches`;
    elements.scheduleCount.textContent = `${config.stats?.connectionsWithSchedule || 0} scheduled`;
    
    // Sync status
    elements.syncStatusText.className = 'sync-status-indicator';
    elements.syncStatusText.classList.add(config.syncStatus || 'success');
    
    const statusText = {
        'success': 'Synced',
        'syncing': 'Syncing...',
        'error': 'Sync Error'
    };
    elements.syncStatusText.textContent = statusText[config.syncStatus] || 'Unknown';
    
    // Last sync time
    if (config.lastSync) {
        const syncDate = new Date(config.lastSync);
        elements.lastSyncTime.textContent = `Last: ${formatRelativeTime(syncDate)}`;
    } else {
        elements.lastSyncTime.textContent = '';
    }
    
    // Changes
    const displayChanges = changes || [];
    if (displayChanges.length > 0) {
        elements.syncChanges.classList.remove('hidden');
        elements.changesList.innerHTML = displayChanges
            .slice(0, 5) // Show max 5 changes
            .map(change => {
                const className = change.type.includes('added') ? 'added' 
                    : change.type.includes('removed') ? 'removed' 
                    : 'changed';
                return `<li class="${className}">${change.message}</li>`;
            })
            .join('');
    } else {
        elements.syncChanges.classList.add('hidden');
    }
    
    // URL in input
    elements.workbookUrl.value = config.workbookUrl;
}

/**
 * Refresh searches from config (for backward compatibility)
 */
async function refreshSearchesFromConfig(config) {
    if (!config?.connections) return;
    
    // Flatten searches with source info
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
    
    state.searches = searches;
    renderSourceDropdown();
}

/**
 * Format relative time
 */
function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
}

// ============================================================
// UPDATE loadInitialData FUNCTION
// ============================================================

async function loadInitialData() {
    try {
        // NEW: Load workbook config first
        const configResult = await sendMessage('GET_WORKBOOK_CONFIG').catch(() => ({ config: null }));
        if (configResult.config) {
            state.workbookConfig = configResult.config;
            renderWorkbookStatus(configResult.config, configResult.lastChanges);
            await refreshSearchesFromConfig(configResult.config);
        } else {
            // FALLBACK: Load from legacy storage
            const inputSheetResult = await sendMessage('GET_INPUT_SHEET_INFO').catch(() => ({ sheetId: null }));
            if (inputSheetResult.sheetId) {
                elements.workbookUrl.value = `https://docs.google.com/spreadsheets/d/${inputSheetResult.sheetId}`;
                
                // Load searches from legacy
                const searchResult = await sendMessage('GET_SEARCHES').catch(() => ({ searches: [] }));
                state.searches = searchResult.searches || [];
            }
        }
        
        // Load sync interval
        const statusResult = await sendMessage('GET_SYNC_STATUS').catch(() => ({}));
        if (statusResult.syncInterval && elements.syncIntervalSelect) {
            elements.syncIntervalSelect.value = statusResult.syncInterval.toString();
        }
        
        // Load other data...
        const workbookResult = await sendMessage('GET_WORKBOOKS');
        state.workbooks = workbookResult.workbooks || [];
        
        const mappingResult = await sendMessage('GET_SOURCE_MAPPING');
        state.sourceMapping = mappingResult.mapping || {};
        
        const scheduleResult = await sendMessage('GET_SCHEDULES');
        state.schedules = scheduleResult.schedules || [];
        
        // Render UI
        renderSourceDropdown();
        renderWorkbookMappings();
        renderScheduleList();
        await loadQueueStatus();
        await loadExecutionHistory();
        
        // Clear badge on popup open
        chrome.action?.setBadgeText?.({ text: '' });
        
    } catch (error) {
        console.error(`${LOG} Error loading initial data:`, error);
        showToast('Error loading data', 'error');
    }
}

// ============================================================
// LISTEN FOR STORAGE CHANGES (live updates when popup is open)
// ============================================================

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    // If workbook config changed, refresh UI
    if (changes.workbookConfig) {
        const newConfig = changes.workbookConfig.newValue;
        if (newConfig) {
            state.workbookConfig = newConfig;
            renderWorkbookStatus(newConfig);
            refreshSearchesFromConfig(newConfig);
        }
    }
    
    // If last sync changes updated
    if (changes.lastSyncChanges) {
        const changes = changes.lastSyncChanges.newValue;
        if (changes?.length > 0 && state.workbookConfig) {
            renderWorkbookStatus(state.workbookConfig, changes);
            showToast(`Sheet updated: ${changes.length} changes`, 'info');
        }
    }
});
```

---

## Testing Checklist

### Phase 1: Basic Loading
```
□ Enter workbook URL and click Load
□ Verify both tabs are fetched (check service worker console)
□ Verify unified config is built correctly
□ Verify stats show correct counts
□ Verify legacy storage is updated (sourceMapping, savedWorkbooks, schedules)
```

### Phase 2: Live Sync
```
□ Wait for sync interval (default 5 min) or click sync button
□ Verify sync completes without errors
□ Make a change in Google Sheet (add/remove row)
□ Verify change is detected on next sync
□ Verify badge appears when changes detected
□ Verify changes list shows in popup
```

### Phase 3: Backward Compatibility
```
□ Verify GET_SEARCHES still works
□ Verify manual scraping still works with existing source dropdown
□ Verify scheduled runs work
□ Verify workbook mappings section still works
```

### Phase 4: Edge Cases
```
□ Test with missing Mapping and Schedules tab (should gracefully degrade)
□ Test with network error during sync
□ Test clearing workbook and reloading
□ Test changing sync interval
```

---

## Cursor.ai Prompt for Implementation

```
Implement the Savvy Pirate Live Sheet Sync feature according to the specification document.

CONTEXT:
- This is a Chrome Extension (Manifest V3) for LinkedIn competitive intelligence
- The extension already has sheets_api.js, service_worker.js, popup.js working
- We need to add unified workbook sync that reads two tabs from one workbook

FILES TO CREATE:
1. background/sheet_sync.js - New module for unified workbook sync

FILES TO MODIFY:
1. utils/constants.js - Add new STORAGE_KEYS, MESSAGE_ACTIONS, ALARM_NAMES, SYNC_CONFIG
2. background/service_worker.js - Add imports, alarm handler, message handlers
3. popup/popup.html - Replace Input Sheet section with Workbook Configuration
4. popup/popup.css - Add sync status styles
5. popup/popup.js - Add workbook sync functions, update loadInitialData

KEY REQUIREMENTS:
1. Single workbook URL input that fetches both "Searches" and "Mapping and Schedules" tabs
2. Unified config stored in chrome.storage.local under WORKBOOK_CONFIG key
3. Auto-sync via chrome.alarms (default 5 minutes, configurable)
4. Change detection with visual feedback (badge + UI)
5. Backward compatibility with existing sourceMapping, savedWorkbooks, schedules storage

CRITICAL NOTES:
- The Searches tab columns: Source Connection | Target Job Title | LinkedIn Search URL
- The Mappings tab columns: Name | Sheet_URL | Title | Company | Day | Day of Week | Time (24hr) | Frequency
- Join key is Source Connection (Searches) ↔ Name (Mappings)
- Must update legacy storage for scheduler.js compatibility
- Handle missing Mappings tab gracefully (continue with searches only)

Start with sheet_sync.js, then constants.js, then service_worker.js, then popup files.
```

---

## Summary

This implementation provides:

1. **Single URL Entry** → Automatically fetches both Searches and Mapping/Schedules tabs
2. **Unified Configuration** → Merges data into clean structure with stats
3. **5-Minute Polling** → Auto-syncs via chrome.alarms (configurable 1-60 min)
4. **Change Detection** → Identifies additions, removals, schedule/mapping changes
5. **Visual Feedback** → Badge notification + UI changes list
6. **Backward Compatibility** → Updates legacy storage keys for existing scheduler
7. **Live Updates** → chrome.storage.onChanged listener refreshes popup when sync completes

The Google Sheet becomes your single source of truth - edit it anytime and the extension stays in sync!
