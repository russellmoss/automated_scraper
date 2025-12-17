# Savvy Pirate v2.0 - Complete Rebuild Guide for Cursor.ai

**Version:** 2.0  
**Date:** December 2024  
**Purpose:** Step-by-step agentic build guide for Cursor.ai to create a clean, maintainable Chrome extension for LinkedIn competitive intelligence with scheduled automation.

---

## 🎯 Project Overview

### What We're Building
A Chrome Extension (Manifest V3) named **"Savvy Pirate"** that:
1. Scrapes LinkedIn search results for competitor connection monitoring
2. Stores data in Google Sheets (per-target workbooks with dated tabs)
3. Runs on scheduled automation (per-source scheduling on Raspberry Pi)
4. Compares scrapes to identify new connections
5. Sends notifications via Zapier webhook (Email, Slack, SMS)
6. Tracks execution history

### Target Environment
- **Browser:** Chromium on Raspberry Pi (headed mode, always logged into LinkedIn)
- **Runtime:** 24/7 unattended operation
- **Storage:** Google Sheets for data, Chrome local storage for config/schedules

---

## 📋 Agent Context (Copy to Cursor)

```
You are a Senior Chrome Extension Developer specializing in Manifest V3.

STACK:
- JavaScript (ES6+), Chrome Extension APIs (Manifest V3)
- Chrome Identity API, Google Sheets API v4
- Chrome Alarms API for scheduling
- Chrome Storage API for local persistence

CRITICAL CONSTRAINTS:
1. Service Worker MUST stay alive during long operations (30+ min scrapes)
2. Data MUST NEVER be lost - use local queue before cloud sync
3. Content scripts CANNOT use ES modules - single IIFE file only
4. All async message handlers MUST return true to keep channel open
5. Handle chrome.runtime.lastError in ALL message callbacks

ARCHITECTURE:
- Service Worker: Orchestration, scheduling, API calls
- Content Script: DOM scraping only (no external calls)
- Popup: UI control and monitoring
- Local Storage: Schedules, mappings, execution history
- Google Sheets: Data persistence

NAMING CONVENTION:
- Files: snake_case (service_worker.js)
- Functions: camelCase (processAutoRunQueue)
- Constants: UPPER_SNAKE_CASE (KEEPALIVE_ALARM)
- Log prefixes: [SW], [CS], [POPUP], [SHEETS], [QUEUE], [SCHEDULE]
```

---

## 📁 Project Structure

```
savvy-pirate-v2/
├── manifest.json
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   ├── service_worker.js      # Main orchestrator
│   ├── auth.js                # OAuth token management
│   ├── sheets_api.js          # Google Sheets wrapper
│   ├── sync_queue.js          # Local-first data queue
│   ├── scheduler.js           # Schedule management (NEW)
│   └── notifications.js       # Zapier webhook handler (NEW)
├── content/
│   └── content.js             # Single consolidated scraper
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── utils/
    └── constants.js           # Shared constants
```

**⚠️ Icon Files Required:** Chrome requires icon files for the extension. Create or download pirate skull icons, or use placeholder colored squares temporarily (16x16, 48x48, 128x128 pixels). You can create simple colored square PNGs, download free icon sets from icon libraries, or design custom icons later.
├── background/
│   ├── service_worker.js      # Main orchestrator
│   ├── auth.js                # OAuth token management
│   ├── sheets_api.js          # Google Sheets wrapper
│   ├── sync_queue.js          # Local-first data queue
│   ├── scheduler.js           # Schedule management (NEW)
│   └── notifications.js       # Zapier webhook handler (NEW)
├── content/
│   └── content.js             # Single consolidated scraper
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── utils/
    └── constants.js           # Shared constants
```

---

## 🔧 PHASE 0: Google Cloud & OAuth Setup

**This phase MUST be completed before any coding begins.**

### Task 0.1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name: `savvy-pirate-extension`
4. Click "Create"

### Task 0.2: Enable Required APIs

1. In Google Cloud Console, go to "APIs & Services" → "Library"
2. Search and enable these APIs:
   - **Google Sheets API**
   - **Google Drive API**

### Task 0.3: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Select "External" → Click "Create"
3. Fill in:
   - App name: `Savvy Pirate`
   - User support email: (your email)
   - Developer contact: (your email)
4. Click "Save and Continue"
5. Scopes: Click "Add or Remove Scopes"
   - Add: `https://www.googleapis.com/auth/spreadsheets`
   - Add: `https://www.googleapis.com/auth/drive.file`
6. Click "Save and Continue"
7. Test users: Add your Google account email
8. Click "Save and Continue"

### Task 0.4: Create OAuth Client ID

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Application type: **Chrome Extension**
4. Name: `Savvy Pirate Extension`
5. **Item ID**: You need your extension ID first. Do this:
   a. Create a minimal manifest.json (from Phase 1)
   b. Load unpacked in Chrome (chrome://extensions)
   c. Copy the 32-character Extension ID
   d. Paste it in the "Item ID" field
6. Click "Create"
7. **Copy the Client ID** (looks like: `123456789-abc123.apps.googleusercontent.com`)

### Task 0.5: Update manifest.json with Client ID

Replace `YOUR_CLIENT_ID.apps.googleusercontent.com` in manifest.json:

```json
"oauth2": {
    "client_id": "YOUR_ACTUAL_CLIENT_ID.apps.googleusercontent.com",
    "scopes": [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file"
    ]
}
```

### 🧪 Gate Check 0.1

```bash
# After loading extension in Chrome:
# 1. Click extension icon
# 2. Should prompt for Google sign-in
# 3. After sign-in, check service worker console:
#    - Should show "[AUTH] Token obtained successfully"

# If you see "OAuth2 not granted or revoked":
# - Check that your email is in Test Users
# - Check that Client ID matches exactly
# - Check that Extension ID in Google Console matches chrome://extensions
```

### Common OAuth Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `OAuth2 not granted or revoked` | Client ID mismatch | Verify Extension ID matches Google Console |
| `Access blocked: app not verified` | Not in test users | Add your email to OAuth consent test users |
| `invalid_client` | Wrong client ID format | Must be Chrome Extension type, not Web Application |
| `Token refresh failed` | Scopes changed | Remove extension, clear Chrome identity cache, reinstall |

---

## 🔧 PHASE 1: Project Foundation

### Task 1.1: Create manifest.json

**Cursor Prompt:**
```
Create manifest.json for a Manifest V3 Chrome Extension named "Savvy Pirate".

Requirements:
- Permissions: identity, activeTab, scripting, storage, tabs, alarms
- Host permissions: linkedin.com, sheets.googleapis.com, googleapis.com
- Service worker as ES module
- Content script on LinkedIn search pages
- OAuth2 with spreadsheets and drive.file scopes
- Include placeholder for client_id (user will replace)

Use the skull/pirate theme for icons (16, 48, 128).
```

**Expected Output:**
```json
{
  "name": "Savvy Pirate",
  "version": "2.0.0",
  "manifest_version": 3,
  "description": "LinkedIn competitive intelligence - scrape and track competitor connections",
  "permissions": [
    "identity",
    "activeTab",
    "scripting",
    "storage",
    "tabs",
    "alarms"
  ],
  "host_permissions": [
    "https://*.linkedin.com/*",
    "https://sheets.googleapis.com/*",
    "https://www.googleapis.com/*"
  ],
  "background": {
    "service_worker": "background/service_worker.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/search/results/people/*"],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "oauth2": {
    "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "scopes": [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file"
    ]
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 🧪 Gate Check 1.1
```bash
# Verify manifest is valid JSON
cat manifest.json | python3 -m json.tool

# Load unpacked extension in Chrome
# Go to chrome://extensions → Enable Developer Mode → Load unpacked
# Should show "Savvy Pirate" with no errors
```

---

### Task 1.2: Create utils/constants.js

**Cursor Prompt:**
```
Create utils/constants.js with shared constants for the Savvy Pirate extension.

Include:
- CONFIG object with timing constants (scrape delays, queue intervals)
- ALARM_NAMES for all chrome.alarms
- STORAGE_KEYS for chrome.storage.local keys
- SHEETS_API_BASE URL
- HEADERS_ROW array for Google Sheets (Date, Name, Title, Location, Connection Source, LinkedIn URL, Accreditation 1-6)
- MESSAGE_ACTIONS enum for all message types
- SCHEDULE_DAYS array (Sunday-Saturday)
- LOG_PREFIXES for consistent logging

Export as ES module.
```

**Expected Output:**
```javascript
// utils/constants.js - Shared constants

export const CONFIG = {
    // Scraping timing (anti-detection)
    MIN_WAIT_SECONDS: 5,
    MAX_WAIT_SECONDS: 8,
    SCROLL_WAIT_MS: 2000,
    MAX_PAGES: 1000,
    
    // Queue processing
    QUEUE_PROCESS_INTERVAL_MINUTES: 0.5,  // 30 seconds
    KEEPALIVE_INTERVAL_MINUTES: 0.4,      // 24 seconds
    MAX_RETRIES: 5,
    BASE_DELAY_MS: 2000,
    
    // Schedule execution
    SCHEDULE_CHECK_INTERVAL_MINUTES: 1,    // Check every minute
    
    // Notifications
    WEBHOOK_TIMEOUT_MS: 10000
};

export const ALARM_NAMES = {
    KEEPALIVE: 'keepalive-alarm',
    QUEUE_PROCESS: 'queue-process-alarm',
    SCHEDULE_CHECK: 'schedule-check-alarm',
    AUTO_RUN_KEEPALIVE: 'auto-run-keepalive'
};

export const STORAGE_KEYS = {
    // Settings
    INPUT_SHEET_ID: 'inputSheetId',
    SAVED_WORKBOOKS: 'savedWorkbooks',
    SOURCE_MAPPING: 'sourceMapping',
    
    // Schedules (NEW)
    SCHEDULES: 'schedules',
    EXECUTION_HISTORY: 'executionHistory',
    
    // State
    SYNC_QUEUE: 'syncQueue',
    FAILED_ROWS: 'failedRows',
    AUTO_RUN_STATE: 'autoRunState',
    CURRENT_SEARCH_INDEX: 'searchIndex',
    
    // Notifications
    WEBHOOK_URL: 'webhookUrl',
    NOTIFICATION_SETTINGS: 'notificationSettings'
};

export const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const HEADERS_ROW = [
    'Date',
    'Name', 
    'Title',
    'Location',
    'Connection Source',
    'LinkedIn URL',
    'Accreditation 1',
    'Accreditation 2',
    'Accreditation 3',
    'Accreditation 4',
    'Accreditation 5',
    'Accreditation 6'
];

export const MESSAGE_ACTIONS = {
    // Scraping
    START_SCRAPING: 'START_SCRAPING',
    STOP_SCRAPING: 'STOP_SCRAPING',
    DATA_SCRAPED: 'DATA_SCRAPED',
    SCRAPING_COMPLETE: 'SCRAPING_COMPLETE',
    GET_STATUS: 'GET_STATUS',
    PING: 'PING',
    
    // Sheets
    LOAD_INPUT_SHEET: 'LOAD_INPUT_SHEET',
    GET_SEARCHES: 'GET_SEARCHES',
    ENSURE_WEEKLY_TAB: 'ENSURE_WEEKLY_TAB',
    GET_TABS: 'GET_TABS',
    COMPARE_TABS: 'COMPARE_TABS',
    DEDUPLICATE: 'DEDUPLICATE',
    
    // Workbooks
    ADD_WORKBOOK: 'ADD_WORKBOOK',
    REMOVE_WORKBOOK: 'REMOVE_WORKBOOK',
    GET_WORKBOOKS: 'GET_WORKBOOKS',
    SET_SOURCE_MAPPING: 'SET_SOURCE_MAPPING',
    GET_SOURCE_MAPPING: 'GET_SOURCE_MAPPING',
    
    // Auto-run
    START_AUTO_RUN: 'START_AUTO_RUN',
    STOP_AUTO_RUN: 'STOP_AUTO_RUN',
    GET_AUTO_RUN_STATUS: 'GET_AUTO_RUN_STATUS',
    AUTO_RUN_PROGRESS: 'AUTO_RUN_PROGRESS',
    
    // Scheduling (NEW)
    GET_SCHEDULES: 'GET_SCHEDULES',
    SET_SCHEDULE: 'SET_SCHEDULE',
    DELETE_SCHEDULE: 'DELETE_SCHEDULE',
    GET_EXECUTION_HISTORY: 'GET_EXECUTION_HISTORY',
    TRIGGER_SCHEDULED_RUN: 'TRIGGER_SCHEDULED_RUN',
    
    // Notifications (NEW)
    SET_WEBHOOK_URL: 'SET_WEBHOOK_URL',
    TEST_WEBHOOK: 'TEST_WEBHOOK',
    SEND_NOTIFICATION: 'SEND_NOTIFICATION',
    
    // Queue
    GET_QUEUE_STATUS: 'GET_QUEUE_STATUS',
    RETRY_FAILED: 'RETRY_FAILED',
    CLEAR_FAILED: 'CLEAR_FAILED',
    
    // Keep-alive
    START_KEEPALIVE: 'START_KEEPALIVE',
    STOP_KEEPALIVE: 'STOP_KEEPALIVE'
};

export const SCHEDULE_DAYS = [
    'Sunday',
    'Monday', 
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday'
];

export const LOG_PREFIXES = {
    SERVICE_WORKER: '[SW]',
    CONTENT_SCRIPT: '[CS]',
    POPUP: '[POPUP]',
    SHEETS: '[SHEETS]',
    QUEUE: '[QUEUE]',
    SCHEDULE: '[SCHEDULE]',
    NOTIFY: '[NOTIFY]'
};
```

---

## 🔧 PHASE 2: Authentication & Storage

### Task 2.1: Create background/auth.js

**Cursor Prompt:**
```
Create background/auth.js for Chrome Identity API OAuth management.

Requirements:
- getAuthToken(interactive) - Get OAuth token, optionally prompt user
- removeCachedToken(token) - Remove invalid token from cache
- Handle chrome.runtime.lastError properly
- Return Promises for async operations
- Log with [AUTH] prefix
```

**Expected Output:**
```javascript
// background/auth.js - OAuth Token Management

/**
 * Get OAuth token from Chrome Identity API
 * @param {boolean} interactive - Whether to show sign-in prompt
 * @returns {Promise<string>} OAuth access token
 */
export async function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
            if (chrome.runtime.lastError) {
                console.error('[AUTH] Token error:', chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
            } else if (!token) {
                reject(new Error('No token received'));
            } else {
                console.log('[AUTH] Token obtained successfully');
                resolve(token);
            }
        });
    });
}

/**
 * Remove cached token (call when token is invalid/expired)
 * @param {string} token - Token to remove
 * @returns {Promise<void>}
 */
export async function removeCachedToken(token) {
    return new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => {
            console.log('[AUTH] Cached token removed');
            resolve();
        });
    });
}
```

### Task 2.2: Create background/sync_queue.js

**Cursor Prompt:**
```
Create background/sync_queue.js for local-first data persistence.

This is CRITICAL for data safety - data must be queued locally before syncing to Google Sheets.
```

**Expected Output:**
```javascript
// background/sync_queue.js - Local-First Data Queue with Retry Logic

import { appendRowsToTab } from './sheets_api.js';
import { STORAGE_KEYS, CONFIG, LOG_PREFIXES } from '../utils/constants.js';

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
            console.log(`${LOG} ✅ Synced ${item.rows.length} rows (ID: ${item.id})`);
            
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
```

### 🧪 Gate Check 2.2
```javascript
// In service worker console:
// Test queue operations
const testRows = [['2024-12-16', 'Test Name', 'Test Title', 'Test Location', 'Source', 'https://linkedin.com/in/test']];
await addToQueue(testRows, 'fake-sheet-id', 'Test_Tab');

// Check queue status
const status = await getQueueStatus();
console.log('Queue status:', status);
// Expected: { pending: 1, pendingRows: 1, failed: 0, failedRows: 0, ... }

// Clear test data
chrome.storage.local.remove(['syncQueue', 'failedRows']);
```

---

### Task 2.3: Create background/sheets_api.js

**Cursor Prompt:**
```
Create background/sheets_api.js as the Google Sheets API wrapper with all CRUD operations and the compareTabs differential function.
```

**Expected Output:**
```javascript
// background/sheets_api.js - Google Sheets API Wrapper with Retry Logic

import { getAuthToken } from './auth.js';
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
            await new Promise(resolve => 
                chrome.identity.removeCachedAuthToken({ token: oldToken }, resolve)
            );
            
            const newToken = await getAuthToken(false);
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
 */
async function apiCall(endpoint, options = {}) {
    const token = await getAuthToken(true);
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
```

### 🧪 Gate Check 2.3
```javascript
// In service worker console:
// Test sheet validation
const result = await validateSpreadsheet('YOUR_TEST_SHEET_ID');
console.log('Validation:', result);

// Test tab listing
const tabs = await getSheetTabs('YOUR_TEST_SHEET_ID');
console.log('Tabs:', tabs);

// Test weekly tab
const weekly = await ensureWeeklyTab('YOUR_TEST_SHEET_ID');
console.log('Weekly tab:', weekly);
```

---

## 🔧 PHASE 3: Scheduling System (NEW)

### Task 3.1: Create background/scheduler.js

**Cursor Prompt:**
```
Create background/scheduler.js for per-source scheduling system.

This enables scheduling scrapes for each source connection (e.g., "Run all Jeff Nash searches every Monday at 2am").

Data Structures:

Schedule object:
{
    id: string (UUID),
    sourceName: string (e.g., "Jeff Nash"),
    dayOfWeek: number (0=Sunday, 6=Saturday),
    hour: number (0-23, 24-hour format),
    minute: number (0-59),
    enabled: boolean,
    lastRun: ISO string or null,
    nextRun: ISO string (calculated),
    createdAt: ISO string,
    updatedAt: ISO string
}

ExecutionRecord object:
{
    id: string,
    scheduleId: string,
    sourceName: string,
    startedAt: ISO string,
    completedAt: ISO string or null,
    status: 'running' | 'completed' | 'failed' | 'aborted',
    searchesCompleted: number,
    totalSearches: number,
    profilesScraped: number,
    error: string or null
}

Functions:
1. getSchedules() - Return all schedules from storage
2. setSchedule(schedule) - Create or update schedule
3. deleteSchedule(scheduleId) - Remove schedule
4. getScheduleForSource(sourceName) - Get schedule for specific source
5. calculateNextRun(schedule) - Calculate next execution time
6. checkSchedules() - Check if any schedules should run NOW
7. markScheduleRun(scheduleId, executionId) - Update lastRun, nextRun
8. getExecutionHistory(limit) - Get recent execution records
9. addExecutionRecord(record) - Log execution start/complete
10. updateExecutionRecord(id, updates) - Update running execution

Scheduling Logic:
- checkSchedules() is called every minute by alarm
- Compare current day/time (Eastern Time) with schedule day/time
- Allow 5-minute window for execution (handles slight delays)
- Skip if lastRun was within last 23 hours (prevent double-runs)
- Return list of schedules that should run NOW

Store in chrome.storage.local under keys:
- 'schedules': Array of Schedule objects
- 'executionHistory': Array of ExecutionRecord objects (keep last 100)
```

**Expected Output:**
```javascript
// background/scheduler.js - Per-Source Scheduling System

import { STORAGE_KEYS, LOG_PREFIXES } from '../utils/constants.js';

const LOG = LOG_PREFIXES.SCHEDULE;

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
// TIME UTILITIES
// ============================================================

/**
 * Get current time in Eastern Time
 * @returns {Date} Current time in ET
 */
function getEasternTime() {
    const now = new Date();
    return new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
}

/**
 * Calculate next run time for a schedule
 * @param {Object} schedule - Schedule object
 * @returns {string} ISO string of next run time
 */
export function calculateNextRun(schedule) {
    const now = getEasternTime();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    let daysUntilRun = schedule.dayOfWeek - currentDay;
    
    // If same day, check if time has passed
    if (daysUntilRun === 0) {
        const scheduledMinutes = schedule.hour * 60 + schedule.minute;
        const currentMinutes = currentHour * 60 + currentMinute;
        
        if (currentMinutes >= scheduledMinutes) {
            // Time passed today, schedule for next week
            daysUntilRun = 7;
        }
    } else if (daysUntilRun < 0) {
        // Day already passed this week
        daysUntilRun += 7;
    }
    
    const nextRun = new Date(now);
    nextRun.setDate(nextRun.getDate() + daysUntilRun);
    nextRun.setHours(schedule.hour, schedule.minute, 0, 0);
    
    return nextRun.toISOString();
}

/**
 * Generate UUID for schedule/execution IDs
 */
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================================
// SCHEDULE MANAGEMENT
// ============================================================

/**
 * Get all schedules
 * @returns {Promise<Array>} Array of schedule objects
 */
export async function getSchedules() {
    const { schedules } = await getFromStorage([STORAGE_KEYS.SCHEDULES]);
    return schedules || [];
}

/**
 * Create or update a schedule
 * @param {Object} scheduleData - Schedule data (id optional for new)
 * @returns {Promise<Object>} Created/updated schedule
 */
export async function setSchedule(scheduleData) {
    const schedules = await getSchedules();
    const now = new Date().toISOString();
    
    let schedule;
    const existingIndex = schedules.findIndex(s => s.id === scheduleData.id);
    
    if (existingIndex >= 0) {
        // Update existing
        schedule = {
            ...schedules[existingIndex],
            ...scheduleData,
            updatedAt: now,
            nextRun: calculateNextRun({ ...schedules[existingIndex], ...scheduleData })
        };
        schedules[existingIndex] = schedule;
        console.log(`${LOG} Updated schedule for ${schedule.sourceName}`);
    } else {
        // Create new
        schedule = {
            id: generateId(),
            sourceName: scheduleData.sourceName,
            dayOfWeek: scheduleData.dayOfWeek,
            hour: scheduleData.hour,
            minute: scheduleData.minute || 0,
            enabled: scheduleData.enabled !== false,
            lastRun: null,
            createdAt: now,
            updatedAt: now
        };
        schedule.nextRun = calculateNextRun(schedule);
        schedules.push(schedule);
        console.log(`${LOG} Created schedule for ${schedule.sourceName}: ${SCHEDULE_DAYS[schedule.dayOfWeek]} at ${schedule.hour}:${String(schedule.minute).padStart(2, '0')}`);
    }
    
    await saveToStorage({ [STORAGE_KEYS.SCHEDULES]: schedules });
    return schedule;
}

/**
 * Delete a schedule
 * @param {string} scheduleId - Schedule ID to delete
 * @returns {Promise<boolean>} Success
 */
export async function deleteSchedule(scheduleId) {
    const schedules = await getSchedules();
    const filtered = schedules.filter(s => s.id !== scheduleId);
    
    if (filtered.length === schedules.length) {
        console.warn(`${LOG} Schedule ${scheduleId} not found`);
        return false;
    }
    
    await saveToStorage({ [STORAGE_KEYS.SCHEDULES]: filtered });
    console.log(`${LOG} Deleted schedule ${scheduleId}`);
    return true;
}

/**
 * Get schedule for a specific source
 * @param {string} sourceName - Source connection name
 * @returns {Promise<Object|null>} Schedule or null
 */
export async function getScheduleForSource(sourceName) {
    const schedules = await getSchedules();
    return schedules.find(s => s.sourceName === sourceName) || null;
}

// ============================================================
// SCHEDULE CHECKING
// ============================================================

/**
 * Check which schedules should run NOW
 * Called every minute by the schedule-check alarm
 * @returns {Promise<Array>} Schedules that should execute
 */
export async function checkSchedules() {
    const schedules = await getSchedules();
    const now = getEasternTime();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const schedulesToRun = [];
    
    for (const schedule of schedules) {
        if (!schedule.enabled) continue;
        
        // Check if day matches
        if (schedule.dayOfWeek !== currentDay) continue;
        
        // Check if within 5-minute window of scheduled time
        const scheduledMinutes = schedule.hour * 60 + schedule.minute;
        const currentMinutes = currentHour * 60 + currentMinute;
        const diff = currentMinutes - scheduledMinutes;
        
        // Allow 0-5 minute window (just after scheduled time)
        if (diff < 0 || diff > 5) continue;
        
        // Check if already ran recently (within 23 hours)
        if (schedule.lastRun) {
            const lastRunTime = new Date(schedule.lastRun);
            const hoursSinceLastRun = (now - lastRunTime) / (1000 * 60 * 60);
            
            if (hoursSinceLastRun < 23) {
                console.log(`${LOG} Skipping ${schedule.sourceName} - ran ${hoursSinceLastRun.toFixed(1)} hours ago`);
                continue;
            }
        }
        
        console.log(`${LOG} ✅ Schedule triggered: ${schedule.sourceName}`);
        schedulesToRun.push(schedule);
    }
    
    return schedulesToRun;
}

/**
 * Mark schedule as having run
 * @param {string} scheduleId - Schedule ID
 * @param {string} executionId - Execution record ID
 */
export async function markScheduleRun(scheduleId, executionId) {
    const schedules = await getSchedules();
    const index = schedules.findIndex(s => s.id === scheduleId);
    
    if (index >= 0) {
        const now = new Date().toISOString();
        schedules[index].lastRun = now;
        schedules[index].nextRun = calculateNextRun(schedules[index]);
        schedules[index].lastExecutionId = executionId;
        
        await saveToStorage({ [STORAGE_KEYS.SCHEDULES]: schedules });
        console.log(`${LOG} Marked ${schedules[index].sourceName} as run, next: ${schedules[index].nextRun}`);
    }
}

// ============================================================
// EXECUTION HISTORY
// ============================================================

const MAX_HISTORY_RECORDS = 100;

/**
 * Get execution history
 * @param {number} limit - Max records to return
 * @returns {Promise<Array>} Execution records, newest first
 */
export async function getExecutionHistory(limit = 50) {
    const { executionHistory } = await getFromStorage([STORAGE_KEYS.EXECUTION_HISTORY]);
    const history = executionHistory || [];
    
    // Sort by startedAt descending (newest first)
    history.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    
    return history.slice(0, limit);
}

/**
 * Add new execution record
 * @param {Object} record - Execution record data
 * @returns {Promise<Object>} Created record with ID
 */
export async function addExecutionRecord(record) {
    const history = await getExecutionHistory(MAX_HISTORY_RECORDS);
    
    const execution = {
        id: generateId(),
        scheduleId: record.scheduleId,
        sourceName: record.sourceName,
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: 'running',
        searchesCompleted: 0,
        totalSearches: record.totalSearches || 0,
        profilesScraped: 0,
        error: null
    };
    
    history.unshift(execution);
    
    // Trim to max records
    const trimmed = history.slice(0, MAX_HISTORY_RECORDS);
    await saveToStorage({ [STORAGE_KEYS.EXECUTION_HISTORY]: trimmed });
    
    console.log(`${LOG} Started execution ${execution.id} for ${execution.sourceName}`);
    return execution;
}

/**
 * Update execution record
 * @param {string} executionId - Execution ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} Updated record or null
 */
export async function updateExecutionRecord(executionId, updates) {
    const { executionHistory } = await getFromStorage([STORAGE_KEYS.EXECUTION_HISTORY]);
    const history = executionHistory || [];
    
    const index = history.findIndex(e => e.id === executionId);
    if (index === -1) {
        console.warn(`${LOG} Execution ${executionId} not found`);
        return null;
    }
    
    history[index] = { ...history[index], ...updates };
    
    // If completing, set completedAt
    if (updates.status && updates.status !== 'running' && !history[index].completedAt) {
        history[index].completedAt = new Date().toISOString();
    }
    
    await saveToStorage({ [STORAGE_KEYS.EXECUTION_HISTORY]: history });
    
    console.log(`${LOG} Updated execution ${executionId}: ${updates.status || 'progress'}`);
    return history[index];
}

// ============================================================
// SCHEDULE VALIDATION
// ============================================================

/**
 * Validate schedule data before saving
 * @param {Object} schedule - Schedule to validate
 * @returns {{valid: boolean, error?: string}}
 */
export function validateSchedule(schedule) {
    if (!schedule.sourceName || schedule.sourceName.trim() === '') {
        return { valid: false, error: 'Source name is required' };
    }
    
    if (typeof schedule.dayOfWeek !== 'number' || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) {
        return { valid: false, error: 'Day of week must be 0-6 (Sunday-Saturday)' };
    }
    
    if (typeof schedule.hour !== 'number' || schedule.hour < 0 || schedule.hour > 23) {
        return { valid: false, error: 'Hour must be 0-23' };
    }
    
    if (typeof schedule.minute !== 'number' || schedule.minute < 0 || schedule.minute > 59) {
        return { valid: false, error: 'Minute must be 0-59' };
    }
    
    return { valid: true };
}

/**
 * Get human-readable schedule description
 * @param {Object} schedule - Schedule object
 * @returns {string} e.g., "Monday at 2:30 AM"
 */
export function getScheduleDescription(schedule) {
    const day = SCHEDULE_DAYS[schedule.dayOfWeek];
    const hour = schedule.hour % 12 || 12;
    const ampm = schedule.hour < 12 ? 'AM' : 'PM';
    const minute = String(schedule.minute).padStart(2, '0');
    return `${day} at ${hour}:${minute} ${ampm}`;
}

/**
 * Get all sources that have schedules
 * @returns {Promise<string[]>} Array of source names
 */
export async function getScheduledSources() {
    const schedules = await getSchedules();
    return [...new Set(schedules.map(s => s.sourceName))];
}

/**
 * Get next upcoming scheduled run across all schedules
 * @returns {Promise<{schedule: Object, nextRun: string} | null>}
 */
export async function getNextScheduledRun() {
    const schedules = await getSchedules();
    const enabled = schedules.filter(s => s.enabled);
    
    if (enabled.length === 0) return null;
    
    // Sort by next run time
    enabled.sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun));
    
    return {
        schedule: enabled[0],
        nextRun: enabled[0].nextRun
    };
}

// Day names for logging
const SCHEDULE_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
```

### 🧪 Gate Check 3.1
```javascript
// In service worker console:

// Test schedule creation
const schedule = await setSchedule({
    sourceName: 'Test Source',
    dayOfWeek: 1,  // Monday
    hour: 14,      // 2 PM
    minute: 30
});
console.log('Created schedule:', schedule);

// Test schedule retrieval
const schedules = await getSchedules();
console.log('All schedules:', schedules);

// Test next run calculation
const next = await getNextScheduledRun();
console.log('Next scheduled run:', next);

// Test schedule description
console.log('Description:', getScheduleDescription(schedule));

// Cleanup
await deleteSchedule(schedule.id);
console.log('Schedule deleted');
```

---

### Task 3.2: Create background/notifications.js

**Cursor Prompt:**
```
Create background/notifications.js for Zapier webhook notifications.

The webhook will be called with JSON payload that Zapier routes to:
- Email
- Slack message  
- SMS via Kixie

Functions:
1. setWebhookUrl(url) - Save webhook URL to storage
2. getWebhookUrl() - Get saved webhook URL
3. sendNotification(type, data) - Send notification via webhook
4. testWebhook() - Send test notification

Notification types:
- 'schedule_started': Scheduled run beginning
- 'schedule_completed': Scheduled run finished successfully
- 'schedule_failed': Scheduled run failed
- 'scrape_complete': Individual scrape completed
- 'scrape_failed': Individual scrape failed (includes person name, search name, failure type, timestamp)
- 'new_connections': New connections found (from compare tabs)
- 'error': Critical error occurred

Payload structure for Zapier:
{
    type: string,
    timestamp: ISO string,
    source: "Savvy Pirate v2.0",
    data: {
        sourceName: string (if applicable),
        message: string (human-readable summary),
        profilesScraped: number (if applicable),
        newConnections: number (if applicable),
        error: string (if applicable),
        details: object (additional context)
    }
}

Handle errors gracefully - notifications failing should not break the main flow.
Timeout after 10 seconds.
Log with [NOTIFY] prefix.
```

**Expected Output:**
```javascript
// background/notifications.js - Zapier Webhook Notifications

import { STORAGE_KEYS, CONFIG, LOG_PREFIXES } from '../utils/constants.js';

const LOG = LOG_PREFIXES.NOTIFY;

// ============================================================
// STORAGE
// ============================================================

async function getFromStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => {
            resolve(result);
        });
    });
}

async function saveToStorage(data) {
    return new Promise((resolve) => {
        chrome.storage.local.set(data, resolve);
    });
}

// ============================================================
// WEBHOOK MANAGEMENT
// ============================================================

/**
 * Save webhook URL
 * @param {string} url - Zapier webhook URL
 */
export async function setWebhookUrl(url) {
    await saveToStorage({ [STORAGE_KEYS.WEBHOOK_URL]: url });
    console.log(`${LOG} Webhook URL saved`);
}

/**
 * Get saved webhook URL
 * @returns {Promise<string|null>}
 */
export async function getWebhookUrl() {
    const result = await getFromStorage([STORAGE_KEYS.WEBHOOK_URL]);
    return result[STORAGE_KEYS.WEBHOOK_URL] || null;
}

// ============================================================
// NOTIFICATION SENDING
// ============================================================

/**
 * Send notification via Zapier webhook
 * @param {string} type - Notification type
 * @param {Object} data - Notification data
 * @returns {Promise<boolean>} Success
 */
export async function sendNotification(type, data = {}) {
    try {
        const webhookUrl = await getWebhookUrl();
        
        if (!webhookUrl) {
            console.log(`${LOG} No webhook URL configured, skipping notification`);
            return false;
        }
        
        const payload = {
            type,
            timestamp: new Date().toISOString(),
            source: 'Savvy Pirate v2.0',
            data: {
                message: generateMessage(type, data),
                ...data
            }
        };
        
        console.log(`${LOG} Sending ${type} notification...`);
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.WEBHOOK_TIMEOUT_MS);
        
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            
            if (response.ok) {
                console.log(`${LOG} ✅ Notification sent: ${type}`);
                return true;
            } else {
                console.error(`${LOG} Webhook returned ${response.status}`);
                return false;
            }
        } catch (fetchError) {
            clearTimeout(timeout);
            if (fetchError.name === 'AbortError') {
                console.error(`${LOG} Webhook timeout after ${CONFIG.WEBHOOK_TIMEOUT_MS}ms`);
            } else {
                console.error(`${LOG} Webhook error:`, fetchError.message);
            }
            return false;
        }
        
    } catch (error) {
        console.error(`${LOG} Notification error:`, error.message);
        return false;
    }
}

/**
 * Generate human-readable message for notification type
 */
function generateMessage(type, data) {
    const messages = {
        'schedule_started': `🚀 Scheduled scrape started for ${data.sourceName}`,
        'schedule_completed': `✅ Scheduled scrape completed for ${data.sourceName}: ${data.profilesScraped || 0} profiles scraped`,
        'schedule_failed': `❌ Scheduled scrape FAILED for ${data.sourceName}: ${data.error || 'Unknown error'}`,
        'scrape_complete': `📊 Scrape complete: ${data.profilesScraped || 0} profiles from ${data.sourceName}`,
        'scrape_failed': `❌ Scrape failed for "${data.personName}" in search "${data.searchName}": ${data.failureType || 'Unknown'} - ${data.error || 'Unknown error'}`,
        'new_connections': `🆕 Found ${data.newConnections || 0} new connections for ${data.sourceName}`,
        'error': `🚨 ERROR: ${data.error || 'Unknown error'}`,
        'test': '🧪 Test notification from Savvy Pirate - webhook is working!'
    };
    
    return messages[type] || `Notification: ${type}`;
}

/**
 * Send test notification to verify webhook
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function testWebhook() {
    const webhookUrl = await getWebhookUrl();
    
    if (!webhookUrl) {
        return { success: false, error: 'No webhook URL configured' };
    }
    
    const success = await sendNotification('test', {
        message: 'Test notification from Savvy Pirate',
        testTimestamp: new Date().toISOString()
    });
    
    return { success, error: success ? null : 'Webhook request failed' };
}

// ============================================================
// CONVENIENCE METHODS
// ============================================================

export async function notifyScheduleStarted(sourceName, totalSearches) {
    return sendNotification('schedule_started', {
        sourceName,
        totalSearches
    });
}

export async function notifyScheduleCompleted(sourceName, profilesScraped, searchesCompleted) {
    return sendNotification('schedule_completed', {
        sourceName,
        profilesScraped,
        searchesCompleted
    });
}

export async function notifyScheduleFailed(sourceName, error) {
    return sendNotification('schedule_failed', {
        sourceName,
        error: error?.message || String(error)
    });
}

export async function notifyNewConnections(sourceName, newConnections, outputTab) {
    return sendNotification('new_connections', {
        sourceName,
        newConnections,
        outputTab
    });
}

export async function notifyError(error, context = {}) {
    return sendNotification('error', {
        error: error?.message || String(error),
        ...context
    });
}

/**
 * Notify when a scrape fails for a specific person
 * @param {string} personName - Name of the person being scraped
 * @param {string} searchName - Name of the search being run
 * @param {string} failureType - Type of failure (e.g., 'selector_error', 'network_error', 'timeout', 'parse_error')
 * @param {string|Error} error - Error message or Error object
 * @param {Object} additionalContext - Additional context (optional)
 * 
 * USAGE EXAMPLE:
 * When scraping fails for a person, call this function to send a webhook notification:
 * 
 * ```javascript
 * try {
 *     const profileData = extractProfileData(card);
 *     if (!profileData) throw new Error('Failed to extract profile data');
 * } catch (error) {
 *     let failureType = 'parse_error';
 *     if (error.message.includes('selector')) failureType = 'selector_error';
 *     if (error.message.includes('timeout')) failureType = 'timeout_error';
 *     if (error.message.includes('network')) failureType = 'network_error';
 *     
 *     await notifyScrapeFailed(
 *         profileData?.name || 'Unknown Person',
 *         currentSearch?.title || 'Unknown Search',
 *         failureType,
 *         error
 *     );
 * }
 * ```
 * 
 * The webhook payload will include:
 * - timestamp: ISO timestamp of failure
 * - personName: Name of person being scraped
 * - searchName: Name of search being run
 * - failureType: Type of failure (selector_error, network_error, timeout, parse_error, etc.)
 * - error: Error message
 */
export async function notifyScrapeFailed(personName, searchName, failureType, error, additionalContext = {}) {
    return sendNotification('scrape_failed', {
        personName: personName || 'Unknown',
        searchName: searchName || 'Unknown',
        failureType: failureType || 'unknown',
        error: error?.message || String(error || 'Unknown error'),
        timestamp: new Date().toISOString(),
        ...additionalContext
    });
}
```

---

### Task 3.3: Validate Zapier Webhook Payload Structure

**Cursor Prompt:**
```
Add payload validation to background/notifications.js to ensure the JSON structure matches Zapier's catch hook expectations.

Create a validateZapierPayload() function that checks:
1. Required top-level fields: type, timestamp, source, data
2. Data object structure matches notification type
3. All fields are correct types (string, number, object, etc.)

Add this validation before sending the webhook request, and log warnings if payload doesn't match expected structure.
```

**Expected Output:**

**Step 1:** Add this validation function to `background/notifications.js` after the `generateMessage()` function:

```javascript
// ============================================================
// PAYLOAD VALIDATION
// ============================================================

/**
 * Validate payload structure matches Zapier catch hook expectations
 * Zapier catch hooks accept any JSON, but we validate to ensure correct structure
 * @param {string} type - Notification type
 * @param {Object} payload - Payload to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateZapierPayload(type, payload) {
    const errors = [];
    
    // Required top-level fields
    if (!payload.type || typeof payload.type !== 'string') {
        errors.push('Missing or invalid "type" field (must be string)');
    }
    
    if (!payload.timestamp || typeof payload.timestamp !== 'string') {
        errors.push('Missing or invalid "timestamp" field (must be ISO string)');
    } else {
        // Validate ISO timestamp format
        if (!payload.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
            errors.push('Invalid timestamp format (must be ISO 8601)');
        }
    }
    
    if (!payload.source || typeof payload.source !== 'string') {
        errors.push('Missing or invalid "source" field (must be string)');
    }
    
    if (!payload.data || typeof payload.data !== 'object') {
        errors.push('Missing or invalid "data" field (must be object)');
    } else {
        // Validate data structure based on type
        const { data } = payload;
        
        if (!data.message || typeof data.message !== 'string') {
            errors.push('Missing or invalid "data.message" field (must be string)');
        }
        
        // Type-specific validations
        switch (type) {
            case 'scrape_failed':
                if (!data.personName || typeof data.personName !== 'string') {
                    errors.push('scrape_failed: Missing "data.personName" (must be string)');
                }
                if (!data.searchName || typeof data.searchName !== 'string') {
                    errors.push('scrape_failed: Missing "data.searchName" (must be string)');
                }
                if (!data.failureType || typeof data.failureType !== 'string') {
                    errors.push('scrape_failed: Missing "data.failureType" (must be string)');
                }
                if (!data.error || typeof data.error !== 'string') {
                    errors.push('scrape_failed: Missing "data.error" (must be string)');
                }
                if (!data.timestamp || typeof data.timestamp !== 'string') {
                    errors.push('scrape_failed: Missing "data.timestamp" (must be ISO string)');
                }
                break;
                
            case 'schedule_started':
            case 'schedule_completed':
            case 'schedule_failed':
                if (!data.sourceName || typeof data.sourceName !== 'string') {
                    errors.push(`${type}: Missing "data.sourceName" (must be string)`);
                }
                break;
                
            case 'schedule_completed':
                if (data.profilesScraped !== undefined && typeof data.profilesScraped !== 'number') {
                    errors.push('schedule_completed: "data.profilesScraped" must be number');
                }
                break;
                
            case 'new_connections':
                if (data.newConnections !== undefined && typeof data.newConnections !== 'number') {
                    errors.push('new_connections: "data.newConnections" must be number');
                }
                break;
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}
```

**Step 2:** Update the existing `sendNotification()` function to call validation. Find this line in `sendNotification()`:

```javascript
        console.log(`${LOG} Sending ${type} notification...`);
```

And add validation BEFORE it:

```javascript
        // Validate payload structure
        const validation = validateZapierPayload(type, payload);
        if (!validation.valid) {
            console.warn(`${LOG} ⚠️ Payload validation failed for ${type}:`, validation.errors);
            // Continue anyway, but log the issues for debugging
        }
        
        console.log(`${LOG} Sending ${type} notification...`);
```

### 🧪 Gate Check 3.3

Test payload validation in the service worker console:

```javascript
// Import validation (or test directly in notifications.js context)
// This would typically be done by testing sendNotification calls

// Expected Zapier catch hook payload structure:
const sampleZapierPayload = {
    type: "scrape_failed",
    timestamp: "2024-12-16T14:30:00.000Z",
    source: "Savvy Pirate v2.0",
    data: {
        message: "❌ Scrape failed for \"John Smith\" in search \"Financial Advisor\": selector_error - Failed to extract title",
        personName: "John Smith",
        searchName: "Financial Advisor",
        failureType: "selector_error",
        error: "Failed to extract title",
        timestamp: "2024-12-16T14:30:00.000Z"
    }
};

// Validation should pass for this structure
// All fields are correct types and present
```

**Validation Rules:**
- ✅ All top-level fields required: `type`, `timestamp`, `source`, `data`
- ✅ `data` must be an object with at least a `message` string
- ✅ Type-specific fields validated based on notification type
- ✅ Timestamps must be valid ISO 8601 format
- ✅ Numbers must be actual numbers (not strings)
- ⚠️ Warnings logged but request still sent (non-blocking)

---

## 🔧 PHASE 4: Service Worker (Core Orchestration)

### Task 4.1: Create background/service_worker.js

**Cursor Prompt:**
```
Create background/service_worker.js as the main orchestration hub for Savvy Pirate v2.0.
This coordinates all extension functionality: scraping, scheduling, notifications, and queue management.
```

**Expected Output:**
```javascript
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
    getExecutionHistory, getScheduleForSource, calculateNextRun
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
        
        // Update state for auto-run
        autoRunState = {
            isRunning: true,
            isAborted: false,
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
            
            // Navigate to search URL
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
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
            }
            
            // Update completed count
            progress.completedSearches++;
            
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

async function waitForScrapingComplete(tabId, timeout = 1800000) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const listener = (message, sender) => {
            if (sender.tab?.id === tabId && message.action === MESSAGE_ACTIONS.SCRAPING_COMPLETE) {
                chrome.runtime.onMessage.removeListener(listener);
                
                // Update total profiles
                getFromStorage(['autoRunState']).then(({ autoRunState }) => {
                    if (autoRunState?.progress) {
                        autoRunState.progress.totalProfiles += message.totalProfiles || 0;
                        saveToStorage({ autoRunState });
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
                
                case MESSAGE_ACTIONS.SCRAPING_COMPLETE: {
                    const { totalProfiles, totalPages } = message;
                    console.log(`${LOG} Scraping complete: ${totalProfiles} profiles from ${totalPages} pages`);
                    stopKeepAlive();
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
                    response = { success: true, history };
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
```

### 🧪 Gate Check 4.1
```javascript
// In service worker DevTools console:

// Check initialization
// Should see "[SW] ✅ Service worker initialized"

// Test message handling
chrome.runtime.sendMessage({ action: 'PING' }, r => console.log('Ping:', r));
// Expected: { success: true, status: 'alive' }

// Check alarms
chrome.alarms.getAll(alarms => console.log('Alarms:', alarms.map(a => a.name)));
// Expected: ['queue-process-alarm', 'schedule-check-alarm']

// Check queue status
chrome.runtime.sendMessage({ action: 'GET_QUEUE_STATUS' }, r => console.log('Queue:', r));
```

---

## 🔧 PHASE 5: Content Script

### Critical: LinkedIn Selector Reference (December 2024)

**IMPORTANT:** LinkedIn frequently changes their DOM structure. These selectors are current as of December 2024 and verified working.

**WORKING SELECTORS:**
```javascript
const SELECTORS = {
    // Name link - STABLE, use as anchor point
    NAME_LINK: 'a[data-view-name="search-result-lockup-title"]',
    
    // Title - PRIMARY selector (current working)
    TITLE_PRIMARY: 'div[data-view-name="people-search-result"] div.d395caa1:not(.a7293f27) > p',
    TITLE_FALLBACK_1: 'div[data-view-name="people-search-result"] div.d395caa1:first-of-type > p',
    TITLE_FALLBACK_2: 'div.acd09c55 > p',  // OLD selector - legacy support
    
    // Location - PRIMARY selector (current working)
    LOCATION_PRIMARY: 'div[data-view-name="people-search-result"] div.d395caa1.a7293f27 > p',
    LOCATION_FALLBACK_1: 'div[data-view-name="people-search-result"] div.d395caa1:nth-of-type(2) > p',
    LOCATION_FALLBACK_2: 'div.bb0216de > p',  // OLD selector - legacy support
    
    // Pagination - STABLE
    NEXT_BUTTON: 'button[data-testid="pagination-controls-next-button-visible"]'
};
```

**KEY INSIGHT:** The `.a7293f27` class distinguishes location from title:
- Title parent: `div.d395caa1` (WITHOUT `.a7293f27`)
- Location parent: `div.d395caa1.a7293f27` (WITH `.a7293f27`)

**CARD FINDING STRATEGY:**
Since the container selector (`div[data-view-name="people-search-result"]`) can be unreliable, the multi-layer extraction system:
1. **Layer 0 (Structure-Aware)**: Finds name link, traverses DOM positionally (class-agnostic)
2. **Layer 1 (Class-Based)**: Uses PRIMARY selectors first, falls back to position-based, then OLD selectors
3. **Layer 2 (Direct P-Tag)**: Filters all p tags, uses positional order
4. **Layer 3 (Content Validation)**: Swaps title/location if content patterns suggest misidentification

**EXTRACTION PRIORITY:**
- Always try structure-aware extraction first (most resilient)
- Then try class-based selectors in priority order
- Fall back to direct p-tag extraction if needed
- Final validation with content pattern matching

---

### Task 5.1: Create content/content.js

**CRITICAL: LinkedIn DOM Structure (as of December 2024)**

Based on live diagnostic testing and current implementation, here are the **ACTUAL WORKING SELECTORS**:

```javascript
// CURRENT WORKING SELECTORS (December 2024 - VERIFIED)
const SELECTORS = {
    // Card container - Use name links as anchor (more reliable than container selector)
    CARD_PRIMARY: 'div[data-view-name="people-search-result"]',  // May work, but use name links
    CARD_FALLBACK: 'a[href*="/in/"]',  // ✅ Find cards via profile links (more reliable)
    
    // Name - WORKS (stable data attribute)
    NAME_LINK: 'a[data-view-name="search-result-lockup-title"]',  // ✅
    
    // Title - CURRENT WORKING SELECTORS (Priority order)
    // Strategy 1: Title is in div.d395caa1 WITHOUT the .a7293f27 class
    TITLE_PRIMARY: 'div[data-view-name="people-search-result"] div.d395caa1:not(.a7293f27) > p',  // ✅ PRIMARY
    // Strategy 2: First div.d395caa1 (position-based)
    TITLE_FALLBACK_1: 'div[data-view-name="people-search-result"] div.d395caa1:first-of-type > p',  // ✅
    // Strategy 3: OLD selector (may still work for some accounts)
    TITLE_FALLBACK_2: 'div.acd09c55 > p',  // ⚠️ OLD - fallback only
    
    // Location - CURRENT WORKING SELECTORS (Priority order)
    // Strategy 1: Location's parent div HAS the .a7293f27 class (key differentiator)
    LOCATION_PRIMARY: 'div[data-view-name="people-search-result"] div.d395caa1.a7293f27 > p',  // ✅ PRIMARY
    // Strategy 2: Second div.d395caa1 (position-based)
    LOCATION_FALLBACK_1: 'div[data-view-name="people-search-result"] div.d395caa1:nth-of-type(2) > p',  // ✅
    // Strategy 3: OLD selector (may still work for some accounts)
    LOCATION_FALLBACK_2: 'div.bb0216de > p',  // ⚠️ OLD - fallback only
    
    // Pagination - WORKS (stable data-testid)
    NEXT_BUTTON: 'button[data-testid="pagination-controls-next-button-visible"]'  // ✅
};

// DOM Structure observed:
// - 4 p tags per card total
// - 2 "data" p tags (title + location) after filtering noise
// - Title parent div: div.d395caa1 WITHOUT .a7293f27 class
// - Location parent div: div.d395caa1 WITH .a7293f27 class
// - KEY DIFFERENTIATOR: The .a7293f27 class distinguishes location from title
// - Both share common base class (d395caa1) but location has extra class
```

**Cursor Prompt:**
```
Create content/content.js as a SINGLE consolidated file for LinkedIn scraping.

CRITICAL CONSTRAINTS:
1. NO ES modules, NO imports - this is a content script
2. Everything in ONE IIFE (Immediately Invoked Function Expression)
3. Communicate with background via chrome.runtime.sendMessage
4. Handle chrome.runtime.lastError in ALL callbacks

CRITICAL: LINKEDIN DOM SELECTORS (December 2024)

**MULTI-LAYER EXTRACTION STRATEGY** (most resilient to LinkedIn changes):

**Layer 0: Structure-Aware Extraction** (MOST RESILIENT - try first)
- Finds name link as anchor point
- Traverses DOM tree to find sibling/child elements
- Uses positional relationships, not class names
- Content pattern validation to identify title vs location
- Works even when classes change completely

**Layer 1: Class-Based Selectors** (current LinkedIn structure)
- Find profile cards by locating all profile links first:
  const profileLinks = document.querySelectorAll('a[data-view-name="search-result-lockup-title"]');
- For each link, find card container (for class-based extraction)
- Use CURRENT WORKING SELECTORS (priority order):
  - Name: a[data-view-name="search-result-lockup-title"] (the link itself)
  - Title PRIMARY: div.d395caa1:not(.a7293f27) > p (title lacks .a7293f27 class)
  - Location PRIMARY: div.d395caa1.a7293f27 > p (location has .a7293f27 class)
  - Title FALLBACK: div.d395caa1:first-of-type > p (position-based)
  - Location FALLBACK: div.d395caa1:nth-of-type(2) > p (position-based)
  - OLD selectors (legacy support): div.acd09c55 > p, div.bb0216de > p
  - Next button: button[data-testid="pagination-controls-next-button-visible"]

**Layer 2: Direct P-Tag Extraction** (fallback when class selectors fail)
- Get all p tags in card, filter out noise
- First remaining p tag = Title, Second = Location
- Filter out: "mutual connection", "• 1st", "• 2nd", "• 3rd", "Connect", "Message", "Follow"
- Works by position regardless of classes

**Layer 3: Content Pattern Validation** (catches misidentification)
- Title patterns: /Financial|Investment|Wealth|Advisor|Manager|at |Director|Principal|Owner|Partner|Planner/i
- Location patterns: /Area|Metropolitan|County|,\s*[A-Z]{2}$|United States|Greater|Bay Area/i
- Swap if title looks like location and vice versa

Structure (all in one IIFE):

1. CONFIG object:
   - MAX_PAGES: 1000
   - MIN_WAIT_SECONDS: 5
   - MAX_WAIT_SECONDS: 8
   - SCROLL_WAIT_MS: 2000

2. SELECTORS object (with fallbacks - PRIORITY ORDER):
   - NAME_LINK: 'a[data-view-name="search-result-lockup-title"]'
   - TITLE_PRIMARY: 'div[data-view-name="people-search-result"] div.d395caa1:not(.a7293f27) > p'
   - TITLE_FALLBACK_1: 'div[data-view-name="people-search-result"] div.d395caa1:first-of-type > p'
   - TITLE_FALLBACK_2: 'div.acd09c55 > p' (old selector - legacy support)
   - LOCATION_PRIMARY: 'div[data-view-name="people-search-result"] div.d395caa1.a7293f27 > p'
   - LOCATION_FALLBACK_1: 'div[data-view-name="people-search-result"] div.d395caa1:nth-of-type(2) > p'
   - LOCATION_FALLBACK_2: 'div.bb0216de > p' (old selector - legacy support)
   - NEXT_BUTTON: 'button[data-testid="pagination-controls-next-button-visible"]'

3. STATE variables:
   - isScrapingActive
   - stopRequested
   - stopButton (DOM reference)

4. UTILITY functions:
   - wait(ms) - Promise-based delay
   - randomDelay() - Random 5-8 second delay
   - cleanName(text) - Remove parentheticals
   - parseNameWithAccreditations(fullName) - Extract name + credentials
   - sendMessageSafe(message, callback) - Wrapper with error handling

5. CARD FINDING (handles container selector variability):
   - findProfileCards() - Find cards via name links, traverse up to container
   - Returns array of {card, nameLink, nameText} objects
   - For structure-aware extraction, name link is sufficient (no need for exact container)

6. DATA EXTRACTION (multi-layer - try in order):
   **Layer 0 - Structure-Aware Extraction** (MOST RESILIENT - try first):
     - extractByStructure(card) - DOM position-based, class-agnostic
     - findAllTextElementsInCard(card, nameLink) - Find all text elements
     - identifyTitleAndLocation(textElements, nameLink) - Position + content validation
     - Uses vertical position and content patterns
     - calculateTitleConfidence() and calculateLocationConfidence() for validation
   
   **Layer 1 - Class-Based Selectors** (current LinkedIn structure - primary):
     - Try PRIMARY selectors first: div.d395caa1:not(.a7293f27) > p (title)
     - Try PRIMARY selectors first: div.d395caa1.a7293f27 > p (location)
     - Fallback to position-based: div.d395caa1:first-of-type > p (title)
     - Fallback to position-based: div.d395caa1:nth-of-type(2) > p (location)
     - Fallback to OLD selectors: div.acd09c55 > p, div.bb0216de > p
   
   **Layer 2 - Direct P-Tag Extraction** (fallback when class selectors fail):
     - directPTagExtraction(card, nameLink) - Get all p tags, filter noise
     - Filter out: name link, "mutual connection", "• 1st/2nd/3rd", "Connect", "Message", "Follow"
     - Use positional order: First remaining p = title, Second = location
     - Works regardless of class names
   
   **Layer 3 - Content Pattern Matching** (validation - catches swaps):
     - looksLikeTitle(text) - Enhanced patterns including: Financial, Investment, Wealth, Advisor, Manager, Director, Principal, Owner, Partner, Planner, "at ", "|"
     - looksLikeLocation(text) - Enhanced patterns including: Area, Metropolitan, County, ", ST", United States, Greater, Bay Area
     - If title looks like location AND location looks like title, swap them
     - Confidence scoring helps validate extraction

7. SCRAPING FUNCTIONS:
   - scrapeCurrentPage(sourceName) - Extract all profiles from current page
   - clickNextButton() - Navigate to next page using data-testid selector
   - detectPaginationState() - Check if more pages exist
   - waitForEntriesToLoad(expected, timeout) - Wait for lazy loading

8. STOP BUTTON UI:
   - createStopButton() - Inject floating stop button
   - removeStopButton()
   - updateButtonStatus(text, color)

9. MAIN SCRAPING LOOP:
   - startScraping(sourceName)
   - Loop through pages, scrape, send data, navigate
   - Handle stop requests
   - Send SCRAPING_COMPLETE when done

10. MESSAGE LISTENER:
    - START_SCRAPING: Begin scraping
    - STOP_SCRAPING: Set stop flag
    - GET_STATUS: Return current state
    - PING: Return alive status

11. INITIALIZATION:
    - Log load message
    - Auto-validate selectors on search pages

Row format sent to background:
[date, name, title, location, sourceName, linkedInUrl, accred1, accred2, accred3, accred4, accred5, accred6]

Log prefix: [CS]
```

**Expected Core Extraction Logic:**

```javascript
// CARD FINDING - Handle container selector variability
function findProfileCards() {
    const cards = [];
    
    // Find all name links (this selector still works and is stable)
    const nameLinks = document.querySelectorAll('a[data-view-name="search-result-lockup-title"]');
    
    nameLinks.forEach(nameLink => {
        // For structure-aware extraction, we don't need exact container
        // But for class-based selectors, we need to find the card context
        // Try multiple parent levels since exact structure varies
        let card = nameLink.closest('div[data-view-name="people-search-result"]') ||
                   nameLink.closest('li.reusable-search__result-container') ||
                   nameLink.closest('div[class*="entity-result"]') ||
                   nameLink.closest('li') ||
                   findCardContainer(nameLink);
        
        if (card) {
            cards.push({
                card,
                nameLink,
                nameText: nameLink.innerText?.trim() || ''
            });
        }
    });
    
    return cards;
}

// Fallback: traverse up until we find a container with title/location elements
function findCardContainer(nameLink) {
    let current = nameLink.parentElement;
    let depth = 0;
    const maxDepth = 10;
    
    while (current && depth < maxDepth) {
        // Check if this container has title and location elements (using CURRENT selectors)
        const hasTitle = current.querySelector('div.d395caa1:not(.a7293f27) > p') ||
                         current.querySelector('div.acd09c55 > p');
        const hasLocation = current.querySelector('div.d395caa1.a7293f27 > p') ||
                            current.querySelector('div.bb0216de > p');
        
        if (hasTitle || hasLocation) {
            return current;
        }
        
        current = current.parentElement;
        depth++;
    }
    
    // Last resort: go up 5-6 levels from name link (typical card depth)
    current = nameLink;
    for (let i = 0; i < 6 && current.parentElement; i++) {
        current = current.parentElement;
    }
    return current;
}

// DATA EXTRACTION - Multi-layer approach (most resilient)
function extractProfileData(cardInfo, sourceName) {
    const { card, nameLink, nameText } = cardInfo;
    
    // Parse name and accreditations
    const { cleanName, accreditations } = parseNameWithAccreditations(nameText);
    
    // Get LinkedIn URL
    const url = nameLink.href?.split('?')[0] || '';
    
    let title = '';
    let location = '';
    let extractionMethod = 'none';
    
    // LAYER 0: Structure-aware extraction (MOST RESILIENT - try first)
    console.log('[CS] 🔍 Attempting structure-aware extraction for card');
    const structureResult = extractByStructure(card);
    if (structureResult && (structureResult.title || structureResult.location)) {
        title = structureResult.title;
        location = structureResult.location;
        extractionMethod = structureResult.method;
        console.log('[CS] ✅ Used structure-aware extraction', { 
            title: title?.substring(0, 30), 
            location: location?.substring(0, 30) 
        });
    } else {
        console.log('[CS] ⚠️ Structure-aware extraction failed, trying class selectors');
        
        // LAYER 1: Try class-based selectors (current LinkedIn structure - PRIMARY)
        // Try PRIMARY selectors first (most reliable)
        const titleElPrimary = card.querySelector('div[data-view-name="people-search-result"] div.d395caa1:not(.a7293f27) > p');
        const locationElPrimary = card.querySelector('div[data-view-name="people-search-result"] div.d395caa1.a7293f27 > p');
        
        if (titleElPrimary) title = titleElPrimary.innerText?.trim() || '';
        if (locationElPrimary) location = locationElPrimary.innerText?.trim() || '';
        
        // Fallback to position-based selectors
        if (!title) {
            const titleElFallback1 = card.querySelector('div[data-view-name="people-search-result"] div.d395caa1:first-of-type > p');
            if (titleElFallback1) title = titleElFallback1.innerText?.trim() || '';
        }
        if (!location) {
            const locationElFallback1 = card.querySelector('div[data-view-name="people-search-result"] div.d395caa1:nth-of-type(2) > p');
            if (locationElFallback1) location = locationElFallback1.innerText?.trim() || '';
        }
        
        // Fallback to OLD selectors (legacy support)
        if (!title) {
            const titleElOld = card.querySelector('div.acd09c55 > p');
            if (titleElOld) title = titleElOld.innerText?.trim() || '';
        }
        if (!location) {
            const locationElOld = card.querySelector('div.bb0216de > p');
            if (locationElOld) location = locationElOld.innerText?.trim() || '';
        }
        
        extractionMethod = (title || location) ? 'class-selectors' : 'none';
    }
    
    // LAYER 2: Fallback to direct p-tag extraction (if structure-aware and class selectors failed)
    if (!title || !location) {
        console.log('[CS] ⚠️ Class selectors incomplete, trying direct p-tag method');
        const fallback = directPTagExtraction(card, nameLink);
        if (!title && fallback.title) {
            title = fallback.title;
            extractionMethod = extractionMethod === 'none' ? 'direct-p-tag' : extractionMethod + '+direct-p-tag';
        }
        if (!location && fallback.location) {
            location = fallback.location;
            extractionMethod = extractionMethod === 'none' ? 'direct-p-tag' : extractionMethod + '+direct-p-tag';
        }
    }
    
    // LAYER 3: Content validation - swap if misidentified
    if (title && location) {
        const titleLooksLikeLocation = looksLikeLocation(title);
        const locationLooksLikeTitle = looksLikeTitle(location);
        
        if (titleLooksLikeLocation && locationLooksLikeTitle) {
            console.log('[CS] ⚠️ Content patterns suggest title/location swap needed');
            [title, location] = [location, title];
            extractionMethod += '+content-swap';
        }
    }
    
    // Log extraction method for debugging
    if (!title && !location) {
        console.warn('[CS] ⚠️ Failed to extract title and location for:', cleanName);
    }
    
    // Format date
    const today = new Date().toISOString().split('T')[0];
    
    return [
        today,
        cleanName,
        title,
        location,
        sourceName,
        url,
        ...accreditations  // Spreads 6 accreditation fields
    ];
}

// LAYER 0: Structure-aware extraction (MOST RESILIENT)
function extractByStructure(card) {
    try {
        // Step 1: Find the name link (our anchor point)
        const nameLink = card.querySelector('a[href*="/in/"]');
        if (!nameLink) {
            console.log('[STRUCTURE] No name link found in card');
            return null;
        }

        // Step 2: Get all text-containing elements
        const textElements = findAllTextElementsInCard(card, nameLink);
        if (textElements.length < 2) {
            console.log('[STRUCTURE] Not enough text elements found:', textElements.length);
            return null;
        }

        // Step 3: Identify title and location by position and content
        const result = identifyTitleAndLocation(textElements, nameLink);
        
        if (result.title || result.location) {
            console.log('[STRUCTURE] ✅ Extracted via structure:', {
                title: result.title?.substring(0, 50),
                location: result.location
            });
            return {
                title: result.title || '',
                location: result.location || '',
                method: 'structure-aware'
            };
        }

        return null;
    } catch (error) {
        console.warn('[STRUCTURE] Structure extraction error:', error);
        return null;
    }
}

// Helper: Find all text elements in card (excluding name)
function findAllTextElementsInCard(card, nameLink) {
    const textElements = [];
    const nameLinkRect = nameLink.getBoundingClientRect();
    const nameText = nameLink.innerText.trim().toLowerCase();

    // Get all potential text containers (p tags - LinkedIn's title/location are in p tags)
    const candidates = card.querySelectorAll('p, div > p, div.d395caa1 > p');
    
    candidates.forEach((el, index) => {
        const text = el.innerText?.trim();
        
        // Skip if: no text, too short, contains name, inside name link, is button
        if (!text || text.length < 3) return;
        if (text.toLowerCase() === nameText) return;
        if (nameLink.contains(el)) return;
        if (el.closest('button, [role="button"]')) return;
        
        // Skip common non-content patterns
        const skipPatterns = [
            /^connect$/i, /^message$/i, /^follow$/i, /^see all/i,
            /^\d+ mutual/i, /and \d+ other mutual connections/i,
            /^view profile$/i, /^•\s*(1st|2nd|3rd)/i,
            /mutual connection/i, /other mutual/i
        ];
        if (skipPatterns.some(p => p.test(text))) return;
        
        // Calculate vertical position relative to name
        const elRect = el.getBoundingClientRect();
        const verticalOffset = elRect.top - nameLinkRect.top;

        textElements.push({
            element: el,
            text: text,
            verticalOffset: verticalOffset,
            index: index
        });
    });

    // Sort by vertical position (top to bottom)
    textElements.sort((a, b) => a.verticalOffset - b.verticalOffset);

    // Filter to only elements BELOW the name (positive vertical offset)
    const belowName = textElements.filter(el => el.verticalOffset > 5);
    
    // Return only the first 2 candidates (title and location)
    return belowName.slice(0, 2);
}

// Helper: Identify title vs location using position and content patterns
function identifyTitleAndLocation(textElements, nameLink) {
    const nameRect = nameLink.getBoundingClientRect();
    const belowName = textElements.filter(el => el.verticalOffset > 5);

    if (belowName.length === 0) {
        return { title: '', location: '' };
    }

    // Simple case: first element is title, second is location
    let titleCandidate = belowName[0]?.text || '';
    let locationCandidate = belowName[1]?.text || '';

    // Content validation - swap if misidentified
    if (looksLikeLocation(titleCandidate) && looksLikeTitle(locationCandidate)) {
        console.log('[STRUCTURE] Content patterns suggest swap needed');
        [titleCandidate, locationCandidate] = [locationCandidate, titleCandidate];
    }

    return {
        title: titleCandidate,
        location: locationCandidate
    };
}

// Helper: Check if text looks like a location
function looksLikeLocation(text) {
    if (!text) return false;
    
    const locationPatterns = [
        /\b(?:Area|Metropolitan|County|Region)\s*$/i,
        /^[A-Z][a-z]+,\s*[A-Z]{2}$/,  // "City, ST"
        /\b(?:United States|USA|Greater|Bay Area)\b/i
    ];
    
    return locationPatterns.some(p => p.test(text));
}

// Helper: Check if text looks like a title
function looksLikeTitle(text) {
    if (!text) return false;
    
    const titlePatterns = [
        /\bat\s+[A-Z]/i,  // "at Company"
        /\s*\|\s*/,  // "Title | Company"
        /\b(?:Financial|Investment|Wealth|Advisor|Manager|Director|Principal|Owner|Partner|Planner)\b/i,
        /Financial (?:Advisor|Planner|Consultant)/i,
        /Wealth (?:Manager|Advisor)/i,
        /Investment (?:Advisor|Manager)/i
    ];
    
    return titlePatterns.some(p => p.test(text));
}

// LAYER 2: Direct p-tag extraction fallback
function directPTagExtraction(card, nameLink) {
    const allPTags = Array.from(card.querySelectorAll('p'));
    
    // Filter out noise
    const dataPTags = allPTags.filter(p => {
        // Skip if contains name link
        if (p.contains(nameLink) || nameLink.contains(p)) return false;
        
        const text = p.innerText?.trim() || '';
        
        // Filter out known noise patterns
        if (text.includes('mutual connection')) return false;
        if (text.includes('other mutual')) return false;
        if (/^•\s*(1st|2nd|3rd)/i.test(text)) return false;
        if (text.includes('• 1st') || text.includes('• 2nd') || text.includes('• 3rd')) return false;
        if (text.toLowerCase().includes('connect')) return false;
        if (text.toLowerCase().includes('message')) return false;
        if (text.toLowerCase().includes('follow')) return false;
        if (text.length < 3 || text.length > 200) return false;
        
        return true;
    });
    
    // First remaining = title, second = location
    return {
        title: dataPTags[0]?.innerText?.trim() || '',
        location: dataPTags[1]?.innerText?.trim() || ''
    };
}
```

---

## 🔧 PHASE 6: Popup UI

### Task 6.1: Create popup/popup.html

**Cursor Prompt:**
```
Create popup/popup.html with all sections and element IDs for JavaScript binding.
```

**Expected Output:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=400">
    <title>Savvy Pirate</title>
    <link rel="stylesheet" href="popup.css">
</head>
<body>
    <!-- HEADER -->
    <header class="header">
        <img src="../icons/icon48.png" alt="Savvy Pirate" class="logo">
        <div class="header-text">
            <h1>Savvy Pirate</h1>
            <span class="version">v2.0</span>
        </div>
        <div id="status-indicator" class="status-indicator"></div>
    </header>
    
    <main class="main-content">
        <!-- SECTION: Input Sheet -->
        <section class="section" id="section-input">
            <div class="section-header" data-section="input">
                <span>📋 Input Sheet</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <div class="input-group">
                    <input type="text" id="input-sheet-url" placeholder="Google Sheet URL or ID">
                    <button id="load-sheet-btn" class="btn btn-primary">Load</button>
                </div>
                <div id="input-sheet-info" class="info-box hidden">
                    <a id="input-sheet-link" href="#" target="_blank"></a>
                    <span id="search-count"></span>
                </div>
            </div>
        </section>
        
        <!-- SECTION: Workbook Mappings -->
        <section class="section" id="section-mappings">
            <div class="section-header" data-section="mappings">
                <span>📁 Workbook Mappings</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <div id="mapping-list" class="mapping-list"></div>
                <button id="add-workbook-btn" class="btn btn-secondary">+ Add Workbook</button>
            </div>
        </section>
        
        <!-- SECTION: Manual Scraping -->
        <section class="section" id="section-scraping">
            <div class="section-header" data-section="scraping">
                <span>🔍 Manual Scraping</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <div class="input-group">
                    <select id="source-select">
                        <option value="">Select source...</option>
                    </select>
                </div>
                <div class="button-group">
                    <button id="start-scrape-btn" class="btn btn-primary">▶ Start Scrape</button>
                    <button id="stop-scrape-btn" class="btn btn-danger hidden">⏹ Stop</button>
                </div>
                <div id="scrape-progress" class="progress-container hidden">
                    <div class="progress-bar">
                        <div id="progress-fill" class="progress-fill"></div>
                    </div>
                    <span id="progress-text"></span>
                </div>
            </div>
        </section>
        
        <!-- SECTION: Compare Tabs -->
        <section class="section" id="section-compare">
            <div class="section-header" data-section="compare">
                <span>📊 Compare Tabs</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <div class="input-group">
                    <select id="compare-workbook-select">
                        <option value="">Select workbook...</option>
                    </select>
                </div>
                <div class="compare-grid">
                    <div class="compare-column">
                        <label>Baseline Tab (older)</label>
                        <select id="compare-tab1"></select>
                    </div>
                    <div class="compare-column">
                        <label>Compare Tab (newer)</label>
                        <select id="compare-tab2"></select>
                    </div>
                </div>
                <div class="input-group">
                    <input type="text" id="compare-output-name" placeholder="Output tab name (e.g., New_12_16)">
                </div>
                <div class="input-group">
                    <label>Compare by:</label>
                    <select id="compare-key-column">
                        <option value="1">Name</option>
                        <option value="5">LinkedIn URL</option>
                    </select>
                </div>
                <button id="compare-tabs-btn" class="btn btn-primary">Compare Tabs</button>
                <div id="compare-results" class="results-box hidden"></div>
            </div>
        </section>
        
        <!-- SECTION: Schedules -->
        <section class="section" id="section-schedules">
            <div class="section-header" data-section="schedules">
                <span>⏰ Schedules</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <div id="schedule-list" class="schedule-list"></div>
                <button id="add-schedule-btn" class="btn btn-secondary">+ Add Schedule</button>
                <div id="next-run-info" class="info-box"></div>
            </div>
        </section>
        
        <!-- SECTION: Execution History -->
        <section class="section" id="section-history">
            <div class="section-header" data-section="history">
                <span>📜 Execution History</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <table id="history-table" class="data-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Source</th>
                            <th>Status</th>
                            <th>Profiles</th>
                        </tr>
                    </thead>
                    <tbody id="history-tbody"></tbody>
                </table>
            </div>
        </section>
        
        <!-- SECTION: Settings -->
        <section class="section" id="section-settings">
            <div class="section-header" data-section="settings">
                <span>⚙️ Settings</span>
                <span class="chevron">▼</span>
            </div>
            <div class="section-content">
                <div class="input-group">
                    <label>Zapier Webhook URL</label>
                    <input type="text" id="webhook-url" placeholder="https://hooks.zapier.com/hooks/catch/...">
                </div>
                <div class="input-group">
                    <button id="save-webhook-btn" class="btn btn-secondary">Save Webhook URL</button>
                    <button id="test-webhook-btn" class="btn btn-outline">Test Webhook</button>
                </div>
                <div id="webhook-status" class="status-text"></div>
                <div class="info-box mt-2">
                    <small>Webhook sends notifications for scraping failures with: time, failure type, person name, and search name.</small>
                </div>
            </div>
        </section>
    </main>
    
    <!-- FOOTER -->
    <footer class="footer">
        <div class="queue-status">
            <span>Queue: <span id="queue-pending">0</span> pending</span>
            <span class="separator">|</span>
            <span id="queue-failed-container" class="hidden">
                <span id="queue-failed">0</span> failed
                <button id="retry-failed-btn" class="btn-link">Retry</button>
            </span>
        </div>
        <button id="deduplicate-btn" class="btn btn-outline btn-sm">Deduplicate</button>
    </footer>
    
    <!-- MODAL: Add Schedule -->
    <div id="schedule-modal" class="modal hidden">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Add Schedule</h2>
                <button id="modal-close-btn" class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Source</label>
                    <select id="schedule-source-select"></select>
                </div>
                <div class="form-group">
                    <label>Day of Week</label>
                    <select id="schedule-day-select">
                        <option value="0">Sunday</option>
                        <option value="1">Monday</option>
                        <option value="2">Tuesday</option>
                        <option value="3">Wednesday</option>
                        <option value="4">Thursday</option>
                        <option value="5">Friday</option>
                        <option value="6">Saturday</option>
                    </select>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Hour (0-23)</label>
                        <select id="schedule-hour-select"></select>
                    </div>
                    <div class="form-group">
                        <label>Minute</label>
                        <select id="schedule-minute-select">
                            <option value="0">:00</option>
                            <option value="15">:15</option>
                            <option value="30">:30</option>
                            <option value="45">:45</option>
                        </select>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="cancel-schedule-btn" class="btn btn-secondary">Cancel</button>
                <button id="save-schedule-btn" class="btn btn-primary">Save Schedule</button>
            </div>
        </div>
    </div>
    
    <!-- MODAL: Add Workbook -->
    <div id="workbook-modal" class="modal hidden">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Add Workbook</h2>
                <button id="workbook-modal-close-btn" class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Google Sheet URL or ID</label>
                    <input type="text" id="new-workbook-url" placeholder="https://docs.google.com/spreadsheets/d/...">
                </div>
                <div class="form-group">
                    <label>Map to Source (optional)</label>
                    <select id="new-workbook-source"></select>
                </div>
            </div>
            <div class="modal-footer">
                <button id="cancel-workbook-btn" class="btn btn-secondary">Cancel</button>
                <button id="confirm-workbook-btn" class="btn btn-primary">Add Workbook</button>
            </div>
        </div>
    </div>
    
    <!-- TOAST NOTIFICATIONS -->
    <div id="toast-container" class="toast-container"></div>
    
    <script src="popup.js"></script>
</body>
</html>
```

### Element ID Reference

| ID | Purpose | Event |
|----|---------|-------|
| `input-sheet-url` | Input sheet URL/ID input | - |
| `load-sheet-btn` | Load input sheet | click |
| `input-sheet-link` | Link to loaded sheet | - |
| `search-count` | Number of searches found | - |
| `mapping-list` | Container for workbook mappings | - |
| `add-workbook-btn` | Open add workbook modal | click |
| `source-select` | Select source for manual scrape | change |
| `start-scrape-btn` | Start manual scrape | click |
| `stop-scrape-btn` | Stop manual scrape | click |
| `scrape-progress` | Progress container | - |
| `progress-fill` | Progress bar fill element | - |
| `progress-text` | Progress text display | - |
| `compare-workbook-select` | Workbook for comparison | change |
| `compare-tab1` | Baseline tab dropdown | change |
| `compare-tab2` | Compare tab dropdown | change |
| `compare-output-name` | Output tab name input | - |
| `compare-key-column` | Key column selector | change |
| `compare-tabs-btn` | Execute comparison | click |
| `compare-results` | Comparison results display | - |
| `schedule-list` | Container for schedules | - |
| `add-schedule-btn` | Open schedule modal | click |
| `next-run-info` | Next scheduled run info | - |
| `history-tbody` | Execution history table body | - |
| `webhook-url` | Webhook URL input | - |
| `save-webhook-btn` | Save webhook URL | click |
| `test-webhook-btn` | Test webhook | click |
| `webhook-status` | Webhook status display | - |
| `queue-pending` | Pending queue count | - |
| `queue-failed` | Failed queue count | - |
| `retry-failed-btn` | Retry failed queue items | click |
| `deduplicate-btn` | Deduplicate current sheet | click |
| `schedule-modal` | Schedule modal container | - |
| `schedule-source-select` | Source for new schedule | change |
| `schedule-day-select` | Day of week | change |
| `schedule-hour-select` | Hour (0-23) | change |
| `schedule-minute-select` | Minute (0, 15, 30, 45) | change |
| `save-schedule-btn` | Save new schedule | click |
| `cancel-schedule-btn` | Cancel schedule modal | click |
| `modal-close-btn` | Close schedule modal | click |
| `workbook-modal` | Workbook modal container | - |
| `new-workbook-url` | New workbook URL input | - |
| `new-workbook-source` | Map to source dropdown | change |
| `confirm-workbook-btn` | Confirm workbook addition | click |
| `cancel-workbook-btn` | Cancel workbook modal | click |
| `workbook-modal-close-btn` | Close workbook modal | click |
| `toast-container` | Toast notification container | - |

### Task 6.2: Create popup/popup.css

**Cursor Prompt:**
```
Create popup/popup.css with dark pirate theme styling for all components.
```

**Expected Output:**
```css
/* popup/popup.css - Savvy Pirate Dark Theme */

/* ============================================================
   CSS VARIABLES
   ============================================================ */
:root {
    --bg-primary: #1a1a1a;
    --bg-secondary: #2d2d2d;
    --bg-tertiary: #3d3d3d;
    --text-primary: #ffffff;
    --text-secondary: #b0b0b0;
    --text-muted: #707070;
    --accent-red: #dc3545;
    --accent-red-hover: #c82333;
    --accent-gold: #ffc107;
    --accent-green: #28a745;
    --accent-blue: #007bff;
    --border-color: #444;
    --shadow: 0 2px 8px rgba(0,0,0,0.3);
    --radius: 6px;
    --transition: all 0.2s ease;
}

/* ============================================================
   BASE STYLES
   ============================================================ */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    width: 400px;
    min-height: 500px;
    max-height: 600px;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    background: var(--bg-primary);
    color: var(--text-primary);
}

/* ============================================================
   HEADER
   ============================================================ */
.header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: #ffffff;
    border-bottom: 3px solid var(--accent-red);
}

.logo {
    width: 36px;
    height: 36px;
    margin-right: 12px;
}

.header-text h1 {
    font-size: 18px;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0;
}

.version {
    font-size: 11px;
    color: #666;
}

.status-indicator {
    margin-left: auto;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
}

.status-indicator.active {
    background: var(--accent-green);
    animation: pulse 1.5s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

/* ============================================================
   MAIN CONTENT
   ============================================================ */
.main-content {
    padding: 8px;
}

/* ============================================================
   SECTIONS
   ============================================================ */
.section {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    margin-bottom: 8px;
    overflow: hidden;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    cursor: pointer;
    font-weight: 600;
    background: var(--bg-tertiary);
    transition: var(--transition);
}

.section-header:hover {
    background: #4a4a4a;
}

.chevron {
    font-size: 10px;
    transition: transform 0.2s;
}

.section.collapsed .chevron {
    transform: rotate(-90deg);
}

.section.collapsed .section-content {
    display: none;
}

.section-content {
    padding: 12px;
}

/* ============================================================
   FORM ELEMENTS
   ============================================================ */
.input-group {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
}

.input-group:last-child {
    margin-bottom: 0;
}

input[type="text"],
select {
    flex: 1;
    padding: 8px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    color: var(--text-primary);
    font-size: 13px;
}

input[type="text"]:focus,
select:focus {
    outline: none;
    border-color: var(--accent-red);
}

input::placeholder {
    color: var(--text-muted);
}

label {
    display: block;
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--text-secondary);
}

/* ============================================================
   BUTTONS
   ============================================================ */
.btn {
    padding: 8px 14px;
    border: none;
    border-radius: var(--radius);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: var(--transition);
    white-space: nowrap;
}

.btn-primary {
    background: var(--accent-red);
    color: white;
}

.btn-primary:hover {
    background: var(--accent-red-hover);
}

.btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
}

.btn-secondary:hover {
    background: #4a4a4a;
}

.btn-danger {
    background: #6c1420;
    color: white;
}

.btn-danger:hover {
    background: #8c1a2a;
}

.btn-outline {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
}

.btn-outline:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
}

.btn-sm {
    padding: 4px 10px;
    font-size: 11px;
}

.btn-link {
    background: none;
    border: none;
    color: var(--accent-blue);
    cursor: pointer;
    font-size: 12px;
    padding: 0 4px;
}

.btn-link:hover {
    text-decoration: underline;
}

.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.button-group {
    display: flex;
    gap: 8px;
}

/* ============================================================
   INFO & RESULTS BOXES
   ============================================================ */
.info-box {
    padding: 8px 10px;
    background: var(--bg-primary);
    border-radius: var(--radius);
    font-size: 12px;
    margin-top: 8px;
}

.info-box a {
    color: var(--accent-blue);
    text-decoration: none;
}

.info-box a:hover {
    text-decoration: underline;
}

.results-box {
    padding: 10px;
    background: var(--bg-primary);
    border-radius: var(--radius);
    margin-top: 10px;
    border-left: 3px solid var(--accent-green);
}

.results-box.error {
    border-left-color: var(--accent-red);
}

/* ============================================================
   PROGRESS BAR
   ============================================================ */
.progress-container {
    margin-top: 10px;
}

.progress-bar {
    height: 6px;
    background: var(--bg-primary);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 4px;
}

.progress-fill {
    height: 100%;
    background: var(--accent-red);
    border-radius: 3px;
    transition: width 0.3s ease;
    width: 0%;
}

#progress-text {
    font-size: 11px;
    color: var(--text-secondary);
}

/* ============================================================
   COMPARE GRID
   ============================================================ */
.compare-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
}

.compare-column select {
    width: 100%;
    margin-top: 4px;
}

/* ============================================================
   SCHEDULE LIST
   ============================================================ */
.schedule-list {
    margin-bottom: 10px;
}

.schedule-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: var(--bg-primary);
    border-radius: var(--radius);
    margin-bottom: 6px;
}

.schedule-info {
    flex: 1;
}

.schedule-source {
    font-weight: 500;
    margin-bottom: 2px;
}

.schedule-time {
    font-size: 11px;
    color: var(--text-secondary);
}

.schedule-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

/* Toggle Switch */
.toggle-switch {
    position: relative;
    width: 36px;
    height: 20px;
}

.toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-tertiary);
    border-radius: 20px;
    transition: var(--transition);
}

.toggle-slider:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background: white;
    border-radius: 50%;
    transition: var(--transition);
}

.toggle-switch input:checked + .toggle-slider {
    background: var(--accent-green);
}

.toggle-switch input:checked + .toggle-slider:before {
    transform: translateX(16px);
}

.delete-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 0 4px;
}

.delete-btn:hover {
    color: var(--accent-red);
}

/* ============================================================
   DATA TABLE
   ============================================================ */
.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
}

.data-table th,
.data-table td {
    padding: 6px 8px;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
}

.data-table th {
    background: var(--bg-tertiary);
    font-weight: 600;
    color: var(--text-secondary);
}

.data-table tbody tr:hover {
    background: var(--bg-tertiary);
}

/* Status Badges */
.status-badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 500;
}

.status-badge.running {
    background: rgba(40, 167, 69, 0.2);
    color: var(--accent-green);
}

.status-badge.completed {
    background: rgba(0, 123, 255, 0.2);
    color: var(--accent-blue);
}

.status-badge.failed {
    background: rgba(220, 53, 69, 0.2);
    color: var(--accent-red);
}

/* ============================================================
   MAPPING LIST
   ============================================================ */
.mapping-list {
    margin-bottom: 10px;
}

.mapping-item {
    display: flex;
    align-items: center;
    padding: 8px 10px;
    background: var(--bg-primary);
    border-radius: var(--radius);
    margin-bottom: 6px;
}

.mapping-source {
    flex: 1;
    font-weight: 500;
}

.mapping-arrow {
    color: var(--text-muted);
    margin: 0 8px;
}

.mapping-workbook {
    flex: 1;
    color: var(--text-secondary);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ============================================================
   FOOTER
   ============================================================ */
.footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
    font-size: 11px;
}

.queue-status {
    color: var(--text-secondary);
}

.separator {
    margin: 0 8px;
    color: var(--text-muted);
}

/* ============================================================
   MODAL
   ============================================================ */
.modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal.hidden {
    display: none;
}

.modal-content {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    width: 90%;
    max-width: 350px;
    box-shadow: var(--shadow);
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
    font-size: 16px;
    font-weight: 600;
}

.modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 20px;
    cursor: pointer;
}

.modal-close:hover {
    color: var(--text-primary);
}

.modal-body {
    padding: 16px;
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border-color);
}

.form-group {
    margin-bottom: 12px;
}

.form-group:last-child {
    margin-bottom: 0;
}

.form-row {
    display: flex;
    gap: 12px;
}

.form-row .form-group {
    flex: 1;
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */
.toast-container {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 2000;
}

.toast {
    padding: 10px 16px;
    background: var(--bg-tertiary);
    border-radius: var(--radius);
    margin-top: 8px;
    box-shadow: var(--shadow);
    animation: slideIn 0.3s ease;
    max-width: 300px;
}

.toast.success {
    border-left: 3px solid var(--accent-green);
}

.toast.error {
    border-left: 3px solid var(--accent-red);
}

.toast.info {
    border-left: 3px solid var(--accent-blue);
}

@keyframes slideIn {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

/* ============================================================
   UTILITIES
   ============================================================ */
.hidden {
    display: none !important;
}

.text-muted {
    color: var(--text-muted);
}

.text-success {
    color: var(--accent-green);
}

.text-error {
    color: var(--accent-red);
}

.mt-2 {
    margin-top: 8px;
}

.mb-2 {
    margin-bottom: 8px;
}

/* Scrollbar */
::-webkit-scrollbar {
    width: 6px;
}

::-webkit-scrollbar-track {
    background: var(--bg-primary);
}

::-webkit-scrollbar-thumb {
    background: var(--bg-tertiary);
    border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
    background: #555;
}
```

### Task 6.3: Create popup/popup.js

**Cursor Prompt:**
```
Create popup/popup.js with all event handlers and message passing for the popup UI.
```

**Expected Output:**
```javascript
// popup/popup.js - Popup UI Controller

const LOG = '[POPUP]';

// ============================================================
// DOM ELEMENTS (cached on load)
// ============================================================
const elements = {};

// ============================================================
// STATE
// ============================================================
let state = {
    inputSheetId: null,
    inputSheetTitle: null,
    searches: [],
    workbooks: [],
    sourceMapping: {},
    schedules: [],
    isScrapingActive: false
};

// ============================================================
// UTILITIES
// ============================================================

/**
 * Send message to service worker
 */
async function sendMessage(action, data = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action, ...data }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`${LOG} Message error:`, chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response && !response.success && response.error) {
                reject(new Error(response.error));
            } else {
                resolve(response || { success: true });
            }
        });
    });
}

/**
 * Send message to content script
 */
async function sendTabMessage(tabId, message, timeout = 1000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeout);
        
        chrome.tabs.sendMessage(tabId, message, (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
                console.log(`${LOG} Tab message failed:`, chrome.runtime.lastError.message);
                resolve(null);
            } else {
                resolve(response);
            }
        });
    });
}

/**
 * Parse Google Sheet URL to extract ID
 */
function parseGoogleSheetUrl(input) {
    if (!input) return null;
    
    // Already an ID (no slashes)
    if (!input.includes('/')) {
        return input.trim();
    }
    
    // URL format: https://docs.google.com/spreadsheets/d/{ID}/...
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

/**
 * Format date for display
 */
function formatDate(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

/**
 * Format duration
 */
function formatDuration(ms) {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const container = elements.toastContainer;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

/**
 * Toggle section collapse
 */
function toggleSection(sectionId) {
    const section = document.getElementById(`section-${sectionId}`);
    if (section) {
        section.classList.toggle('collapsed');
    }
}

/**
 * Set button loading state
 */
function setButtonLoading(btn, loading) {
    if (loading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = '...';
    } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || btn.textContent;
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log(`${LOG} Initializing popup...`);
    
    // Cache DOM elements
    cacheElements();
    
    // Setup event listeners
    setupEventListeners();
    
    // Load initial data
    await loadInitialData();
    
    // Populate hour dropdown
    populateHourDropdown();
    
    console.log(`${LOG} Popup initialized`);
});

function cacheElements() {
    // Input Sheet
    elements.inputSheetUrl = document.getElementById('input-sheet-url');
    elements.loadSheetBtn = document.getElementById('load-sheet-btn');
    elements.inputSheetInfo = document.getElementById('input-sheet-info');
    elements.inputSheetLink = document.getElementById('input-sheet-link');
    elements.searchCount = document.getElementById('search-count');
    
    // Mappings
    elements.mappingList = document.getElementById('mapping-list');
    elements.addWorkbookBtn = document.getElementById('add-workbook-btn');
    
    // Scraping
    elements.sourceSelect = document.getElementById('source-select');
    elements.startScrapeBtn = document.getElementById('start-scrape-btn');
    elements.stopScrapeBtn = document.getElementById('stop-scrape-btn');
    elements.scrapeProgress = document.getElementById('scrape-progress');
    elements.progressFill = document.getElementById('progress-fill');
    elements.progressText = document.getElementById('progress-text');
    
    // Compare
    elements.compareWorkbookSelect = document.getElementById('compare-workbook-select');
    elements.compareTab1 = document.getElementById('compare-tab1');
    elements.compareTab2 = document.getElementById('compare-tab2');
    elements.compareOutputName = document.getElementById('compare-output-name');
    elements.compareKeyColumn = document.getElementById('compare-key-column');
    elements.compareTabsBtn = document.getElementById('compare-tabs-btn');
    elements.compareResults = document.getElementById('compare-results');
    
    // Schedules
    elements.scheduleList = document.getElementById('schedule-list');
    elements.addScheduleBtn = document.getElementById('add-schedule-btn');
    elements.nextRunInfo = document.getElementById('next-run-info');
    
    // History
    elements.historyTbody = document.getElementById('history-tbody');
    
    // Settings
    elements.webhookUrl = document.getElementById('webhook-url');
    elements.saveWebhookBtn = document.getElementById('save-webhook-btn');
    elements.testWebhookBtn = document.getElementById('test-webhook-btn');
    elements.webhookStatus = document.getElementById('webhook-status');
    
    // Footer
    elements.queuePending = document.getElementById('queue-pending');
    elements.queueFailed = document.getElementById('queue-failed');
    elements.queueFailedContainer = document.getElementById('queue-failed-container');
    elements.retryFailedBtn = document.getElementById('retry-failed-btn');
    elements.deduplicateBtn = document.getElementById('deduplicate-btn');
    
    // Modals
    elements.scheduleModal = document.getElementById('schedule-modal');
    elements.modalCloseBtn = document.getElementById('modal-close-btn');
    elements.scheduleSourceSelect = document.getElementById('schedule-source-select');
    elements.scheduleDaySelect = document.getElementById('schedule-day-select');
    elements.scheduleHourSelect = document.getElementById('schedule-hour-select');
    elements.scheduleMinuteSelect = document.getElementById('schedule-minute-select');
    elements.cancelScheduleBtn = document.getElementById('cancel-schedule-btn');
    elements.saveScheduleBtn = document.getElementById('save-schedule-btn');
    
    elements.workbookModal = document.getElementById('workbook-modal');
    elements.workbookModalCloseBtn = document.getElementById('workbook-modal-close-btn');
    elements.newWorkbookUrl = document.getElementById('new-workbook-url');
    elements.newWorkbookSource = document.getElementById('new-workbook-source');
    elements.cancelWorkbookBtn = document.getElementById('cancel-workbook-btn');
    elements.confirmWorkbookBtn = document.getElementById('confirm-workbook-btn');
    
    // Toast container
    elements.toastContainer = document.getElementById('toast-container');
    
    // Status indicator
    elements.statusIndicator = document.getElementById('status-indicator');
}

function populateHourDropdown() {
    const select = elements.scheduleHourSelect;
    for (let i = 0; i < 24; i++) {
        const option = document.createElement('option');
        option.value = i;
        const hour = i % 12 || 12;
        const ampm = i < 12 ? 'AM' : 'PM';
        option.textContent = `${hour} ${ampm}`;
        select.appendChild(option);
    }
}

async function loadInitialData() {
    try {
        // Load searches
        const searchResult = await sendMessage('GET_SEARCHES').catch(() => ({ searches: [] }));
        state.searches = searchResult.searches || [];
        
        // Load workbooks
        const workbookResult = await sendMessage('GET_WORKBOOKS');
        state.workbooks = workbookResult.workbooks || [];
        
        // Load source mapping
        const mappingResult = await sendMessage('GET_SOURCE_MAPPING');
        state.sourceMapping = mappingResult.mapping || {};
        
        // Load schedules
        const scheduleResult = await sendMessage('GET_SCHEDULES');
        state.schedules = scheduleResult.schedules || [];
        
        // Load queue status
        await loadQueueStatus();
        
        // Load execution history
        await loadExecutionHistory();
        
        // Render UI
        renderSourceDropdown();
        renderWorkbookMappings();
        renderScheduleList();
        renderWorkbookDropdowns();
        
        // Update search count
        if (state.searches.length > 0) {
            elements.inputSheetInfo.classList.remove('hidden');
            elements.searchCount.textContent = `${state.searches.length} searches loaded`;
        }
        
    } catch (error) {
        console.error(`${LOG} Error loading data:`, error);
        showToast('Error loading data', 'error');
    }
}

// ============================================================
// EVENT LISTENERS SETUP
// ============================================================

function setupEventListeners() {
    // Section toggles
    document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', () => {
            const sectionId = header.dataset.section;
            toggleSection(sectionId);
        });
    });
    
    // Input Sheet
    elements.loadSheetBtn.addEventListener('click', loadInputSheet);
    
    // Workbooks
    elements.addWorkbookBtn.addEventListener('click', openWorkbookModal);
    elements.workbookModalCloseBtn.addEventListener('click', closeWorkbookModal);
    elements.cancelWorkbookBtn.addEventListener('click', closeWorkbookModal);
    elements.confirmWorkbookBtn.addEventListener('click', addWorkbook);
    
    // Scraping
    elements.startScrapeBtn.addEventListener('click', startScrape);
    elements.stopScrapeBtn.addEventListener('click', stopScrape);
    
    // Compare
    elements.compareWorkbookSelect.addEventListener('change', loadTabsForCompare);
    elements.compareTabsBtn.addEventListener('click', compareTabs);
    
    // Schedules
    elements.addScheduleBtn.addEventListener('click', openScheduleModal);
    elements.modalCloseBtn.addEventListener('click', closeScheduleModal);
    elements.cancelScheduleBtn.addEventListener('click', closeScheduleModal);
    elements.saveScheduleBtn.addEventListener('click', saveSchedule);
    
    // Settings
    elements.saveWebhookBtn.addEventListener('click', saveWebhookUrl);
    elements.testWebhookBtn.addEventListener('click', testWebhook);
    
    // Footer
    elements.retryFailedBtn.addEventListener('click', retryFailed);
    elements.deduplicateBtn.addEventListener('click', deduplicate);
}

// ============================================================
// INPUT SHEET
// ============================================================

async function loadInputSheet() {
    const url = elements.inputSheetUrl.value.trim();
    if (!url) {
        showToast('Please enter a Sheet URL or ID', 'error');
        return;
    }
    
    const sheetId = parseGoogleSheetUrl(url);
    if (!sheetId) {
        showToast('Invalid Sheet URL', 'error');
        return;
    }
    
    setButtonLoading(elements.loadSheetBtn, true);
    
    try {
        const result = await sendMessage('LOAD_INPUT_SHEET', { sheetId });
        
        state.inputSheetId = sheetId;
        state.inputSheetTitle = result.title;
        
        // Load searches
        const searchResult = await sendMessage('GET_SEARCHES');
        state.searches = searchResult.searches || [];
        
        // Update UI
        elements.inputSheetInfo.classList.remove('hidden');
        elements.inputSheetLink.href = `https://docs.google.com/spreadsheets/d/${sheetId}`;
        elements.inputSheetLink.textContent = result.title;
        elements.searchCount.textContent = `${state.searches.length} searches`;
        
        // Update dropdowns
        renderSourceDropdown();
        
        showToast(`Loaded ${state.searches.length} searches`, 'success');
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.loadSheetBtn, false);
    }
}

// ============================================================
// RENDERING FUNCTIONS
// ============================================================

function renderSourceDropdown() {
    const sources = [...new Set(state.searches.map(s => s.source))];
    
    // Main scrape dropdown
    elements.sourceSelect.innerHTML = '<option value="">Select source...</option>';
    sources.forEach(source => {
        const option = document.createElement('option');
        option.value = source;
        option.textContent = source;
        elements.sourceSelect.appendChild(option);
    });
    
    // Schedule modal dropdown
    elements.scheduleSourceSelect.innerHTML = '';
    sources.forEach(source => {
        const option = document.createElement('option');
        option.value = source;
        option.textContent = source;
        elements.scheduleSourceSelect.appendChild(option);
    });
    
    // Workbook modal dropdown
    elements.newWorkbookSource.innerHTML = '<option value="">No mapping</option>';
    sources.forEach(source => {
        const option = document.createElement('option');
        option.value = source;
        option.textContent = source;
        elements.newWorkbookSource.appendChild(option);
    });
}

function renderWorkbookMappings() {
    elements.mappingList.innerHTML = '';
    
    const sources = [...new Set(state.searches.map(s => s.source))];
    
    sources.forEach(source => {
        const workbookId = state.sourceMapping[source];
        const workbook = state.workbooks.find(w => w.id === workbookId);
        
        const item = document.createElement('div');
        item.className = 'mapping-item';
        item.innerHTML = `
            <span class="mapping-source">${source}</span>
            <span class="mapping-arrow">→</span>
            <span class="mapping-workbook">${workbook ? workbook.name : 'Not mapped'}</span>
            <select class="mapping-select" data-source="${source}">
                <option value="">Select workbook...</option>
                ${state.workbooks.map(w => `
                    <option value="${w.id}" ${w.id === workbookId ? 'selected' : ''}>
                        ${w.name}
                    </option>
                `).join('')}
            </select>
        `;
        
        const select = item.querySelector('.mapping-select');
        select.addEventListener('change', (e) => {
            updateSourceMapping(source, e.target.value);
        });
        
        elements.mappingList.appendChild(item);
    });
}

function renderScheduleList() {
    elements.scheduleList.innerHTML = '';
    
    if (state.schedules.length === 0) {
        elements.scheduleList.innerHTML = '<div class="text-muted">No schedules configured</div>';
        return;
    }
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    state.schedules.forEach(schedule => {
        const hour = schedule.hour % 12 || 12;
        const ampm = schedule.hour < 12 ? 'AM' : 'PM';
        const minute = String(schedule.minute).padStart(2, '0');
        
        const item = document.createElement('div');
        item.className = 'schedule-item';
        item.innerHTML = `
            <div class="schedule-info">
                <div class="schedule-source">${schedule.sourceName}</div>
                <div class="schedule-time">${days[schedule.dayOfWeek]} at ${hour}:${minute} ${ampm}</div>
            </div>
            <div class="schedule-actions">
                <label class="toggle-switch">
                    <input type="checkbox" ${schedule.enabled ? 'checked' : ''} data-id="${schedule.id}">
                    <span class="toggle-slider"></span>
                </label>
                <button class="delete-btn" data-id="${schedule.id}">×</button>
            </div>
        `;
        
        item.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
            toggleScheduleEnabled(schedule.id, e.target.checked);
        });
        
        item.querySelector('.delete-btn').addEventListener('click', () => {
            deleteSchedule(schedule.id);
        });
        
        elements.scheduleList.appendChild(item);
    });
    
    // Update next run info
    const nextSchedule = state.schedules
        .filter(s => s.enabled)
        .sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun))[0];
    
    if (nextSchedule) {
        elements.nextRunInfo.innerHTML = `Next: ${nextSchedule.sourceName} at ${formatDate(nextSchedule.nextRun)}`;
    } else {
        elements.nextRunInfo.innerHTML = 'No upcoming runs';
    }
}

function renderWorkbookDropdowns() {
    const options = state.workbooks.map(w => 
        `<option value="${w.id}">${w.name}</option>`
    ).join('');
    
    elements.compareWorkbookSelect.innerHTML = `
        <option value="">Select workbook...</option>
        ${options}
    `;
}

// ============================================================
// WORKBOOK MANAGEMENT
// ============================================================

function openWorkbookModal() {
    elements.newWorkbookUrl.value = '';
    elements.newWorkbookSource.value = '';
    elements.workbookModal.classList.remove('hidden');
}

function closeWorkbookModal() {
    elements.workbookModal.classList.add('hidden');
}

async function addWorkbook() {
    const url = elements.newWorkbookUrl.value.trim();
    const sourceName = elements.newWorkbookSource.value;
    
    if (!url) {
        showToast('Please enter a Sheet URL', 'error');
        return;
    }
    
    const sheetId = parseGoogleSheetUrl(url);
    if (!sheetId) {
        showToast('Invalid Sheet URL', 'error');
        return;
    }
    
    setButtonLoading(elements.confirmWorkbookBtn, true);
    
    try {
        await sendMessage('ADD_WORKBOOK', { sheetId, sourceName });
        
        // Reload workbooks
        const result = await sendMessage('GET_WORKBOOKS');
        state.workbooks = result.workbooks || [];
        
        // Reload mappings if source was specified
        if (sourceName) {
            const mappingResult = await sendMessage('GET_SOURCE_MAPPING');
            state.sourceMapping = mappingResult.mapping || {};
        }
        
        // Update UI
        renderWorkbookMappings();
        renderWorkbookDropdowns();
        closeWorkbookModal();
        
        showToast('Workbook added', 'success');
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.confirmWorkbookBtn, false);
    }
}

async function updateSourceMapping(source, workbookId) {
    try {
        await sendMessage('SET_SOURCE_MAPPING', { sourceName: source, workbookId });
        state.sourceMapping[source] = workbookId;
        showToast(`Mapped ${source}`, 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================================
// SCRAPING
// ============================================================

async function startScrape() {
    const source = elements.sourceSelect.value;
    if (!source) {
        showToast('Please select a source', 'error');
        return;
    }
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url?.includes('linkedin.com')) {
        showToast('Please navigate to LinkedIn first', 'error');
        return;
    }
    
    setButtonLoading(elements.startScrapeBtn, true);
    
    try {
        // Start keep-alive
        await sendMessage('START_KEEPALIVE');
        
        // Send scrape command to content script
        await chrome.tabs.sendMessage(tab.id, {
            action: 'START_SCRAPING',
            sourceName: source
        });
        
        // Update UI
        elements.startScrapeBtn.classList.add('hidden');
        elements.stopScrapeBtn.classList.remove('hidden');
        elements.scrapeProgress.classList.remove('hidden');
        elements.statusIndicator.classList.add('active');
        
        showToast('Scraping started', 'success');
        
    } catch (error) {
        showToast(error.message, 'error');
        await sendMessage('STOP_KEEPALIVE');
    } finally {
        setButtonLoading(elements.startScrapeBtn, false);
    }
}

async function stopScrape() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPING' });
        await sendMessage('STOP_KEEPALIVE');
        
        elements.startScrapeBtn.classList.remove('hidden');
        elements.stopScrapeBtn.classList.add('hidden');
        elements.statusIndicator.classList.remove('active');
        
        showToast('Scraping stopped', 'info');
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================================
// COMPARE TABS
// ============================================================

async function loadTabsForCompare() {
    const workbookId = elements.compareWorkbookSelect.value;
    if (!workbookId) return;
    
    try {
        const result = await sendMessage('GET_TABS', { spreadsheetId: workbookId });
        
        if (result.success && result.tabs) {
            const tabOptions = result.tabs.map(tab => 
                `<option value="${tab.title}">${tab.title}</option>`
            ).join('');
            
            elements.compareTab1.innerHTML = `<option value="">Select...</option>${tabOptions}`;
            elements.compareTab2.innerHTML = `<option value="">Select...</option>${tabOptions}`;
        } else {
            throw new Error('Failed to load tabs');
        }
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function compareTabs() {
    const spreadsheetId = elements.compareWorkbookSelect.value;
    const tab1Name = elements.compareTab1.value;
    const tab2Name = elements.compareTab2.value;
    const outputTabName = elements.compareOutputName.value.trim();
    const keyColumn = parseInt(elements.compareKeyColumn.value);
    
    if (!spreadsheetId || !tab1Name || !tab2Name || !outputTabName) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    setButtonLoading(elements.compareTabsBtn, true);
    
    try {
        const result = await sendMessage('COMPARE_TABS', {
            spreadsheetId,
            tab1Name,
            tab2Name,
            outputTabName,
            keyColumn
        });
        
        if (result.success) {
            elements.compareResults.classList.remove('hidden');
            elements.compareResults.classList.remove('error');
            elements.compareResults.innerHTML = `
                ✅ Found <strong>${result.newEntries}</strong> new entries<br>
                <small>Tab 1: ${result.tab1Count} | Tab 2: ${result.tab2Count}</small>
            `;
            showToast(`Found ${result.newEntries} new entries`, 'success');
        } else {
            throw new Error(result.error);
        }
        
    } catch (error) {
        elements.compareResults.classList.remove('hidden');
        elements.compareResults.classList.add('error');
        elements.compareResults.textContent = error.message;
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.compareTabsBtn, false);
    }
}

// ============================================================
// SCHEDULES
// ============================================================

function openScheduleModal() {
    elements.scheduleModal.classList.remove('hidden');
}

function closeScheduleModal() {
    elements.scheduleModal.classList.add('hidden');
}

async function saveSchedule() {
    const sourceName = elements.scheduleSourceSelect.value;
    const dayOfWeek = parseInt(elements.scheduleDaySelect.value);
    const hour = parseInt(elements.scheduleHourSelect.value);
    const minute = parseInt(elements.scheduleMinuteSelect.value);
    
    if (!sourceName) {
        showToast('Please select a source', 'error');
        return;
    }
    
    setButtonLoading(elements.saveScheduleBtn, true);
    
    try {
        await sendMessage('SET_SCHEDULE', {
            schedule: { sourceName, dayOfWeek, hour, minute, enabled: true }
        });
        
        // Reload schedules
        const result = await sendMessage('GET_SCHEDULES');
        state.schedules = result.schedules || [];
        
        renderScheduleList();
        closeScheduleModal();
        
        showToast('Schedule saved', 'success');
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.saveScheduleBtn, false);
    }
}

async function toggleScheduleEnabled(scheduleId, enabled) {
    try {
        const schedule = state.schedules.find(s => s.id === scheduleId);
        if (schedule) {
            await sendMessage('SET_SCHEDULE', {
                schedule: { ...schedule, enabled }
            });
            schedule.enabled = enabled;
            renderScheduleList();
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteSchedule(scheduleId) {
    if (!confirm('Delete this schedule?')) return;
    
    try {
        await sendMessage('DELETE_SCHEDULE', { scheduleId });
        state.schedules = state.schedules.filter(s => s.id !== scheduleId);
        renderScheduleList();
        showToast('Schedule deleted', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================================
// SETTINGS
// ============================================================

async function saveWebhookUrl() {
    const url = elements.webhookUrl.value.trim();
    
    try {
        await sendMessage('SET_WEBHOOK_URL', { url });
        showToast('Webhook URL saved', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function testWebhook() {
    setButtonLoading(elements.testWebhookBtn, true);
    
    try {
        const result = await sendMessage('TEST_WEBHOOK');
        
        if (result.success) {
            elements.webhookStatus.textContent = '✅ Webhook working';
            elements.webhookStatus.className = 'status-text text-success';
            showToast('Webhook test sent', 'success');
        } else {
            throw new Error(result.error || 'Test failed');
        }
        
    } catch (error) {
        elements.webhookStatus.textContent = '❌ ' + error.message;
        elements.webhookStatus.className = 'status-text text-error';
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.testWebhookBtn, false);
    }
}

// ============================================================
// QUEUE & HISTORY
// ============================================================

async function loadQueueStatus() {
    try {
        const status = await sendMessage('GET_QUEUE_STATUS');
        
        elements.queuePending.textContent = status.pending || 0;
        elements.queueFailed.textContent = status.failed || 0;
        
        if (status.failed > 0) {
            elements.queueFailedContainer.classList.remove('hidden');
        } else {
            elements.queueFailedContainer.classList.add('hidden');
        }
        
    } catch (error) {
        console.error(`${LOG} Error loading queue status:`, error);
    }
}

async function loadExecutionHistory() {
    try {
        const result = await sendMessage('GET_EXECUTION_HISTORY', { limit: 10 });
        const history = result.history || [];
        
        elements.historyTbody.innerHTML = '';
        
        history.forEach(record => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatDate(record.startedAt)}</td>
                <td>${record.sourceName}</td>
                <td><span class="status-badge ${record.status}">${record.status}</span></td>
                <td>${record.profilesScraped || 0}</td>
            `;
            elements.historyTbody.appendChild(row);
        });
        
    } catch (error) {
        console.error(`${LOG} Error loading history:`, error);
    }
}

async function retryFailed() {
    try {
        const result = await sendMessage('RETRY_FAILED');
        showToast(`Retrying ${result.retriedCount} items`, 'info');
        await loadQueueStatus();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deduplicate() {
    // For now, just show a message - would need active workbook context
    showToast('Select a workbook first', 'info');
}

// ============================================================
// MESSAGE LISTENERS
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'AUTO_RUN_PROGRESS':
            if (message.progress) {
                const pct = Math.round(
                    (message.progress.completedSearches / message.progress.totalSearches) * 100
                );
                elements.progressFill.style.width = `${pct}%`;
                elements.progressText.textContent = 
                    `${message.progress.completedSearches}/${message.progress.totalSearches} searches`;
            }
            break;
            
        case 'QUEUE_UPDATED':
            loadQueueStatus();
            break;
            
        case 'SCRAPING_COMPLETE':
            elements.startScrapeBtn.classList.remove('hidden');
            elements.stopScrapeBtn.classList.add('hidden');
            elements.statusIndicator.classList.remove('active');
            loadQueueStatus();
            loadExecutionHistory();
            break;
    }
});
```

### 🧪 Gate Check 6.3
```bash
# Load extension in Chrome
# Click extension icon - popup should open without errors
# Check popup console (right-click icon → Inspect popup):
#   - Should see "[POPUP] Initializing popup..."
#   - Should see "[POPUP] Popup initialized"

# Test each section:
# 1. Load an input sheet URL → Should show search count
# 2. Add a workbook → Modal should open/close
# 3. Open schedule modal → Should show source dropdown
# 4. Check toast notifications appear on actions
```

---

## 🔧 PHASE 7: Testing & Verification

### 7.1: Complete Gate Check Summary

Run these checks after completing all phases:

**Phase 0: OAuth**
```bash
□ Extension loads in chrome://extensions without errors
□ Clicking extension prompts for Google sign-in
□ After sign-in, service worker console shows "[AUTH] Token obtained successfully"
□ No "OAuth2 not granted" errors
```

**Phase 1: Foundation**
```bash
□ manifest.json is valid JSON (no syntax errors)
□ Extension shows "Savvy Pirate" name in chrome://extensions
□ Service worker link is clickable (not "Inactive")
```

**Phase 2: Storage & API**
```javascript
// In service worker console:
□ chrome.runtime.sendMessage({action: 'PING'}, r => console.log(r));
  // Returns: {success: true, status: 'alive'}

□ chrome.runtime.sendMessage({action: 'GET_QUEUE_STATUS'}, r => console.log(r));
  // Returns: {success: true, pending: 0, ...}
```

**Phase 3: Scheduling & Notifications**
```javascript
// In service worker console:
□ chrome.runtime.sendMessage({action: 'GET_SCHEDULES'}, r => console.log(r));
  // Returns: {success: true, schedules: [...]}

□ chrome.alarms.getAll(a => console.log(a.map(x => x.name)));
  // Returns: ['queue-process-alarm', 'schedule-check-alarm']

□ chrome.runtime.sendMessage({action: 'SET_WEBHOOK_URL', url: 'https://hooks.zapier.com/test'}, r => console.log(r));
  // Returns: {success: true}

□ chrome.runtime.sendMessage({action: 'TEST_WEBHOOK'}, r => console.log(r));
  // Returns: {success: true} or {success: false, error: '...'}
  // Check service worker logs for payload validation warnings
```

**Phase 4: Service Worker**
```javascript
// Check all message handlers work:
□ GET_SEARCHES returns searches array
□ GET_WORKBOOKS returns workbooks array
□ GET_SOURCE_MAPPING returns mapping object
□ GET_EXECUTION_HISTORY returns history array
```

**Phase 5: Content Script**
```javascript
// On a LinkedIn search page, in page console:
□ console.log('[CS] should appear in logs')
□ Content script responds to PING:
  chrome.runtime.sendMessage({action: 'PING'}, r => console.log(r));
```

**Phase 6: Popup**
```bash
□ Popup opens without JavaScript errors
□ All sections render correctly
□ Section collapse/expand works
□ Toast notifications appear
□ Modals open and close
```

### 7.2: End-to-End Test Scenarios

**Scenario 1: Manual Scrape**
```
1. Load input sheet with search URLs
2. Add output workbook and map to a source
3. Navigate to LinkedIn and log in
4. Navigate to a search URL from your input sheet
5. Click Start Scrape in popup
6. Verify:
   □ Stop button appears
   □ Progress updates in popup
   □ Data appears in Google Sheet
   □ Correct tab name (MM_DD_YY)
7. Click Stop Scrape
8. Verify scraping stops
```

**Scenario 2: Scheduled Run**
```
1. Add schedule for a source: Today, 2 minutes from now
2. Wait for schedule to trigger (check service worker console)
3. Verify:
   □ "[SCHEDULE] ✅ Schedule triggered" appears in logs
   □ Execution history shows "running" status
   □ After completion, shows "completed" status
   □ Webhook notification received (if configured)
```

**Scenario 3: Compare Tabs**
```
1. Have a workbook with two date tabs (e.g., 12_15_25 and 12_16_25)
2. Select workbook in Compare Tabs section
3. Select baseline tab (older) and compare tab (newer)
4. Enter output tab name (e.g., "New_12_16")
5. Click Compare Tabs
6. Verify:
   □ Success message shows new entry count
   □ New tab created in Google Sheet
   □ New tab contains only differential rows
```

**Scenario 4: Error Recovery**
```
1. Start scrape, then close popup mid-scrape
2. Reopen popup
3. Verify:
   □ Scraping continues (check service worker logs)
   □ Data is not lost (queue persists)
4. Disconnect internet briefly
5. Reconnect
6. Verify:
   □ Queue retries failed items
   □ Data eventually syncs
```

### 7.3: Debugging Commands

**View All Storage:**
```javascript
chrome.storage.local.get(null, data => console.table(data));
```

**Clear All Storage (CAUTION):**
```javascript
chrome.storage.local.clear(() => console.log('Storage cleared'));
```

**Check Active Alarms:**
```javascript
chrome.alarms.getAll(alarms => {
    console.log('Active alarms:', alarms.map(a => ({
        name: a.name,
        next: new Date(a.scheduledTime).toLocaleString()
    })));
});
```

**Force Queue Processing:**
```javascript
chrome.runtime.sendMessage({action: 'GET_QUEUE_STATUS'}, console.log);
```

**Test Content Script Injection:**
```javascript
// On LinkedIn page
chrome.runtime.sendMessage({action: 'PING'}, r => console.log('CS alive:', r));
```

### 7.4: Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "OAuth2 not granted" | Extension ID mismatch | Verify Extension ID in Google Console |
| Service worker "Inactive" | No activity | Click extension icon to wake it |
| Scraping finds 0 profiles | Selector changes | Run diagnostic script, update selectors |
| Data not in Sheet | Queue failed | Check queue status, retry failed items |
| Schedule doesn't trigger | Time mismatch | Check timezone (should be Eastern) |
| Popup blank | JS error | Right-click icon → Inspect popup |

---

## 📊 Data Structures Reference

### Input Sheet Format (Google Sheet)
```
Column A: Source Connection (e.g., "Jeff Nash")
Column B: Target Job Title (e.g., "Financial Advisor")
Column C: LinkedIn Search URL
```

### Output Sheet Format (Google Sheet)
```
Column A: Date (YYYY-MM-DD)
Column B: Name
Column C: Title
Column D: Location
Column E: Connection Source
Column F: LinkedIn URL
Column G-L: Accreditation 1-6
```

### Schedule Object (chrome.storage.local)
```javascript
{
    id: "uuid",
    sourceName: "Jeff Nash",
    dayOfWeek: 1,  // Monday
    hour: 2,       // 2 AM
    minute: 0,
    enabled: true,
    lastRun: "2024-12-16T02:00:00.000Z",
    nextRun: "2024-12-23T02:00:00.000Z",
    createdAt: "2024-12-10T...",
    updatedAt: "2024-12-16T..."
}
```

### Execution Record (chrome.storage.local)
```javascript
{
    id: "uuid",
    scheduleId: "schedule-uuid",
    sourceName: "Jeff Nash",
    startedAt: "2024-12-16T02:00:00.000Z",
    completedAt: "2024-12-16T02:45:00.000Z",
    status: "completed",  // running, completed, failed, aborted
    searchesCompleted: 9,
    totalSearches: 9,
    profilesScraped: 147,
    error: null
}
```

### Webhook Payload (to Zapier)
```javascript
{
    type: "schedule_completed",
    timestamp: "2024-12-16T02:45:00.000Z",
    source: "Savvy Pirate v2.0",
    data: {
        sourceName: "Jeff Nash",
        message: "✅ Scheduled scrape completed for Jeff Nash: 147 profiles scraped",
        profilesScraped: 147,
        searchesCompleted: 9,
        totalSearches: 9
    }
}
```

---

## 🚨 Critical Implementation Notes

### 1. Service Worker Keep-Alive
```javascript
// MUST keep service worker alive during long operations
// Use chrome.alarms (not setInterval) for reliability
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // 24 seconds
```

### 2. Message Handler Pattern
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            // Handle message
            sendResponse({ success: true, data: result });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true; // CRITICAL: Keep channel open for async
});
```

### 3. Content Script Communication
```javascript
// Always check for lastError
chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
        console.warn('Message error:', chrome.runtime.lastError.message);
        return;
    }
    // Handle response
});
```

### 4. Tab Name Formatting
```javascript
// Tab names with special chars need quoting for Sheets API
function formatTabNameForRange(tabName) {
    if (/[ _\-']/.test(tabName)) {
        return `'${tabName.replace(/'/g, "''")}'`;
    }
    return tabName;
}
```

### 5. Eastern Time for Tab Names
```javascript
function getTodayTabName() {
    const now = new Date();
    const eastern = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const month = String(eastern.getMonth() + 1).padStart(2, '0');
    const day = String(eastern.getDate()).padStart(2, '0');
    const year = String(eastern.getFullYear()).slice(-2);
    return `${month}_${day}_${year}`;
}
```

---

## 📝 Cursor Execution Order

Execute prompts in this order, running gate checks after each phase:

| Phase | Tasks | Gate Check |
|-------|-------|------------|
| **Phase 0** | Google Cloud setup, OAuth configuration | Token obtained |
| **Phase 1** | manifest.json, constants.js | Extension loads |
| **Phase 2** | auth.js, sync_queue.js, sheets_api.js | PING returns alive |
| **Phase 3** | scheduler.js, notifications.js | Alarms created |
| **Phase 4** | service_worker.js | All messages handled |
| **Phase 5** | content.js | CS responds on LinkedIn |
| **Phase 6** | popup.html, popup.css, popup.js | UI renders correctly |
| **Phase 7** | Testing & verification | End-to-end scenarios pass |

### Execution Tips for Cursor.ai

1. **Copy the Agent Context** at the start of each session
2. **Execute one task at a time** - don't combine multiple files
3. **Run gate checks** before proceeding to next phase
4. **If errors occur**, fix them before moving on
5. **Save frequently** - use git commits after each phase

### Recovery from Errors

If Cursor generates code that doesn't work:
1. Check the service worker console for errors
2. Compare generated code against Expected Output
3. Ask Cursor to fix specific errors with clear context
4. Don't skip gate checks - they prevent cascading failures

---

## 🔍 APPENDIX: LinkedIn DOM Diagnostic & Selector Maintenance

### When Selectors Break

LinkedIn frequently changes their DOM structure. When scraping stops working:

1. **Run the diagnostic script** (in browser console on a LinkedIn search page)
2. **Identify new working selectors** from the output
3. **Update SELECTORS object** in content.js

### Diagnostic Script

Save this as `linkedin-diagnostic.js` for future use:

```javascript
/**
 * LinkedIn DOM Structure Diagnostic Script
 * Run in browser console on a LinkedIn People search results page.
 */
(function() {
    'use strict';
    
    console.log('🔍 LinkedIn DOM Structure Diagnostic Tool');
    console.log('==========================================\n');
    
    // Find cards via profile links (more stable than container selector)
    const nameLinks = document.querySelectorAll('a[data-view-name="search-result-lockup-title"]');
    console.log(`Found ${nameLinks.length} profile cards\n`);
    
    if (nameLinks.length === 0) {
        console.error('❌ No profiles found. Are you on a LinkedIn People search page?');
        return;
    }
    
    // Analyze first 3 cards
    const cardsToAnalyze = Math.min(3, nameLinks.length);
    
    for (let i = 0; i < cardsToAnalyze; i++) {
        const nameLink = nameLinks[i];
        console.log(`\n--- Card ${i + 1} ---`);
        console.log(`Name: ${nameLink.innerText?.trim()}`);
        
        // Find card container
        let card = nameLink;
        for (let j = 0; j < 6; j++) {
            card = card.parentElement;
        }
        
        // Get all p tags
        const allPTags = Array.from(card.querySelectorAll('p'));
        const dataPTags = allPTags.filter(p => {
            const text = p.innerText?.trim() || '';
            return !text.includes('mutual') && 
                   !text.includes('• 1st') && 
                   !text.includes('• 2nd') &&
                   text.length > 3 && text.length < 200;
        });
        
        console.log(`Data p tags: ${dataPTags.length}`);
        dataPTags.forEach((p, idx) => {
            const parent = p.parentElement;
            const parentClasses = Array.from(parent?.classList || []).join(' ');
            console.log(`  Tag ${idx + 1}: "${p.innerText?.trim().substring(0, 60)}"`);
            console.log(`    Parent classes: ${parentClasses}`);
        });
    }
    
    // Test current selectors
    console.log('\n🧪 SELECTOR TESTS');
    const card = nameLinks[0]?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
    
    const tests = {
        'Title (acd09c55)': card?.querySelector('div.acd09c55 > p')?.innerText,
        'Location (bb0216de)': card?.querySelector('div.bb0216de > p')?.innerText,
        'Next Button': document.querySelector('button[data-testid="pagination-controls-next-button-visible"]')?.innerText
    };
    
    Object.entries(tests).forEach(([name, value]) => {
        console.log(`${value ? '✅' : '❌'} ${name}: ${value || 'NOT FOUND'}`);
    });
    
    // Find unique parent classes for title vs location
    console.log('\n💡 CURRENT STRUCTURE ANALYSIS (December 2024)');
    const firstCard = nameLinks[0];
    let container = firstCard;
    for (let j = 0; j < 6; j++) container = container.parentElement;
    
    const pTags = Array.from(container.querySelectorAll('p')).filter(p => {
        const text = p.innerText?.trim() || '';
        return !text.includes('mutual') && !text.includes('•') && text.length > 3;
    });
    
    if (pTags.length >= 2) {
        const titleParent = pTags[0].parentElement?.classList;
        const locationParent = pTags[1].parentElement?.classList;
        
        const titleClasses = Array.from(titleParent || []);
        const locationClasses = Array.from(locationParent || []);
        
        // Check for the KEY DIFFERENTIATOR (.a7293f27 class)
        const hasA7293f27Title = titleClasses.includes('a7293f27');
        const hasA7293f27Location = locationClasses.includes('a7293f27');
        const hasD395caa1Title = titleClasses.includes('d395caa1');
        const hasD395caa1Location = locationClasses.includes('d395caa1');
        
        console.log(`\n✅ CURRENT STRUCTURE (December 2024):`);
        console.log(`Title parent has d395caa1: ${hasD395caa1Title}`);
        console.log(`Title parent has a7293f27: ${hasA7293f27Title} (should be FALSE)`);
        console.log(`Location parent has d395caa1: ${hasD395caa1Location}`);
        console.log(`Location parent has a7293f27: ${hasA7293f27Location} (should be TRUE)`);
        
        console.log(`\n📝 RECOMMENDED SELECTORS:`);
        if (hasD395caa1Title && !hasA7293f27Title && hasD395caa1Location && hasA7293f27Location) {
            console.log(`✅ Title: div.d395caa1:not(.a7293f27) > p`);
            console.log(`✅ Location: div.d395caa1.a7293f27 > p`);
        } else {
            const titleUnique = titleClasses.filter(c => !locationClasses.includes(c));
            const locationUnique = locationClasses.filter(c => !titleClasses.includes(c));
            console.log(`Title unique class: ${titleUnique[0] || 'none'} → div.${titleUnique[0]} > p`);
            console.log(`Location unique class: ${locationUnique[0] || 'none'} → div.${locationUnique[0]} > p`);
        }
    }
})();
```

### Current Selector Status (December 2024)

| Element | Primary Selector | Status | Fallbacks |
|---------|------------------|--------|-----------|
| Card Container | `div[data-view-name="people-search-result"]` | ⚠️ VARIABLE | Use name links as anchor |
| Name Link | `a[data-view-name="search-result-lockup-title"]` | ✅ WORKS | - |
| Title | `div.d395caa1:not(.a7293f27) > p` | ✅ PRIMARY | `div.d395caa1:first-of-type > p`, `div.acd09c55 > p` |
| Location | `div.d395caa1.a7293f27 > p` | ✅ PRIMARY | `div.d395caa1:nth-of-type(2) > p`, `div.bb0216de > p` |
| Next Button | `button[data-testid="pagination-controls-next-button-visible"]` | ✅ WORKS | `button[aria-label="Next"]` |

**Note:** The `.a7293f27` class is the key differentiator - location has it, title doesn't.

### Selector Update Checklist

When LinkedIn breaks selectors:

1. [ ] Run diagnostic script on live search page
2. [ ] Identify new unique parent classes for title/location
3. [ ] Update `SELECTORS` object in content.js
4. [ ] Test on multiple search results
5. [ ] Verify accreditations still parse correctly
6. [ ] Test pagination still works

---

**End of Build Guide**
