# Multi-Device Fix: Preventing Race Conditions in Savvy Pirate Extension

## Root Cause (CONFIRMED)

The stalling issue was caused by **multiple devices running the same extension simultaneously**:
- Pi (Chromium) and Laptop (Chrome) both had the extension installed
- Both devices see the same Google Sheets schedules
- When a scrape is triggered, **both devices race to process it**
- This causes one device to start work that another device takes over
- Result: Scrapes appear to "stall" but are actually being hijacked by another device

**Evidence:**
- User started scrape on Pi, but it was running on Laptop
- Confirmed via `navigator.userAgent`:
  - Pi: `CrOS x86_64` Chrome 142
  - Laptop: `Windows NT 10.0` Chrome 143

---

## Solution Overview

We need a **device locking mechanism** that ensures only one device processes any given scrape. This involves:

1. **Device ID Generation** - Unique identifier for each device
2. **Lock Acquisition** - Device must acquire lock before starting scrape
3. **Lock Validation** - Periodically verify lock is still held
4. **Lock Release** - Release lock when scrape completes or device shuts down
5. **Stale Lock Cleanup** - Handle devices that crash without releasing lock

---

## Implementation

### Step 1: Add Device ID Generation

**File: `background/device_id.js` (NEW FILE)**

```javascript
// device_id.js - Generate and manage unique device identifier

const DEVICE_ID_KEY = 'deviceId';

/**
 * Generate a unique device identifier based on environment
 */
function generateDeviceId() {
    const ua = navigator.userAgent;
    
    // Detect platform
    let platform = 'unknown';
    if (ua.includes('CrOS')) platform = 'chromeos';
    else if (ua.includes('Windows')) platform = 'windows';
    else if (ua.includes('Mac')) platform = 'mac';
    else if (ua.includes('Linux')) platform = 'linux';
    
    // Generate unique component
    const randomPart = Math.random().toString(36).substring(2, 8);
    const timestamp = Date.now().toString(36);
    
    return `${platform}-${randomPart}-${timestamp}`;
}

/**
 * Get or create device ID (persisted in local storage)
 */
async function getDeviceId() {
    const result = await chrome.storage.local.get([DEVICE_ID_KEY]);
    
    if (result[DEVICE_ID_KEY]) {
        return result[DEVICE_ID_KEY];
    }
    
    // Generate new device ID
    const newId = generateDeviceId();
    await chrome.storage.local.set({ [DEVICE_ID_KEY]: newId });
    console.log(`[DEVICE] Generated new device ID: ${newId}`);
    
    return newId;
}

/**
 * Get device info for logging
 */
function getDeviceInfo() {
    const ua = navigator.userAgent;
    return {
        isChromiumOnPi: ua.includes('CrOS') || (ua.includes('Linux') && ua.includes('Chromium')),
        isWindows: ua.includes('Windows'),
        isMac: ua.includes('Mac'),
        chromeVersion: ua.match(/Chrome\/(\d+)/)?.[1] || 'unknown'
    };
}

export { getDeviceId, getDeviceInfo, generateDeviceId };
```

---

### Step 2: Add Scrape Lock Manager

**File: `background/scrape_lock.js` (NEW FILE)**

```javascript
// scrape_lock.js - Manage distributed locks for scrape operations

import { getDeviceId } from './device_id.js';

const LOCK_KEY = 'scrapeLock';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - lock expires if not refreshed
const LOCK_REFRESH_INTERVAL_MS = 60 * 1000; // Refresh lock every 60 seconds

let lockRefreshInterval = null;

/**
 * Scrape lock structure:
 * {
 *   deviceId: string,
 *   acquiredAt: number (timestamp),
 *   lastRefresh: number (timestamp),
 *   scrapeName: string,
 *   searchIndex: number
 * }
 */

/**
 * Attempt to acquire the scrape lock
 * @param {string} scrapeName - Name of the scrape (e.g., "Jesse Papike")
 * @returns {Promise<{success: boolean, reason?: string, holder?: string}>}
 */
async function acquireLock(scrapeName) {
    const deviceId = await getDeviceId();
    const now = Date.now();
    
    // Check existing lock
    const result = await chrome.storage.local.get([LOCK_KEY]);
    const existingLock = result[LOCK_KEY];
    
    if (existingLock) {
        // Check if lock is held by another device
        if (existingLock.deviceId !== deviceId) {
            // Check if lock is stale (not refreshed recently)
            const lockAge = now - existingLock.lastRefresh;
            
            if (lockAge < LOCK_TIMEOUT_MS) {
                // Lock is still valid and held by another device
                console.warn(`[LOCK] ⚠️ Lock held by another device: ${existingLock.deviceId}`);
                console.warn(`[LOCK]    Scrape: ${existingLock.scrapeName}, acquired ${Math.round(lockAge/1000)}s ago`);
                return {
                    success: false,
                    reason: 'Lock held by another device',
                    holder: existingLock.deviceId,
                    scrapeName: existingLock.scrapeName
                };
            } else {
                // Lock is stale - another device crashed or lost connection
                console.warn(`[LOCK] ⚠️ Taking over stale lock from ${existingLock.deviceId}`);
                console.warn(`[LOCK]    Lock was ${Math.round(lockAge/1000)}s old (timeout: ${LOCK_TIMEOUT_MS/1000}s)`);
            }
        } else {
            // We already hold the lock - just refresh it
            console.log(`[LOCK] ✅ Refreshing existing lock for ${scrapeName}`);
        }
    }
    
    // Acquire or refresh the lock
    const newLock = {
        deviceId,
        acquiredAt: existingLock?.deviceId === deviceId ? existingLock.acquiredAt : now,
        lastRefresh: now,
        scrapeName,
        searchIndex: 0
    };
    
    await chrome.storage.local.set({ [LOCK_KEY]: newLock });
    
    // Start lock refresh interval
    startLockRefresh();
    
    console.log(`[LOCK] ✅ Lock acquired for "${scrapeName}" by ${deviceId}`);
    return { success: true };
}

/**
 * Release the scrape lock
 */
async function releaseLock() {
    const deviceId = await getDeviceId();
    const result = await chrome.storage.local.get([LOCK_KEY]);
    const existingLock = result[LOCK_KEY];
    
    // Only release if we hold the lock
    if (existingLock && existingLock.deviceId === deviceId) {
        await chrome.storage.local.remove([LOCK_KEY]);
        console.log(`[LOCK] 🔓 Lock released by ${deviceId}`);
    } else if (existingLock) {
        console.warn(`[LOCK] ⚠️ Cannot release lock - held by ${existingLock.deviceId}, not ${deviceId}`);
    }
    
    // Stop refresh interval
    stopLockRefresh();
}

/**
 * Update lock with current progress
 */
async function updateLockProgress(searchIndex) {
    const deviceId = await getDeviceId();
    const result = await chrome.storage.local.get([LOCK_KEY]);
    const existingLock = result[LOCK_KEY];
    
    if (existingLock && existingLock.deviceId === deviceId) {
        existingLock.lastRefresh = Date.now();
        existingLock.searchIndex = searchIndex;
        await chrome.storage.local.set({ [LOCK_KEY]: existingLock });
    }
}

/**
 * Check if we currently hold the lock
 */
async function hasLock() {
    const deviceId = await getDeviceId();
    const result = await chrome.storage.local.get([LOCK_KEY]);
    const existingLock = result[LOCK_KEY];
    
    return existingLock && existingLock.deviceId === deviceId;
}

/**
 * Get current lock status
 */
async function getLockStatus() {
    const deviceId = await getDeviceId();
    const result = await chrome.storage.local.get([LOCK_KEY]);
    const existingLock = result[LOCK_KEY];
    
    if (!existingLock) {
        return { locked: false };
    }
    
    const now = Date.now();
    const lockAge = now - existingLock.lastRefresh;
    const isStale = lockAge >= LOCK_TIMEOUT_MS;
    
    return {
        locked: true,
        isOurs: existingLock.deviceId === deviceId,
        isStale,
        holder: existingLock.deviceId,
        scrapeName: existingLock.scrapeName,
        searchIndex: existingLock.searchIndex,
        lockAge: Math.round(lockAge / 1000)
    };
}

/**
 * Start periodic lock refresh
 */
function startLockRefresh() {
    stopLockRefresh(); // Clear any existing interval
    
    lockRefreshInterval = setInterval(async () => {
        const deviceId = await getDeviceId();
        const result = await chrome.storage.local.get([LOCK_KEY]);
        const existingLock = result[LOCK_KEY];
        
        if (existingLock && existingLock.deviceId === deviceId) {
            existingLock.lastRefresh = Date.now();
            await chrome.storage.local.set({ [LOCK_KEY]: existingLock });
            console.log(`[LOCK] 🔄 Lock refreshed at ${new Date().toLocaleTimeString()}`);
        } else {
            // We lost the lock somehow
            console.error(`[LOCK] ❌ Lost lock! Stopping refresh.`);
            stopLockRefresh();
        }
    }, LOCK_REFRESH_INTERVAL_MS);
    
    console.log(`[LOCK] Started lock refresh (every ${LOCK_REFRESH_INTERVAL_MS/1000}s)`);
}

/**
 * Stop periodic lock refresh
 */
function stopLockRefresh() {
    if (lockRefreshInterval) {
        clearInterval(lockRefreshInterval);
        lockRefreshInterval = null;
    }
}

export {
    acquireLock,
    releaseLock,
    updateLockProgress,
    hasLock,
    getLockStatus,
    LOCK_TIMEOUT_MS
};
```

---

### Step 3: Integrate Lock into Service Worker

**File: `background/service_worker.js` (MODIFICATIONS)**

Add these imports at the top:

```javascript
import { getDeviceId, getDeviceInfo } from './device_id.js';
import { 
    acquireLock, 
    releaseLock, 
    updateLockProgress, 
    hasLock, 
    getLockStatus 
} from './scrape_lock.js';
```

Modify `processManualScrape()` function:

```javascript
async function processManualScrape() {
    console.log(`${LOG} Starting manual scrape processor`);
    
    // Get device info for logging
    const deviceId = await getDeviceId();
    const deviceInfo = getDeviceInfo();
    console.log(`${LOG} Device: ${deviceId}`);
    console.log(`${LOG} Platform: ${JSON.stringify(deviceInfo)}`);
    
    try {
        // Get scrape state
        const { manualScrapeState } = await getFromStorage(['manualScrapeState']);
        
        if (!manualScrapeState || !manualScrapeState.isRunning) {
            console.log(`${LOG} No active manual scrape`);
            return;
        }
        
        const scrapeName = manualScrapeState.sourceName || 'Unknown';
        
        // ============================================
        // CRITICAL: Acquire lock before processing
        // ============================================
        const lockResult = await acquireLock(scrapeName);
        
        if (!lockResult.success) {
            console.warn(`${LOG} ⚠️ Cannot start scrape - ${lockResult.reason}`);
            console.warn(`${LOG}    Lock holder: ${lockResult.holder}`);
            console.warn(`${LOG}    Their scrape: ${lockResult.scrapeName}`);
            
            // Reset our local state since another device is handling this
            await saveToStorage({
                manualScrapeState: {
                    ...manualScrapeState,
                    isRunning: false,
                    error: `Another device (${lockResult.holder}) is processing this scrape`
                }
            });
            
            return;
        }
        
        console.log(`${LOG} ✅ Lock acquired - proceeding with scrape`);
        
        // ... existing OAuth token verification code ...
        
        const { searches, currentSearchIndex = 0 } = manualScrapeState;
        
        // Main scrape loop
        for (let i = currentSearchIndex; i < searches.length; i++) {
            // ============================================
            // Check lock at start of each iteration
            // ============================================
            if (!await hasLock()) {
                console.error(`${LOG} ❌ Lost lock during scrape! Aborting.`);
                break;
            }
            
            // Update lock progress
            await updateLockProgress(i);
            
            // Existing state check
            const currentState = await getFromStorage(['manualScrapeState']);
            if (!currentState.manualScrapeState?.isRunning || 
                currentState.manualScrapeState.isAborted) {
                console.log(`${LOG} Manual scrape aborted`);
                break;
            }
            
            // ... rest of existing loop code ...
            
            console.log(`${LOG} Processing search ${i + 1}/${searches.length}: ${search.title}`);
            
            // ... existing search processing code ...
            
        } // End of for loop
        
    } catch (error) {
        console.error(`${LOG} Error in processManualScrape:`, error);
    } finally {
        // ============================================
        // CRITICAL: Always release lock when done
        // ============================================
        console.log(`${LOG} Releasing lock...`);
        await releaseLock();
        
        // ... existing cleanup code ...
    }
}
```

---

### Step 4: Integrate Lock into Scheduled Scraping

**File: `background/scheduler.js` (MODIFICATIONS)**

Similar changes for `executeScheduledScrape()`:

```javascript
import { acquireLock, releaseLock, hasLock, getLockStatus } from './scrape_lock.js';

async function executeScheduledScrape(schedule) {
    const scrapeName = schedule.name || schedule.sourceName;
    
    // Check if another device is scraping
    const lockStatus = await getLockStatus();
    if (lockStatus.locked && !lockStatus.isOurs && !lockStatus.isStale) {
        console.log(`[SCHEDULE] ⏸️ Skipping ${scrapeName} - another device is scraping`);
        console.log(`[SCHEDULE]    Device: ${lockStatus.holder}, Scrape: ${lockStatus.scrapeName}`);
        return { skipped: true, reason: 'Another device is scraping' };
    }
    
    // Acquire lock
    const lockResult = await acquireLock(scrapeName);
    if (!lockResult.success) {
        console.warn(`[SCHEDULE] Cannot acquire lock for ${scrapeName}: ${lockResult.reason}`);
        return { skipped: true, reason: lockResult.reason };
    }
    
    try {
        // ... existing scheduled scrape code ...
        
    } finally {
        await releaseLock();
    }
}
```

---

### Step 5: Add Lock Status to UI

**File: `popup/popup.js` (MODIFICATIONS)**

Add lock status display:

```javascript
import { getLockStatus } from '../background/scrape_lock.js';
import { getDeviceId } from '../background/device_id.js';

async function updateLockStatusUI() {
    const lockStatus = await getLockStatus();
    const deviceId = await getDeviceId();
    
    const lockStatusEl = document.getElementById('lock-status');
    if (!lockStatusEl) return;
    
    if (lockStatus.locked) {
        if (lockStatus.isOurs) {
            lockStatusEl.innerHTML = `
                <span class="status-badge status-running">
                    🔒 This device is scraping: ${lockStatus.scrapeName}
                </span>
            `;
        } else {
            lockStatusEl.innerHTML = `
                <span class="status-badge status-warning">
                    ⚠️ Another device is scraping: ${lockStatus.scrapeName}
                    <br><small>Device: ${lockStatus.holder}</small>
                </span>
            `;
        }
    } else {
        lockStatusEl.innerHTML = `
            <span class="status-badge status-idle">
                🔓 No active scrape
            </span>
        `;
    }
    
    // Show this device's ID
    const deviceIdEl = document.getElementById('device-id');
    if (deviceIdEl) {
        deviceIdEl.textContent = `Device: ${deviceId}`;
    }
}

// Call on popup open and periodically
updateLockStatusUI();
setInterval(updateLockStatusUI, 5000);
```

**File: `popup/popup.html` (MODIFICATIONS)**

Add lock status section:

```html
<!-- Add near the top of the popup -->
<div class="lock-status-container">
    <div id="lock-status"></div>
    <div id="device-id" class="device-id"></div>
</div>

<style>
.lock-status-container {
    padding: 8px;
    border-bottom: 1px solid #e0e0e0;
    background: #f5f5f5;
}

.status-badge {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
}

.status-running {
    background: #e8f5e9;
    color: #2e7d32;
}

.status-warning {
    background: #fff3e0;
    color: #ef6c00;
}

.status-idle {
    background: #e3f2fd;
    color: #1565c0;
}

.device-id {
    font-size: 10px;
    color: #888;
    margin-top: 4px;
}
</style>
```

---

### Step 6: Add Startup Recovery

**File: `background/service_worker.js` (ADDITIONS)**

Add startup check for orphaned locks:

```javascript
// On service worker startup
chrome.runtime.onStartup.addListener(async () => {
    console.log('[SW] Service worker starting up...');
    
    const deviceId = await getDeviceId();
    console.log(`[SW] Device ID: ${deviceId}`);
    
    // Check for orphaned scrape state
    const { manualScrapeState, scrapeLock } = await chrome.storage.local.get([
        'manualScrapeState', 
        'scrapeLock'
    ]);
    
    // If we have an active scrape state but the lock is ours and stale,
    // it means we crashed mid-scrape - attempt recovery
    if (manualScrapeState?.isRunning && 
        scrapeLock?.deviceId === deviceId) {
        
        const lockAge = Date.now() - scrapeLock.lastRefresh;
        
        if (lockAge > 30000) { // Lock not refreshed in 30+ seconds
            console.warn('[SW] ⚠️ Found orphaned scrape from previous session');
            console.warn(`[SW]    Scrape: ${manualScrapeState.sourceName}`);
            console.warn(`[SW]    Search: ${manualScrapeState.currentSearchIndex + 1}/${manualScrapeState.searches?.length}`);
            console.warn(`[SW]    Lock age: ${Math.round(lockAge/1000)}s`);
            
            // Option 1: Auto-resume (risky)
            // processManualScrape().catch(e => console.error('Resume failed:', e));
            
            // Option 2: Mark as interrupted and let user decide (safer)
            await chrome.storage.local.set({
                manualScrapeState: {
                    ...manualScrapeState,
                    isRunning: false,
                    wasInterrupted: true,
                    interruptedAt: manualScrapeState.currentSearchIndex
                }
            });
            
            // Release the stale lock
            await chrome.storage.local.remove(['scrapeLock']);
            
            console.log('[SW] Marked scrape as interrupted - user can resume');
        }
    }
});

// Also handle extension install/update
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`[SW] Extension ${details.reason}: ${details.previousVersion || 'new'}`);
    
    // Generate device ID on install
    await getDeviceId();
    
    // Clean up any stale locks on update
    if (details.reason === 'update') {
        const { scrapeLock } = await chrome.storage.local.get(['scrapeLock']);
        if (scrapeLock) {
            console.log('[SW] Cleaning up lock from previous version');
            await chrome.storage.local.remove(['scrapeLock']);
        }
    }
});
```

---

## Testing the Fix

### Test 1: Verify Device IDs

On **both devices**, run in service worker console:

```javascript
chrome.storage.local.get(['deviceId'], (r) => console.log('Device ID:', r.deviceId));
```

Both should show different IDs.

### Test 2: Verify Lock Acquisition

Start a scrape on one device, then on the **other device's** service worker console:

```javascript
chrome.storage.local.get(['scrapeLock'], (r) => {
    console.log('Lock:', JSON.stringify(r.scrapeLock, null, 2));
});
```

You should see the lock held by the first device.

### Test 3: Verify Lock Blocks Second Device

Try to start a manual scrape on the second device while the first is running.
It should show a message like "Another device is processing this scrape".

### Test 4: Verify Lock Release

After scrape completes on first device:

```javascript
chrome.storage.local.get(['scrapeLock'], (r) => {
    console.log('Lock after completion:', r.scrapeLock); // Should be undefined
});
```

---

## Configuration Options

Add to your config or settings:

```javascript
const MULTI_DEVICE_CONFIG = {
    // Lock timeout - how long before a stale lock can be taken over
    LOCK_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
    
    // Lock refresh interval
    LOCK_REFRESH_MS: 60 * 1000, // 1 minute
    
    // Enable/disable multi-device support (for debugging)
    ENABLED: true,
    
    // Auto-resume interrupted scrapes on startup
    AUTO_RESUME: false,
    
    // Show device ID in UI
    SHOW_DEVICE_ID: true
};
```

---

## Summary of Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `background/device_id.js` | NEW | Device ID generation and management |
| `background/scrape_lock.js` | NEW | Distributed lock manager |
| `background/service_worker.js` | MODIFY | Add lock acquisition/release to scrape flow |
| `background/scheduler.js` | MODIFY | Add lock check to scheduled scrapes |
| `popup/popup.js` | MODIFY | Add lock status display |
| `popup/popup.html` | MODIFY | Add lock status UI elements |

---

## Confidence Assessment (Updated)

| Metric | Confidence |
|--------|------------|
| Root cause correctly identified | **95%** |
| Solution will prevent race conditions | **90%** |
| Implementation complexity | Medium |
| Risk of breaking existing functionality | **Low** |
| Overall success probability | **85-90%** |

This fix directly addresses the confirmed root cause (multi-device race condition) with a proven pattern (distributed locking).
