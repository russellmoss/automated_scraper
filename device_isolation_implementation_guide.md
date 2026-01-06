# Device Isolation Fix - Cursor.ai Implementation Guide

## Problem Summary

When the Chrome extension is installed on multiple devices (e.g., Raspberry Pi + Laptop), scrapes started on one device can be "hijacked" by another device, causing the original scrape to appear to stall.

## Solution

Implement **device isolation** by tagging every scrape with the device that initiated it. Each device will only process scrapes it initiated, completely ignoring scrapes from other devices.

---

# Pre-Implementation Checklist

Before starting, ensure you have:
- [ ] Access to the extension codebase in Cursor.ai
- [ ] The extension loaded in Chrome/Chromium for testing
- [ ] Service worker DevTools open (`chrome://extensions` → Service Worker)

---

# Step 1: Create Device ID Utility Module

## Cursor.ai Prompt

```
Create a new file `background/device_id.js` that generates and persists a unique device identifier.

Requirements:
- Generate a short, human-readable device ID (e.g., "pi-a3f2", "win-b7c1")
- Detect platform from navigator.userAgent (CrOS/ChromeOS = pi, Windows = win, Mac = mac, Linux = linux)
- Persist the ID in chrome.storage.local so it survives restarts
- Export async function getDeviceId() that returns the ID (creates one if doesn't exist)
- Add comprehensive logging with [DEVICE] prefix
- No external dependencies
- Use ES module syntax (export/import)

Here's the exact implementation to use:
```

## Code to Provide

```javascript
// background/device_id.js
// Device identification utility for multi-device isolation

const DEVICE_ID_KEY = 'deviceId';
const LOG = '[DEVICE]';

/**
 * Detect platform from user agent
 * @returns {string} Platform identifier
 */
function detectPlatform() {
    const ua = navigator.userAgent;
    
    if (ua.includes('CrOS')) return 'pi';      // ChromeOS/Chromium on Pi
    if (ua.includes('Windows')) return 'win';   // Windows
    if (ua.includes('Mac')) return 'mac';       // macOS
    if (ua.includes('Linux')) return 'linux';   // Linux (non-ChromeOS)
    
    return 'dev';  // Unknown/development
}

/**
 * Generate a unique device identifier
 * Format: {platform}-{random4chars}
 * Example: "pi-a3f2", "win-b7c1"
 * @returns {string} New device ID
 */
function generateDeviceId() {
    const platform = detectPlatform();
    const randomPart = Math.random().toString(36).substring(2, 6);
    return `${platform}-${randomPart}`;
}

/**
 * Get or create the device ID
 * - Returns existing ID if already generated
 * - Creates and persists new ID if first run
 * @returns {Promise<string>} The device ID
 */
async function getDeviceId() {
    try {
        const result = await chrome.storage.local.get([DEVICE_ID_KEY]);
        
        if (result[DEVICE_ID_KEY]) {
            console.log(`${LOG} Using existing device ID: ${result[DEVICE_ID_KEY]}`);
            return result[DEVICE_ID_KEY];
        }
        
        // Generate new device ID
        const newId = generateDeviceId();
        await chrome.storage.local.set({ [DEVICE_ID_KEY]: newId });
        
        console.log(`${LOG} ✅ Generated new device ID: ${newId}`);
        console.log(`${LOG}    Platform detected: ${detectPlatform()}`);
        console.log(`${LOG}    User agent: ${navigator.userAgent.substring(0, 80)}...`);
        
        return newId;
        
    } catch (error) {
        console.error(`${LOG} ❌ Error getting device ID:`, error);
        // Return a temporary ID if storage fails
        const tempId = `temp-${Math.random().toString(36).substring(2, 6)}`;
        console.warn(`${LOG} Using temporary ID: ${tempId}`);
        return tempId;
    }
}

/**
 * Get device info for logging/debugging
 * @returns {object} Device information
 */
function getDeviceInfo() {
    return {
        platform: detectPlatform(),
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
    };
}

export { getDeviceId, getDeviceInfo, detectPlatform };
```

## Verification

After creating the file, run this in the service worker console:

```javascript
// Test device ID generation
import('./device_id.js').then(async (module) => {
    const id = await module.getDeviceId();
    console.log('Device ID:', id);
    console.log('Device Info:', module.getDeviceInfo());
});
```

---

# Step 2: Add Device ID Import to Service Worker

## Cursor.ai Prompt

```
In `background/service_worker.js`, add the import for the device_id module at the top of the file with the other imports.

Requirements:
- Import getDeviceId and getDeviceInfo from './device_id.js'
- Place with other local imports (not external/npm imports)
- Use ES module import syntax
- Do not modify any other code in this step

Find the imports section and add:
```

## Code to Provide

```javascript
// Add this import with the other local imports in service_worker.js
import { getDeviceId, getDeviceInfo } from './device_id.js';
```

## Verification

Check that the service worker reloads without errors in `chrome://extensions`.

---

# Step 3: Initialize Device ID on Service Worker Startup

## Cursor.ai Prompt

```
In `background/service_worker.js`, find the initialization/startup section and add device ID initialization.

Requirements:
- Call getDeviceId() during service worker initialization
- Log the device ID and info on startup
- This should run when the service worker first loads
- Add near other initialization code (look for "Initializing service worker" or similar logs)
- Do not break existing initialization logic

Add this initialization code:
```

## Code to Provide

```javascript
// Add this to the initialization section of service_worker.js
// (typically near where you see "[SW] Initializing service worker...")

// Initialize device ID on startup
(async function initDeviceId() {
    try {
        const deviceId = await getDeviceId();
        const deviceInfo = getDeviceInfo();
        console.log(`[SW] 📱 Device ID: ${deviceId}`);
        console.log(`[SW]    Platform: ${deviceInfo.platform}`);
    } catch (error) {
        console.error('[SW] Failed to initialize device ID:', error);
    }
})();
```

## Verification

Reload the extension and check service worker console for:
```
[SW] 📱 Device ID: win-xxxx (or pi-xxxx)
[SW]    Platform: win (or pi)
```

---

# Step 4: Modify Manual Scrape State to Include Device ID

## Cursor.ai Prompt

```
In `background/service_worker.js`, find the START_MANUAL_SCRAPE message handler (around line 2087, inside the switch statement for MESSAGE_ACTIONS.START_MANUAL_SCRAPE).

Requirements:
- The manualScrapeState object is created around line 2104 inside the START_MANUAL_SCRAPE case
- Get the device ID using await getDeviceId() BEFORE creating the state object (before line 2104)
- Add `initiatedByDevice` property to the manualScrapeState object
- Add `initiatedAt` property with Date.now() for debugging
- Log when a scrape is initiated with the device ID
- The state is saved at line 2115 with saveToStorage()
- Do not change the existing state structure, only ADD the new properties

Find the code that creates the manualScrapeState object (around line 2104) and modify it to include device tagging:
```

## Code to Provide

```javascript
// In the START_MANUAL_SCRAPE case handler (around line 2087)
// Find where manualScrapeState object is created (around line 2104)

// BEFORE creating manualScrapeState, get device ID:
const deviceId = await getDeviceId();
console.log(`${LOG} 🚀 Initiating manual scrape on device: ${deviceId}`);

// Then modify the manualScrapeState object creation (around line 2104):
manualScrapeState = {
    isRunning: true,
    isAborted: false,
    sourceName,
    searches,
    currentSearchIndex: 0,
    workbookId,
    executionId: execution.id,
    totalProfiles: 0,
    initiatedByDevice: deviceId,  // ADD THIS
    initiatedAt: Date.now()       // ADD THIS (useful for debugging)
};

// The saveToStorage() call at line 2115 will save this state
console.log(`${LOG} ✅ Scrape state saved with device tag: ${deviceId}`);
```

**Note:** The LOG constant is already defined in service_worker.js as `LOG_PREFIXES.SERVICE_WORKER`, so `${LOG}` will work correctly.

## Verification

Start a manual scrape and check service worker console for:
```
[SW] 🚀 Initiating manual scrape on device: win-xxxx
[SW] ✅ Scrape state saved with device tag: win-xxxx
```

Then verify storage:
```javascript
chrome.storage.local.get(['manualScrapeState'], r => console.log(r.manualScrapeState));
// Should show: { ..., initiatedByDevice: "win-xxxx", ... }
```

---

# Step 5: Add Device Check to processManualScrape()

## Cursor.ai Prompt

```
In `background/service_worker.js`, find the `processManualScrape()` function (starts at line 974).

Requirements:
- Get the current device ID at the start of the function (after line 975)
- After retrieving manualScrapeState at line 978 (let state = stored.manualScrapeState), add device ownership check
- Add the device check AFTER line 978 but BEFORE line 981 (the isRunning check)
- If initiatedByDevice doesn't match our device ID AND it exists, log and return early (don't process)
- If initiatedByDevice is not set (legacy state), tag it with our device ID and continue
- Add clear logging so we can debug issues
- Do NOT modify the rest of the function logic

Add this check after line 978 (after getting state) but before line 981 (before isRunning check):
```

## Code to Provide

```javascript
// In processManualScrape() function (starts at line 974)
// Add device check after line 978 (let state = stored.manualScrapeState)
// but before line 981 (if (!state?.isRunning))

async function processManualScrape() {
    console.log(`${LOG} Starting manual scrape processor`);
    
    // Get our device ID first
    const myDeviceId = await getDeviceId();
    console.log(`${LOG} 📱 This device: ${myDeviceId}`);
    
    const stored = await getFromStorage(['manualScrapeState', STORAGE_KEYS.SOURCE_MAPPING]);
    let state = stored.manualScrapeState;
    const sourceMapping = stored[STORAGE_KEYS.SOURCE_MAPPING] || {};
    
    // ============================================================
    // DEVICE ISOLATION CHECK - Only process our own scrapes
    // Add this check HERE (after getting state, before isRunning check)
    // ============================================================
    if (state) {
        const scrapeOwner = state.initiatedByDevice;
        
        if (scrapeOwner && scrapeOwner !== myDeviceId) {
            // This scrape belongs to another device - ignore it completely
            console.log(`${LOG} ⏭️ Ignoring scrape - belongs to device: ${scrapeOwner}`);
            console.log(`${LOG}    Our device ID: ${myDeviceId}`);
            console.log(`${LOG}    Scrape target: ${state.sourceName}`);
            console.log(`${LOG}    This is normal in multi-device setups`);
            return; // Exit without processing
        }
        
        // Tag legacy scrapes (started before this fix) with our device
        if (!scrapeOwner) {
            console.log(`${LOG} 🏷️ Tagging unowned scrape with our device: ${myDeviceId}`);
            state.initiatedByDevice = myDeviceId;
            await saveToStorage({ manualScrapeState: state });
        }
        
        if (scrapeOwner === myDeviceId || !scrapeOwner) {
            console.log(`${LOG} ✅ Processing our scrape for: ${state.sourceName}`);
        }
    }
    // ============================================================
    
    // Note: LOG constant is already defined in service_worker.js as LOG_PREFIXES.SERVICE_WORKER
    
    // Continue with existing isRunning check (line 981)
    if (!state?.isRunning) {
        console.log(`${LOG} Manual scrape not active`);
        return;
    }
    
    // ... rest of existing processManualScrape() code continues here ...
```

## Verification

1. Check service worker console shows device ID on scrape start
2. Manually test by:
   - Setting a fake scrape state with different device ID:
   ```javascript
   chrome.storage.local.set({ 
       manualScrapeState: { 
           isRunning: true, 
           initiatedByDevice: 'other-device-xxxx',
           sourceName: 'Test Person'
       }
   });
   ```
   - Then trigger processManualScrape() and verify it's ignored:
   ```javascript
   // You should see: "[SW] ⏭️ Ignoring scrape - belongs to device: other-device-xxxx"
   ```

---

# Step 6: Add Device Check to Message Handler

## Cursor.ai Prompt

```
In `background/service_worker.js`, find the START_MANUAL_SCRAPE case handler (around line 2087, inside the message listener switch statement that handles MESSAGE_ACTIONS.START_MANUAL_SCRAPE).

The issue: When both devices receive a START_MANUAL_SCRAPE message, both try to process it and create state.

Requirements:
- Add device check INSIDE the START_MANUAL_SCRAPE case, BEFORE creating manualScrapeState (before line 2104)
- Check if there's an existing manualScrapeState with a different device ID
- If another device owns it, don't create new state, just return early
- This prevents creating state for another device's scrape
- Add clear logging when we skip due to device mismatch
- This is a second layer of protection in addition to the check in processManualScrape()

Find the START_MANUAL_SCRAPE case (around line 2087) and add this check BEFORE creating manualScrapeState:
```

## Code to Provide

```javascript
// In the message listener switch statement, find the START_MANUAL_SCRAPE case (around line 2087)
// The case looks like: case MESSAGE_ACTIONS.START_MANUAL_SCRAPE: {

case MESSAGE_ACTIONS.START_MANUAL_SCRAPE: {
    const { sourceName, searches } = message;
    
    // ============================================================
    // DEVICE ISOLATION CHECK - Before creating state
    // Add this check BEFORE creating manualScrapeState (before line 2104)
    // ============================================================
    const myDeviceId = await getDeviceId();
    const existingState = await getFromStorage(['manualScrapeState']);
    
    // Check if there's an existing scrape owned by another device
    if (existingState.manualScrapeState?.initiatedByDevice && 
        existingState.manualScrapeState.initiatedByDevice !== myDeviceId) {
        console.log(`${LOG} ⏭️ Ignoring START_MANUAL_SCRAPE - belongs to ${existingState.manualScrapeState.initiatedByDevice}`);
        console.log(`${LOG}    Our device: ${myDeviceId}`);
        console.log(`${LOG}    Scrape: ${existingState.manualScrapeState.sourceName}`);
        response = { success: false, error: 'Scrape belongs to another device' };
        break; // Don't create new state
    }
    
    console.log(`${LOG} ✅ Processing START_MANUAL_SCRAPE for device: ${myDeviceId}`);
    // ============================================================
    
    // Continue with existing code (getting workbookId, creating execution, etc.)
    const { sourceMapping } = await getFromStorage([STORAGE_KEYS.SOURCE_MAPPING]);
    const workbookId = sourceMapping?.[sourceName];
    
    // ... rest of existing START_MANUAL_SCRAPE case code ...
    // (manualScrapeState creation at line 2104 will now include device ID from Step 4)
}
```

## Verification

Check that START_MANUAL_SCRAPE messages are logged with device checks.

---

# Step 7: Add Device Check to Scheduled Scrape Execution

## Cursor.ai Prompt

```
In `background/service_worker.js`, find the `executeScheduledRun()` function (around line 484) that executes scheduled scrapes.

**Note:** The function is in service_worker.js, NOT scheduler.js. scheduler.js only has helper functions.

The problem: When a schedule triggers, BOTH devices see the same schedule and both try to execute it.

Solution: Each device should "claim" a schedule execution with its device ID. If a schedule is already claimed by another device, skip it.

Requirements:
- getDeviceId() is already imported from Step 2, so no new import needed
- When starting a scheduled scrape execution, tag it with the device ID
- Before processing, check if already claimed by another device
- Add clear logging
- Use storage key like `scheduleExecution_{scheduleName}` or similar
- Add claim at the start of executeScheduledRun(), clear it in finally block

Find the executeScheduledRun() function (around line 484) and add device claiming:
```

## Code to Provide

```javascript
// In service_worker.js, find executeScheduledRun() function (around line 484)
// Note: getDeviceId() is already imported from Step 2

async function executeScheduledRun(schedule) {
    console.log(`${LOG} Executing scheduled run for ${schedule.sourceName}`);
    
    // ============================================================
    // DEVICE ISOLATION - Claim schedule execution
    // ============================================================
    const myDeviceId = await getDeviceId();
    const scheduleName = schedule.sourceName;
    const executionKey = `scheduleExecution_${scheduleName.replace(/\s+/g, '_')}`;
    
    // Check if another device is already running this schedule
    const { [executionKey]: existingExecution } = await chrome.storage.local.get([executionKey]);
    
    if (existingExecution) {
        const executionAge = Date.now() - existingExecution.startedAt;
        const maxAge = 60 * 60 * 1000; // 1 hour max execution time
        
        if (existingExecution.deviceId !== myDeviceId && executionAge < maxAge) {
            console.log(`${LOG} ⏭️ Skipping "${scheduleName}" - already running on device: ${existingExecution.deviceId}`);
            console.log(`${LOG}    Our device: ${myDeviceId}`);
            console.log(`${LOG}    Started ${Math.round(executionAge/1000)}s ago`);
            return; // Don't execute
        }
        
        // Clear stale execution record
        if (executionAge >= maxAge) {
            console.log(`${LOG} 🧹 Clearing stale execution record for "${scheduleName}"`);
            await chrome.storage.local.remove([executionKey]);
        }
    }
    
    // Claim this schedule execution
    await chrome.storage.local.set({
        [executionKey]: {
            deviceId: myDeviceId,
            scheduleName: scheduleName,
            startedAt: Date.now()
        }
    });
    
    console.log(`${LOG} ✅ Device ${myDeviceId} claimed schedule: ${scheduleName}`);
    // ============================================================
    
    // Ensure Google OAuth token is fresh before starting
    try {
        await ensureFreshToken();
        // ... rest of existing executeScheduledRun() code ...
        
    } finally {
        // Clear execution record when done
        await chrome.storage.local.remove([executionKey]);
        console.log(`${LOG} 🏁 Device ${myDeviceId} completed schedule: ${scheduleName}`);
    }
}
```

## Verification

Check scheduler logs show device ID and claiming behavior.

---

# Step 8: Add Enhanced Logging for Debugging

## Cursor.ai Prompt

```
In `background/service_worker.js`, add a diagnostic logging function that can be called to see the current device state and any active scrapes.

Requirements:
- Create a function `logDeviceDiagnostics()` that logs:
  - This device's ID
  - Current manualScrapeState (including which device owns it)
  - Any active schedule executions
  - Timestamp
- Call this function on service worker startup
- Make it available globally for console debugging
- Add as a message handler so popup can request it

Add this diagnostic function:
```

## Code to Provide

```javascript
// Add this function to service_worker.js

/**
 * Log comprehensive device and scrape diagnostics
 * Can be called from console or via message
 */
async function logDeviceDiagnostics() {
    const myDeviceId = await getDeviceId();
    const deviceInfo = getDeviceInfo();
    
    console.log('\n' + '='.repeat(60));
    console.log('[DIAGNOSTICS] 📊 Device & Scrape Status');
    console.log('='.repeat(60));
    
    // Device info
    console.log(`[DIAGNOSTICS] 📱 This Device: ${myDeviceId}`);
    console.log(`[DIAGNOSTICS]    Platform: ${deviceInfo.platform}`);
    console.log(`[DIAGNOSTICS]    Time: ${new Date().toLocaleString()}`);
    
    // Manual scrape state
    const { manualScrapeState } = await chrome.storage.local.get(['manualScrapeState']);
    if (manualScrapeState) {
        console.log(`[DIAGNOSTICS] 📋 Manual Scrape State:`);
        console.log(`[DIAGNOSTICS]    isRunning: ${manualScrapeState.isRunning}`);
        console.log(`[DIAGNOSTICS]    sourceName: ${manualScrapeState.sourceName || 'N/A'}`);
        console.log(`[DIAGNOSTICS]    initiatedByDevice: ${manualScrapeState.initiatedByDevice || 'NOT SET'}`);
        console.log(`[DIAGNOSTICS]    currentSearchIndex: ${manualScrapeState.currentSearchIndex || 0}`);
        console.log(`[DIAGNOSTICS]    isOurs: ${manualScrapeState.initiatedByDevice === myDeviceId ? 'YES ✅' : 'NO ⏭️'}`);
    } else {
        console.log(`[DIAGNOSTICS] 📋 Manual Scrape State: None`);
    }
    
    // Schedule executions
    const allStorage = await chrome.storage.local.get(null);
    const scheduleExecutions = Object.entries(allStorage)
        .filter(([key]) => key.startsWith('scheduleExecution_'));
    
    if (scheduleExecutions.length > 0) {
        console.log(`[DIAGNOSTICS] 📅 Active Schedule Executions:`);
        for (const [key, value] of scheduleExecutions) {
            const age = Math.round((Date.now() - value.startedAt) / 1000);
            const isOurs = value.deviceId === myDeviceId;
            console.log(`[DIAGNOSTICS]    ${value.scheduleName}: device=${value.deviceId} (${age}s ago) ${isOurs ? '✅ OURS' : '⏭️ OTHER'}`);
        }
    } else {
        console.log(`[DIAGNOSTICS] 📅 Active Schedule Executions: None`);
    }
    
    console.log('='.repeat(60) + '\n');
    
    return {
        deviceId: myDeviceId,
        platform: deviceInfo.platform,
        manualScrapeState,
        scheduleExecutions: Object.fromEntries(scheduleExecutions)
    };
}

// Make available globally for console debugging
globalThis.logDeviceDiagnostics = logDeviceDiagnostics;

// Add to message handler (in the switch statement):
case 'GET_DEVICE_DIAGNOSTICS':
    logDeviceDiagnostics().then(diagnostics => {
        sendResponse(diagnostics);
    });
    return true; // Keep channel open for async response
```

## Verification

Run in service worker console:
```javascript
logDeviceDiagnostics();
```

Should output comprehensive device status.

---

# Step 9: Add Cleanup on Scrape Completion

## Cursor.ai Prompt

```
In `background/service_worker.js`, find where manual scrapes are marked as complete and ensure the device tag is preserved in logs and any cleanup properly identifies the device.

Requirements:
- When a scrape completes, log which device completed it
- Clear any schedule execution claims for this device
- Ensure the completion state includes device info for debugging
- Add to the finally block or completion handler

Find scrape completion code and add:
```

## Code to Provide

```javascript
// In the finally block of processManualScrape() or wherever scrape completion is handled:

finally {
    const myDeviceId = await getDeviceId();
    
    console.log(`${LOG} 🏁 Manual scrape completed on device: ${myDeviceId}`);
    
    // Log final state
    const { manualScrapeState } = await getFromStorage(['manualScrapeState']);
    if (manualScrapeState) {
        console.log(`${LOG}    Source: ${manualScrapeState.sourceName}`);
        console.log(`${LOG}    Total Profiles: ${manualScrapeState.totalProfiles || 0}`);
        console.log(`${LOG}    Searches Completed: ${manualScrapeState.currentSearchIndex || 0}`);
        console.log(`${LOG}    Device: ${manualScrapeState.initiatedByDevice}`);
    }
    
    // Clear any schedule execution claims for this source
    if (manualScrapeState?.sourceName) {
        const executionKey = `scheduleExecution_${manualScrapeState.sourceName.replace(/\s+/g, '_')}`;
        await chrome.storage.local.remove([executionKey]);
    }
    
    // ... existing cleanup code ...
}
```

---

# Step 10: Test the Complete Implementation

## Cursor.ai Prompt

```
Create a test checklist and console commands to verify the device isolation fix works correctly.

Requirements:
- Commands to check device ID on each device
- Commands to simulate multi-device scenarios
- Commands to verify isolation is working
- Clear pass/fail criteria

Create this as comments in service_worker.js or as a separate test file:
```

## Test Commands

```javascript
// ============================================================
// DEVICE ISOLATION TEST COMMANDS
// Run these in the service worker console to test the fix
// ============================================================

// TEST 1: Verify Device ID
// Run on EACH device - should show different IDs
chrome.storage.local.get(['deviceId'], r => console.log('This device ID:', r.deviceId));

// TEST 2: Check current diagnostics
logDeviceDiagnostics();

// TEST 3: Simulate another device's scrape state
// This simulates a scrape started by a DIFFERENT device
chrome.storage.local.set({ 
    manualScrapeState: { 
        isRunning: true, 
        sourceName: 'Test Person',
        initiatedByDevice: 'other-device-9999',  // Fake other device
        currentSearchIndex: 0,
        searches: [{title: 'Test', url: 'https://linkedin.com'}]
    }
});

// TEST 4: Try to process the "other device's" scrape
// Should see: "⏭️ Ignoring scrape - belongs to device: other-device-9999"
processManualScrape();

// TEST 5: Clean up test state
chrome.storage.local.remove(['manualScrapeState']);

// TEST 6: Verify our own scrapes still work
// Start a real scrape via the popup UI and verify it:
// - Shows our device ID in logs
// - Processes normally
// - Completes all searches

// TEST 7: Check schedule execution claims
chrome.storage.local.get(null, r => {
    const executions = Object.entries(r).filter(([k]) => k.startsWith('scheduleExecution_'));
    console.log('Schedule executions:', executions);
});
```

## Expected Results

| Test | Expected Result |
|------|-----------------|
| Test 1 | Different ID on each device (e.g., `pi-a3f2` vs `win-b7c1`) |
| Test 2 | Full diagnostics output with device info |
| Test 3 | State saved with fake device ID |
| Test 4 | Log shows "Ignoring scrape - belongs to device: other-device-9999" |
| Test 5 | State cleared |
| Test 6 | Scrape works normally with our device ID |
| Test 7 | Shows any active schedule claims |

---

# Post-Implementation Verification

After implementing all steps, verify on BOTH devices:

## On Device 1 (e.g., Pi):
```javascript
// Should show pi-xxxx
chrome.storage.local.get(['deviceId'], r => console.log('Device 1:', r.deviceId));
```

## On Device 2 (e.g., Laptop):
```javascript
// Should show win-xxxx (different from Device 1)
chrome.storage.local.get(['deviceId'], r => console.log('Device 2:', r.deviceId));
```

## Start a scrape on Device 1, check Device 2:
```javascript
// On Device 2, check the state
chrome.storage.local.get(['manualScrapeState'], r => {
    console.log('Scrape owner:', r.manualScrapeState?.initiatedByDevice);
    // Should show Device 1's ID, not ours
});
```

---

# Troubleshooting

## If scrapes are still being hijacked:

1. **Check device IDs are different:**
   ```javascript
   chrome.storage.local.get(['deviceId'], console.log);
   ```

2. **Check scrape state has device tag:**
   ```javascript
   chrome.storage.local.get(['manualScrapeState'], r => {
       console.log('initiatedByDevice:', r.manualScrapeState?.initiatedByDevice);
   });
   ```

3. **Look for "Ignoring scrape" logs:**
   - Should see `⏭️ Ignoring scrape - belongs to device: xxx` on the non-owner device

4. **Check for missing device checks:**
   - Search codebase for `processManualScrape` calls without device check

## If device IDs are the same on different devices:

```javascript
// Force regenerate device ID
chrome.storage.local.remove(['deviceId'], () => {
    location.reload(); // Reload service worker
});
```

---

# Summary of Changes

| File | Change |
|------|--------|
| `background/device_id.js` | NEW - Device ID generation and management |
| `background/service_worker.js` | MODIFIED - Import device_id, add checks to processManualScrape(), START_MANUAL_SCRAPE handler, executeScheduledRun(), diagnostics |
| `background/scheduler.js` | NO CHANGES - Scheduled scrape execution is in service_worker.js, not scheduler.js |

## Key Logging to Watch For

```
✅ Good logs (scrape is ours):
[SW] 📱 This device: win-a3f2
[SW] ✅ Processing our scrape for: Jesse Papike

⏭️ Good logs (scrape belongs to other device):
[SW] 📱 This device: win-a3f2
[SW] ⏭️ Ignoring scrape - belongs to device: pi-b7c1
[SW]    This is normal in multi-device setups

❌ Bad logs (missing device tag):
[SW] 🏷️ Tagging unowned scrape with our device: win-a3f2
(This means old state without device tag - will be fixed automatically)
```
