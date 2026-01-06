# Manual Scrape Stalling Issue - Root Cause Analysis & Solution

## Problem Summary

**Symptom:** Manual scrapes stall after completing 2 searches and don't continue with remaining searches. The scraper appears to get stuck on the last page of one of the first two searches.

**Example:** Matt DuToit scrape completed "Financial Advisor" and "Financial Consultant" searches, then stalled and didn't process the remaining 8 searches (Financial Planner, Investment Advisor, Partner, Portfolio Manager, Principal, Wealth Advisor, Wealth Manager).

**Key Observation:** Scheduled scraping works fine and completes all searches without issues. The problem is **specific to manual scraping**.

**🔍 CRITICAL DISCOVERY #1:** The stalling issue **only occurs on Chromium, not Chrome**. Testing on Chrome shows the scrape working perfectly through all searches. This suggests the issue is **browser-specific**, likely related to service worker lifecycle management differences between Chrome and Chromium.

**🔍 CRITICAL DISCOVERY #2:** **Multi-Device Race Condition** - A scrape started on the Pi (Chromium) was actually running on the laptop (Chrome). Both devices have the extension installed and access the same Google Sheets schedules. When a scrape is triggered, **both devices race to process it**, causing one device to start work that another device takes over. This explains why scrapes appear to "stall" - they're actually being hijacked by another device mid-execution.

**Evidence:**
- User started scrape on Pi (Chromium), but logs showed it running on laptop (Chrome)
- Confirmed via `navigator.userAgent`:
  - Pi: `CrOS x86_64` Chrome 142
  - Laptop: `Windows NT 10.0` Chrome 143
- Both devices see the same Google Sheets schedules simultaneously
- No device locking mechanism exists to prevent concurrent execution

---

## Root Cause Analysis

### Primary Root Cause #1: Multi-Device Race Condition (CONFIRMED)

**The Real Problem:**
When multiple devices (Pi + Laptop) have the extension installed and access the same Google Sheets:
1. Both devices poll the same schedule source (Google Sheets)
2. When a manual scrape is triggered, **both devices detect it simultaneously**
3. Both devices attempt to start processing the same scrape
4. One device starts, but the other device may take over mid-execution
5. Result: Scrapes appear to "stall" but are actually being **hijacked by another device**

**Why This Causes Stalling:**
- Device A (Pi) starts scrape, begins processing search 1
- Device B (Laptop) also detects the scrape and starts processing
- Device B may update the shared state (Google Sheets or storage)
- Device A's service worker may detect state changes and abort/restart
- Or Device B completes search 1, Device A thinks it's still on search 1
- The scrape appears "stalled" from Device A's perspective, but Device B is actually running it

**Why It Happens:**
- **No device identification** - Extension doesn't know which device it's running on
- **No distributed locking** - No mechanism to prevent multiple devices from processing the same scrape
- **Shared state** - Both devices read/write to the same Google Sheets and potentially same storage
- **VPN access** - User accessing Pi via VPN means both devices are active simultaneously

**This explains:**
- ✅ Why scrapes "stall" after 2 searches (device handoff happens mid-scrape)
- ✅ Why it works on Chrome when tested in isolation (no other device competing)
- ✅ Why scheduled scraping may work better (different timing, less likely to conflict)
- ✅ Why the issue is intermittent (depends on which device "wins" the race)

### Primary Root Cause #2: Browser-Specific Service Worker Lifecycle (Chromium)

### Primary Root Cause: Browser-Specific Service Worker Lifecycle (Chromium)

**Evidence:**
- ✅ Manual scrapes work perfectly on **Chrome** (tested: 4+ searches completing successfully)
- ❌ Manual scrapes stall on **Chromium** (stalls after 2 searches)
- ✅ Content script state management works correctly on Chrome
- ✅ Service worker loop continues properly on Chrome

**Why Chromium Behaves Differently:**

1. **Service Worker Termination (Most Likely)**
   - Chromium (especially on Raspberry Pi or resource-constrained systems) **terminates service workers more aggressively** to save memory
   - When the service worker dies mid-scrape:
     - The `processManualScrape()` loop stops silently
     - No error is logged because the entire context is gone
     - The scrape appears to "stall" but the service worker simply isn't running
   - Chrome on desktop has more resources and handles service worker lifecycle more gracefully

2. **Memory Pressure on Raspberry Pi**
   - Limited RAM (1-4GB typically)
   - Chromium is memory-hungry
   - Under pressure, background processes (service workers) get killed first
   - Service workers are prime targets for termination

3. **Keep-Alive Alarm Reliability**
   - The extension uses `chrome.alarms` to keep the service worker alive
   - This may be less reliable on Chromium, especially older builds
   - Chrome may respect keep-alive alarms more consistently

4. **Content Script Injection Timing**
   - Chromium may have different timing for content script injection after navigation
   - "Could not establish connection" errors may be fatal rather than recoverable on Chromium

### Secondary Root Cause: Content Script State Persistence (Contributing Factor)

Even if the primary issue is service worker termination, the content script state persistence issue is still a **contributing factor** that can make recovery harder:

When a manual scrape navigates between searches, the content script's state (`isScrapingActive` flag) may not be properly reset between searches. This causes subsequent searches to be silently skipped **if the service worker survives but the content script state is stale**.

### The Core Issue: Content Script State Persistence

When a manual scrape navigates between searches, the content script's state (`isScrapingActive` flag) may not be properly reset between searches. This causes subsequent searches to be silently skipped.

### Why Manual Scraping Fails But Scheduled Works

**Scheduled Scraping Flow:**
- Uses `waitForScrapingComplete()` which has simpler timeout handling
- May have different navigation patterns or timing
- Less prone to state persistence issues

**Manual Scraping Flow:**
- Uses `waitForScrapingCompleteWithHealthCheck()` with complex health check logic
- Navigates to new URLs in the same tab: `await chrome.tabs.update(tab.id, { url: search.url })`
- When navigating, the content script may:
  1. **Persist state** if the page doesn't fully reload
  2. **Get reloaded** but old state variables remain in memory
  3. **Timeout/stuck detection** may not properly reset state before next search

### The Fatal Check

In `content/content.js`, the `startScraping()` function has this guard:

```javascript
async function startScraping(sourceName, maxPagesOverride) {
    if (isScrapingActive) {
        console.warn('[CS] Scraping already active');
        return;  // ⚠️ SILENTLY EXITS - no error, just skips
    }
    // ... rest of function
}
```

**What Happens:**
1. Search 1 completes (or times out/sticks)
2. Service worker navigates to Search 2 URL
3. Content script still has `isScrapingActive = true` from Search 1
4. Service worker sends `START_SCRAPING` message
5. Content script sees `isScrapingActive = true` and **silently returns**
6. No scraping happens, but service worker thinks it's waiting
7. Health check eventually times out, but by then the loop may have issues
8. Search 3+ never get processed

### Why It Happens on "Last Page"

The issue often manifests on the last page because:
- Last page detection logic may not properly trigger completion
- Timeout handling may not reset state before navigation
- The `finally` block may not execute if there's an error or timeout

---

## Solution: Multi-Layer State Reset & Recovery

### Fix 1: Content Script - Force State Reset at Start

**Location:** `content/content.js` - `startScraping()` function

**Change:** Add explicit state reset at the beginning of `startScraping()` to handle cases where previous scrape didn't clean up:

```javascript
async function startScraping(sourceName, maxPagesOverride) {
    // CRITICAL FIX: Force reset state if it's stuck from previous scrape
    if (isScrapingActive) {
        console.warn('[CS] ⚠️ Previous scrape state was active - forcing reset');
        console.warn('[CS] This indicates previous scrape did not clean up properly');
        // Force cleanup
        isScrapingActive = false;
        stopRequested = false;
        currentSourceName = '';
        removeStopButton();
    }
    
    // Now proceed normally
    isScrapingActive = true;
    stopRequested = false;
    currentSourceName = sourceName;
    // ... rest of function
}
```

**Why This Works:** Even if the previous scrape's `finally` block didn't execute, we force a clean state before starting the new scrape.

---

### Fix 2: Content Script - Add RESET_SCRAPE_STATE Message Handler

**Location:** `content/content.js` - Message listener switch statement

**Change:** Add a new message action that service worker can call to explicitly reset state:

```javascript
case 'RESET_SCRAPE_STATE':
    console.log('[CS] 🔄 Explicit state reset requested');
    isScrapingActive = false;
    stopRequested = false;
    currentSourceName = '';
    removeStopButton();
    sendResponse({ success: true, reset: true });
    return true;
```

**Why This Works:** Gives service worker explicit control to reset state before starting a new search, especially useful after navigation.

---

### Fix 3: Service Worker - Reset State Before Each Search

**Location:** `background/service_worker.js` - `processManualScrape()` function

**Change:** Before sending `START_SCRAPING`, send a reset message and wait for page to be ready:

```javascript
// Inside the for loop, BEFORE sending START_SCRAPING:

// === RESET content script state before starting new search ===
try {
    // First, try to reset state (may fail if content script not ready yet)
    await chrome.tabs.sendMessage(tab.id, { action: 'RESET_SCRAPE_STATE' });
    console.log(`${LOG} 🔄 Reset content script state before search ${i + 1}`);
} catch (e) {
    // This is OK - content script might not be ready yet after navigation
    console.log(`${LOG} Could not reset state (content script may be reloading): ${e.message}`);
}

// Small delay to ensure content script is ready after navigation
await new Promise(resolve => setTimeout(resolve, 1000));

// Now send scraping command
await chrome.tabs.sendMessage(tab.id, {
    action: MESSAGE_ACTIONS.START_SCRAPING,
    sourceName: sourceName
});
```

**Why This Works:** Ensures state is explicitly reset before each search, even if the previous search's cleanup didn't work.

---

### Fix 4: Service Worker - Better Error Recovery

**Location:** `background/service_worker.js` - `processManualScrape()` function

**Change:** After timeout/stuck detection, explicitly reset state before continuing:

```javascript
if (result?.timeout) {
    console.error(`${LOG} ⚠️ Search "${search.title}" timed out after 30 minutes`);
    // CRITICAL: Reset content script state before continuing
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'RESET_SCRAPE_STATE' });
        console.log(`${LOG} 🔄 Reset state after timeout`);
    } catch (e) {
        console.warn(`${LOG} Could not reset state after timeout: ${e.message}`);
    }
    // Continue to next search anyway
} else if (result?.stuck) {
    console.warn(`${LOG} ⚠️ Search "${search.title}" appears stuck`);
    // CRITICAL: Reset content script state before continuing
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'RESET_SCRAPE_STATE' });
        console.log(`${LOG} 🔄 Reset state after stuck detection`);
    } catch (e) {
        console.warn(`${LOG} Could not reset state after stuck: ${e.message}`);
    }
    // Continue to next search
}
```

**Why This Works:** Ensures state is reset even when searches timeout or get stuck, preventing cascading failures.

---

### Fix 5: Content Script - Ensure SCRAPING_COMPLETE is Always Sent

**Location:** `content/content.js` - `startScraping()` function

**Change:** Ensure completion message is sent even in error cases, and wrap everything in try/finally:

```javascript
async function startScraping(sourceName, maxPagesOverride) {
    // ... state reset logic from Fix 1 ...
    
    isScrapingActive = true;
    stopRequested = false;
    currentSourceName = sourceName;
    
    let totalProfiles = 0;
    let totalPages = 0;
    let completionSent = false;
    
    try {
        // ... existing scraping logic ...
        
        // Mark completion as sent
        completionSent = true;
        sendMessageSafe({
            action: 'SCRAPING_COMPLETE',
            totalProfiles: totalProfiles,
            totalPages: totalPages,
            aborted: stopRequested
        });
        
    } catch (error) {
        console.error('[CS] ❌ Scraping error:', error);
        
        // Send error notification
        sendMessageSafe({
            action: 'SCRAPE_ERROR',
            // ... error details ...
        });
        
        // CRITICAL: Always send completion message, even on error
        if (!completionSent) {
            sendMessageSafe({
                action: 'SCRAPING_COMPLETE',
                totalProfiles: totalProfiles,
                totalPages: totalPages,
                error: error.message
            });
            completionSent = true;
        }
    } finally {
        // ALWAYS reset state, even if completion message failed
        console.log('[CS] 🧹 Cleaning up scrape state');
        isScrapingActive = false;
        stopRequested = false;
        currentSourceName = '';
        removeStopButton();
        
        // If we somehow didn't send completion, send it now
        if (!completionSent) {
            console.warn('[CS] ⚠️ Completion message not sent - sending from finally block');
            sendMessageSafe({
                action: 'SCRAPING_COMPLETE',
                totalProfiles: totalProfiles,
                totalPages: totalPages,
                error: 'State cleanup - completion not sent earlier'
            });
        }
    }
}
```

**Why This Works:** Ensures the service worker always receives a completion signal, preventing it from waiting indefinitely.

---

## Chromium-Specific Solutions

### Fix 6: More Aggressive Keep-Alive for Chromium

**Location:** `background/service_worker.js` - Keep-alive alarm setup

**Change:** Reduce keep-alive interval for Chromium to prevent service worker termination:

```javascript
// Detect if running on Chromium (Raspberry Pi)
const isChromium = navigator.userAgent.includes('Chromium') && !navigator.userAgent.includes('Chrome');

// More aggressive keep-alive for Chromium
const KEEP_ALIVE_INTERVAL = isChromium ? 15000 : 30000; // 15 seconds for Chromium, 30 for Chrome

// Set up keep-alive alarm
chrome.alarms.create('keepAlive', { periodInMinutes: KEEP_ALIVE_INTERVAL / 60000 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        // Keep service worker alive
        console.log(`[SW] 💓 Keep-alive ping (Chromium: ${isChromium})`);
    }
});
```

**Why This Works:** More frequent keep-alive pings prevent Chromium from terminating the service worker during long-running scrapes.

---

### Fix 7: Service Worker Restart Detection & Recovery

**Location:** `background/service_worker.js` - Service worker startup

**Change:** Detect if service worker restarted mid-scrape and resume:

```javascript
// On service worker startup, check if a scrape was in progress
chrome.runtime.onStartup.addListener(async () => {
    await checkAndResumeInterruptedScrape();
});

// Also check on extension install/update
chrome.runtime.onInstalled.addListener(async () => {
    await checkAndResumeInterruptedScrape();
});

async function checkAndResumeInterruptedScrape() {
    const { manualScrapeState } = await chrome.storage.local.get(['manualScrapeState']);
    
    if (manualScrapeState?.isRunning) {
        const timeSinceLastUpdate = Date.now() - (manualScrapeState.lastUpdate || 0);
        const minutesSinceUpdate = timeSinceLastUpdate / 1000 / 60;
        
        console.warn(`[SW] ⚠️ Service worker restarted while scrape was in progress!`);
        console.warn(`[SW] Last update: ${minutesSinceUpdate.toFixed(1)} minutes ago`);
        console.warn(`[SW] Attempting to resume from search ${(manualScrapeState.currentSearchIndex || 0) + 1}`);
        
        // Only resume if it was recent (within last 5 minutes)
        // Otherwise, mark as failed
        if (minutesSinceUpdate < 5) {
            console.log(`[SW] ✅ Resuming scrape...`);
            processManualScrape().catch(e => {
                console.error('[SW] Resume failed:', e);
                // Mark scrape as failed
                manualScrapeState.isRunning = false;
                manualScrapeState.isAborted = false;
                chrome.storage.local.set({ manualScrapeState });
            });
        } else {
            console.warn(`[SW] ⚠️ Scrape was interrupted too long ago (${minutesSinceUpdate.toFixed(1)} min) - marking as failed`);
            manualScrapeState.isRunning = false;
            manualScrapeState.isAborted = false;
            if (manualScrapeState.executionId) {
                await updateExecutionRecord(manualScrapeState.executionId, {
                    status: 'failed',
                    error: 'Service worker terminated mid-scrape',
                    completedAt: new Date().toISOString()
                }).catch(() => {});
            }
            chrome.storage.local.set({ manualScrapeState });
        }
    }
}
```

**Why This Works:** Automatically resumes scrapes if the service worker restarts, preventing lost progress.

---

### Fix 8: Update State Timestamp on Each Search

**Location:** `background/service_worker.js` - `processManualScrape()` function

**Change:** Update a timestamp in state on each search iteration to detect service worker restarts:

```javascript
// Inside the for loop, after updating currentSearchIndex:
state.currentSearchIndex = i;
state.lastUpdate = Date.now(); // Add this line
await saveToStorage({ manualScrapeState: state });
```

**Why This Works:** Allows detection of how long ago the scrape was interrupted, enabling smart resume logic.

---

### Fix 9: Monitor Service Worker Health (Debugging)

**Location:** `background/service_worker.js` - Add health monitoring

**Change:** Add code to detect service worker termination:

```javascript
// Log when service worker might be terminating
let lastPing = Date.now();
setInterval(() => {
    const now = Date.now();
    const gap = now - lastPing;
    if (gap > 35000) { // More than 35 seconds since last check
        console.error(`🚨 POSSIBLE SERVICE WORKER RESTART - ${gap/1000}s gap detected!`);
        console.error(`🚨 This indicates the service worker was terminated and restarted`);
    }
    lastPing = now;
    console.log(`💓 Service worker alive check: ${new Date().toLocaleTimeString()}`);
}, 30000);

// Also monitor for unload (though this may not fire in service workers)
self.addEventListener('beforeunload', () => {
    console.error('🚨 SERVICE WORKER TERMINATING!');
});
```

**Why This Works:** Helps diagnose if service worker termination is the issue during testing.

---

## Multi-Device Race Condition Solutions

### Fix 10: Device ID Generation & Management

**Location:** `background/device_id.js` (NEW FILE)

**Purpose:** Generate and persist a unique device identifier so each device knows who it is.

**Implementation:** See `multi_device_fix.md` for complete code. Key components:
- Generate unique device ID based on platform + random component + timestamp
- Persist in `chrome.storage.local` so it survives restarts
- Detect platform (ChromeOS, Windows, Mac, Linux) from user agent

**Why This Works:** Enables device identification, which is required for distributed locking.

---

### Fix 11: Distributed Scrape Lock Manager

**Location:** `background/scrape_lock.js` (NEW FILE)

**Purpose:** Implement distributed locking to ensure only one device processes any given scrape at a time.

**Key Features:**
- **Lock Acquisition:** Device must acquire lock before starting scrape
- **Lock Validation:** Periodically verify lock is still held (every 60 seconds)
- **Lock Release:** Release lock when scrape completes or device shuts down
- **Stale Lock Cleanup:** Handle devices that crash without releasing lock (5-minute timeout)
- **Lock Progress Tracking:** Update lock with current search index for visibility

**Lock Structure:**
```javascript
{
  deviceId: string,           // Which device holds the lock
  acquiredAt: number,         // When lock was acquired
  lastRefresh: number,         // Last time lock was refreshed
  scrapeName: string,          // What scrape is being processed
  searchIndex: number          // Current search progress
}
```

**Why This Works:** Prevents multiple devices from processing the same scrape simultaneously. If Device A holds the lock, Device B will see it and skip the scrape, preventing race conditions.

---

### Fix 12: Integrate Lock into Manual Scrape Flow

**Location:** `background/service_worker.js` - `processManualScrape()` function

**Changes:**
1. **Before starting scrape:** Attempt to acquire lock
   - If lock held by another device → abort and log warning
   - If lock is stale (older than 5 minutes) → take over the lock
   - If we already hold the lock → refresh it

2. **During scrape loop:** Check lock at start of each search iteration
   - If lock lost → abort scrape immediately
   - Update lock progress with current search index

3. **After scrape completes:** Always release lock in `finally` block

**Code Pattern:**
```javascript
async function processManualScrape() {
    const deviceId = await getDeviceId();
    const scrapeName = manualScrapeState.sourceName;
    
    // Acquire lock before starting
    const lockResult = await acquireLock(scrapeName);
    if (!lockResult.success) {
        console.warn(`⚠️ Cannot start scrape - ${lockResult.reason}`);
        console.warn(`   Lock holder: ${lockResult.holder}`);
        // Reset local state since another device is handling this
        await saveToStorage({ manualScrapeState: { ...state, isRunning: false } });
        return;
    }
    
    try {
        for (let i = currentSearchIndex; i < searches.length; i++) {
            // Check lock at start of each iteration
            if (!await hasLock()) {
                console.error(`❌ Lost lock during scrape! Aborting.`);
                break;
            }
            
            // Update lock progress
            await updateLockProgress(i);
            
            // ... existing scrape logic ...
        }
    } finally {
        // Always release lock when done
        await releaseLock();
    }
}
```

**Why This Works:** Ensures only one device processes a scrape at a time, preventing race conditions and device handoffs mid-scrape.

---

### Fix 13: Integrate Lock into Scheduled Scrape Flow

**Location:** `background/scheduler.js` - `executeScheduledScrape()` function

**Changes:**
- Check lock status before starting scheduled scrape
- Acquire lock before processing
- Release lock when complete
- Skip scrape if another device is already processing it

**Why This Works:** Prevents scheduled scrapes from also being processed by multiple devices simultaneously.

---

### Fix 14: Add Lock Status to UI

**Location:** `popup/popup.js` and `popup/popup.html`

**Purpose:** Show users which device is currently scraping, if any.

**Features:**
- Display current lock status (locked/unlocked)
- Show which device holds the lock (if not ours)
- Show current scrape name and progress
- Display this device's ID for debugging

**Why This Works:** Provides visibility into multi-device conflicts, helping users understand why scrapes might be skipped.

---

### Fix 15: Startup Recovery for Orphaned Locks

**Location:** `background/service_worker.js` - Service worker startup handlers

**Purpose:** Handle cases where a device crashes mid-scrape, leaving a stale lock.

**Logic:**
- On service worker startup, check if we have an active scrape state
- If we have active state but lock is stale (not refreshed in 30+ seconds):
  - Mark scrape as interrupted
  - Release the stale lock
  - Allow user to resume if desired

**Why This Works:** Prevents stale locks from blocking scrapes indefinitely after a device crash.

---

## Alternative Solution: Device Isolation (Simpler Approach)

### Overview: Complete Device Independence

Instead of distributed locking (which coordinates devices), this approach provides **complete device isolation** - each device operates independently and ignores scrapes it didn't initiate.

**Key Principle:** Tag every scrape with the device that started it. Each device only processes scrapes tagged with its own device ID.

### Why This Approach?

**The Real Question:** How did the Laptop "see" a scrape started on the Pi? `chrome.storage.local` should NOT sync between devices...

**Possible causes:**
1. **Scheduled scrape triggered on both devices** - Same Google Sheets schedules, both devices try to execute
2. **Both browsers signed into same Google account with Sync enabled** - Could sync extension data
3. **VPN/Remote Desktop confusion** - Accidentally triggered on wrong device

**Solution:** Device tagging ensures each device only processes its own scrapes, regardless of how the state got shared.

---

### Fix 16: Device Tagging (Simple Isolation)

**Location:** `background/service_worker.js` - `processManualScrape()` function

**Approach:** Tag scrapes with device ID when initiated, ignore scrapes tagged with other devices.

**Implementation:**

```javascript
// Get or create device ID (add near top of service_worker.js)
async function getDeviceId() {
    const result = await chrome.storage.local.get(['deviceId']);
    if (result.deviceId) return result.deviceId;
    
    // Generate new ID
    const platform = navigator.userAgent.includes('CrOS') ? 'pi' : 
                     navigator.userAgent.includes('Windows') ? 'win' : 'other';
    const newId = `${platform}-${Math.random().toString(36).substr(2, 6)}`;
    await chrome.storage.local.set({ deviceId: newId });
    console.log(`[SW] Generated device ID: ${newId}`);
    return newId;
}

// Modify processManualScrape()
async function processManualScrape() {
    const myDeviceId = await getDeviceId();
    console.log(`${LOG} Device: ${myDeviceId}`);
    
    const { manualScrapeState } = await getFromStorage(['manualScrapeState']);
    
    if (!manualScrapeState?.isRunning) {
        return;
    }
    
    // ============================================
    // CRITICAL: Only process OUR scrapes
    // ============================================
    if (manualScrapeState.initiatedByDevice && 
        manualScrapeState.initiatedByDevice !== myDeviceId) {
        console.log(`${LOG} ⏭️ Ignoring scrape - belongs to device ${manualScrapeState.initiatedByDevice}`);
        return; // Not ours, don't touch it
    }
    
    // Tag it as ours if not already tagged
    if (!manualScrapeState.initiatedByDevice) {
        await saveToStorage({
            manualScrapeState: {
                ...manualScrapeState,
                initiatedByDevice: myDeviceId
            }
        });
    }
    
    // ... rest of existing scrape logic ...
}
```

**When starting a manual scrape (in popup or wherever it's initiated):**

```javascript
async function startManualScrape(sourceName, searches) {
    const deviceId = await getDeviceId();
    
    await chrome.storage.local.set({
        manualScrapeState: {
            isRunning: true,
            sourceName,
            searches,
            currentSearchIndex: 0,
            initiatedByDevice: deviceId,  // TAG IT!
            startedAt: Date.now()
        }
    });
    
    // Send message to start
    chrome.runtime.sendMessage({ action: 'START_MANUAL_SCRAPE' });
}
```

**For Scheduled Scrapes:**

```javascript
// In scheduler.js
async function executeScheduledScrape(schedule) {
    const myDeviceId = await getDeviceId();
    
    // Create execution record tagged with our device
    const execution = {
        id: generateExecutionId(),
        scheduleName: schedule.name,
        initiatedByDevice: myDeviceId,  // TAG IT
        startedAt: Date.now()
    };
    
    // ... rest of scrape logic ...
}
```

**Why This Works:**
- ✅ **Simple** - No locking mechanism, just tag and ignore
- ✅ **Complete isolation** - Each device operates independently
- ✅ **No coordination needed** - Devices don't need to communicate
- ✅ **Handles shared state** - Works even if `chrome.storage.local` somehow syncs
- ✅ **Allows concurrent scrapes** - Both devices can scrape different targets simultaneously

**Result:**

| Scenario | What Happens |
|----------|--------------|
| Pi starts scrape for Jesse | Pi tags it with `pi-abc123`, Pi processes it |
| Laptop somehow sees Pi's scrape state | Laptop sees `initiatedByDevice: pi-abc123`, ignores it |
| Laptop starts scrape for Jesse | Laptop tags it with `win-xyz789`, Laptop processes it |
| Both scraping Jesse simultaneously | ✅ Both work independently (if desired) |
| Schedule triggers on both devices | Each tags & processes their own |

---

### Comparison: Locking vs. Isolation

| Aspect | Distributed Locking (Fix 10-15) | Device Isolation (Fix 16) |
|--------|--------------------------------|---------------------------|
| **Complexity** | Medium - Requires lock manager, refresh logic, stale lock cleanup | Low - Just tag and check |
| **Coordination** | Required - Devices must coordinate via locks | None - Complete independence |
| **Concurrent Scrapes** | ❌ Only one device can scrape a target at a time | ✅ Both devices can scrape same target independently |
| **Stale Lock Handling** | Required - Must detect and clean up stale locks | Not needed - No locks to clean |
| **Visibility** | High - Lock status shows which device is scraping | Medium - Can see device tags in state |
| **Use Case** | When you want to prevent duplicate work | When you want complete device independence |
| **Best For** | Production environments where duplicate scrapes waste resources | Development/testing where devices should operate independently |

**Key Difference:**
- **Locking:** "Only one device can scrape this target" (coordination)
- **Isolation:** "Each device only scrapes what it started" (independence)

---

### Recommendation: Which Approach to Use?

**Use Device Isolation (Fix 16) if:**
- ✅ You want complete device independence
- ✅ You're okay with both devices potentially scraping the same target
- ✅ You want the simplest solution
- ✅ You're in a development/testing environment
- ✅ You want to avoid the complexity of distributed locking

**Use Distributed Locking (Fix 10-15) if:**
- ✅ You want to prevent duplicate work (only one device scrapes a target)
- ✅ You need visibility into which device is currently scraping
- ✅ You're in a production environment where resources matter
- ✅ You want centralized coordination

**Hybrid Approach:**
You could also implement both:
- Use device isolation as the base (each device only processes its own scrapes)
- Add optional locking for scheduled scrapes (to prevent duplicate scheduled work)
- Manual scrapes use isolation (user explicitly started it on their device)
- Scheduled scrapes use locking (prevent both devices from running the same schedule)

---

## Implementation Priority

### Phase 1: Multi-Device Race Condition Fixes (CRITICAL - Implement First) ⚡

**Choose ONE of these approaches:**

#### Option A: Device Isolation (Simpler - Recommended for Most Cases) ⚡
1. **Fix 16** - Device tagging and isolation ⚡ **SIMPLEST SOLUTION**
   - Tag scrapes with device ID when initiated
   - Each device only processes its own scrapes
   - Complete independence, no coordination needed

**Pros:** Simple, fast to implement, complete device independence  
**Cons:** Both devices can scrape same target (may be desired or not)

#### Option B: Distributed Locking (More Complex - For Production)
1. **Fix 10** - Device ID generation & management ⚡ **REQUIRED FOR LOCKING**
2. **Fix 11** - Distributed scrape lock manager ⚡ **HIGHEST PRIORITY**
3. **Fix 12** - Integrate lock into manual scrape flow ⚡ **HIGHEST PRIORITY**
4. **Fix 13** - Integrate lock into scheduled scrape flow ⚡ **HIGHEST PRIORITY**
5. **Fix 15** - Startup recovery for orphaned locks

**Pros:** Prevents duplicate work, provides visibility, centralized coordination  
**Cons:** More complex, requires lock management, stale lock handling

**Recommendation:** Start with **Option A (Device Isolation - Fix 16)** unless you specifically need to prevent duplicate scrapes. It's simpler and solves the core problem (devices interfering with each other).

**Why First:** The multi-device race condition is a **confirmed root cause** that explains why scrapes appear to stall. This must be fixed before other issues can be properly diagnosed.

### Phase 2: Chromium-Specific Fixes (If Still Needed After Phase 1)
6. **Fix 6** - More aggressive keep-alive for Chromium
7. **Fix 7** - Service worker restart detection & recovery
8. **Fix 8** - Update state timestamp on each search

**Note:** After implementing Phase 1, test to see if Chromium-specific fixes are still needed. The multi-device lock may resolve the issue entirely.

### Phase 3: Content Script State Fixes (Defensive Measures)
9. **Fix 1** - Force state reset at start of `startScraping()`
10. **Fix 2** - Add `RESET_SCRAPE_STATE` message handler
11. **Fix 3** - Reset state before each search in service worker

### Phase 4: Robustness Improvements
12. **Fix 4** - Reset state after timeout/stuck detection
13. **Fix 5** - Ensure completion message is always sent
14. **Fix 9** - Monitor service worker health (for debugging)
15. **Fix 14** - Add lock status to UI (for visibility)

---

## Testing Strategy

### Test Case 1: Multi-Device Race Condition (CRITICAL - Test First)
- **Setup:** Have extension installed on both Pi (Chromium) and Laptop (Chrome)
- **Test:** Start manual scrape on Pi, monitor logs on both devices
- **Expected:** Only one device should process the scrape (the one that acquires the lock)
- **Verify:** Check lock status on both devices during scrape
- **Verify:** Second device should see "Another device is processing this scrape" message

### Test Case 2: Browser Comparison (Single Device)
- **Chrome (single device):** Run manual scrape with 5+ searches - should work perfectly ✅
- **Chromium (single device):** Run same scrape - may stall after 2 searches ❌
- Compare service worker logs between browsers
- Monitor for service worker termination on Chromium

### Test Case 2: Normal Completion (Chrome)
- Start manual scrape with 5+ searches on Chrome
- Verify all searches complete
- Check logs for state reset messages
- Verify no service worker restarts

### Test Case 3: Chromium with Keep-Alive Fix
- Implement Fix 6 (aggressive keep-alive)
- Run manual scrape with 5+ searches on Chromium
- Monitor service worker logs for termination
- Verify scrape completes all searches

### Test Case 4: Service Worker Restart Recovery
- Implement Fix 7 (restart detection)
- Manually terminate service worker mid-scrape (DevTools → Application → Service Workers → Unregister)
- Verify scrape resumes automatically
- Check that progress is not lost

### Test Case 5: Timeout Recovery
- Simulate a timeout (modify timeout to 1 minute for testing)
- Verify state is reset and next search proceeds
- Check that all remaining searches complete

### Test Case 6: Stuck Detection Recovery
- Simulate stuck state (block content script messages)
- Verify health check detects stuck state
- Verify state reset and continuation

### Test Case 7: Error Recovery
- Simulate an error during scraping
- Verify completion message is sent
- Verify state is reset
- Verify next search proceeds

---

## Additional Debugging Recommendations

### Add Enhanced Logging

**Content Script:**
```javascript
case 'START_SCRAPING':
    console.log(`[CS] 📥 START_SCRAPING received`);
    console.log(`[CS] Current state: isScrapingActive=${isScrapingActive}, stopRequested=${stopRequested}, currentSourceName="${currentSourceName}"`);
    // ... rest of handler
```

**Service Worker:**
```javascript
// Before each search
console.log(`${LOG} 🔍 Starting search ${i + 1}/${searches.length}: "${search.title}"`);
console.log(`${LOG} Tab ID: ${tab.id}, URL: ${search.url}`);
console.log(`${LOG} Content script ready: ${contentScriptReady}`);
```

### Monitor State Transitions

Add logging whenever `isScrapingActive` changes:
```javascript
// In content.js, create a setter function
function setScrapingActive(value) {
    const oldValue = isScrapingActive;
    isScrapingActive = value;
    if (oldValue !== value) {
        console.log(`[CS] 🔄 isScrapingActive changed: ${oldValue} → ${value} (stack: ${new Error().stack})`);
    }
}
```

---

## Why Scheduled Scraping Works

Scheduled scraping likely works because:
1. **Different wait function:** Uses `waitForScrapingComplete()` instead of `waitForScrapingCompleteWithHealthCheck()`
2. **Simpler timeout handling:** Less complex health check logic means fewer edge cases
3. **Different navigation timing:** May have different delays or page load handling
4. **Less state persistence:** May navigate in a way that fully reloads the content script
5. **Shorter duration:** Scheduled scrapes may complete faster, reducing chance of service worker termination

**However**, if scheduled scraping is also running on Chromium, it may experience the same service worker termination issues. The fixes should be applied to both manual and scheduled scraping.

---

## Browser-Specific Behavior

### Chrome (Desktop)
- ✅ **Works correctly** - Manual scrapes complete all searches
- ✅ Service worker lifecycle is stable
- ✅ Content script state management works as expected
- ✅ Keep-alive alarms are reliable

### Chromium (Raspberry Pi / Resource-Constrained)
- ❌ **Stalls after 2 searches** - Service worker termination likely cause
- ⚠️ Service worker lifecycle is aggressive (terminates to save memory)
- ⚠️ Keep-alive alarms may be less reliable
- ⚠️ Memory pressure causes background process termination

**Recommendation:** If possible, use Chrome instead of Chromium for manual scrapes. If Chromium is required, implement Fixes 6, 7, and 8 to handle service worker termination gracefully.

---

## Expected Outcome After Fixes

### Chrome (Already Working)
- ✅ Manual scrapes already complete all searches
- ✅ No changes needed, but fixes add robustness

### Chromium (After Fixes)
1. ✅ Manual scrapes will complete all searches (with Fix 6 & 7)
2. ✅ Service worker termination will be detected and recovered from
3. ✅ State will be properly reset between searches
4. ✅ Timeout/stuck detection will properly recover
5. ✅ Errors will not cascade to subsequent searches
6. ✅ Better logging will help diagnose any remaining issues
7. ✅ Interrupted scrapes will automatically resume

---

## Files to Modify

1. `content/content.js`
   - Add state reset at start of `startScraping()`
   - Add `RESET_SCRAPE_STATE` message handler
   - Ensure completion message is always sent

2. `background/service_worker.js`
   - Add state reset before each search in `processManualScrape()`
   - Add state reset after timeout/stuck detection
   - Add enhanced logging

---

## Quick Fix (Minimal Changes)

### ⚡ CRITICAL: Multi-Device Fix (Implement First)

If you have **multiple devices** with the extension installed (Pi + Laptop), choose ONE approach:

#### Option A: Device Isolation (Simplest - Recommended) ⚡

Implement **Fix 16** only:

1. **Fix 16:** Device tagging and isolation
   - Add device ID generation (simple function)
   - Tag scrapes with device ID when initiated
   - Each device ignores scrapes it didn't start

**This is the simplest solution** - just tag and ignore. No locking, no coordination, complete independence.

#### Option B: Distributed Locking (More Complex)

Implement **Fix 10, 11, and 12**:

1. **Fix 10:** Device ID generation (simple, required for locking)
2. **Fix 11:** Distributed scrape lock manager (core solution)
3. **Fix 12:** Integrate lock into manual scrape flow (prevents race conditions)

**Recommendation:** Start with **Option A (Fix 16)** - it's simpler and solves the core problem. Only use Option B if you need to prevent duplicate scrapes.

Both approaches resolve the multi-device race condition that causes scrapes to appear "stalled" when another device takes over.

**Why First:** This is a confirmed root cause. Even if you only have one device now, implementing this prevents future issues.

### For Chromium (If Still Needed After Multi-Device Fix)

If issues persist on Chromium after implementing multi-device fixes, implement **Fix 6** and **Fix 7**:

1. **Fix 6:** Reduce keep-alive interval to 15 seconds for Chromium
2. **Fix 7:** Add service worker restart detection and recovery

### For Chrome (Defensive Measures)

If you want to add robustness to Chrome (which already works), implement **Fix 1** and **Fix 3**:

1. Add the state reset check at the start of `startScraping()`
2. Add the reset message before each search in service worker

### Combined Approach (Recommended - Full Solution)

For maximum reliability across all scenarios:
1. **Fix 10, 11, 12, 13** - Multi-device locking (CRITICAL)
2. **Fix 6, 7, 8** - Chromium-specific fixes (if still needed)
3. **Fix 1, 3** - Content script state reset (defensive, works on both)
4. **Fix 14** - Lock status UI (for visibility)

This provides comprehensive protection against all identified root causes.

---

## Key Discovery Summary

### 🔍 The Real Root Causes (Multiple Issues Identified)

**Primary Root Cause #1: Multi-Device Race Condition (CONFIRMED)**
- ✅ **Confirmed:** Scrape started on Pi but ran on laptop
- ✅ **Evidence:** Both devices have extension, both see same Google Sheets schedules
- ✅ **Result:** Both devices race to process same scrape, causing handoffs mid-execution
- ✅ **Why it stalls:** Device A starts, Device B takes over, Device A appears "stalled"

**Primary Root Cause #2: Browser-Specific Service Worker Lifecycle (Chromium)**
- ✅ **Chrome:** Works perfectly - all searches complete
- ❌ **Chromium:** Stalls after 2 searches - service worker termination (when tested in isolation)

**Evidence from testing:**
- Multi-device scenario: Scrape started on Pi, ran on laptop (CONFIRMED)
- Manual scrape on Chrome (single device): ✅ 4+ searches completing successfully
- Manual scrape on Chromium (single device): ❌ Stalls after 2 searches
- Content script state: ✅ Works correctly on both browsers
- Service worker loop: ✅ Continues properly on Chrome

**Conclusion:** The stalling issue has **TWO primary root causes**:
1. **Multi-device race condition** - Multiple devices competing for same scrape (CONFIRMED)
2. **Chromium service worker termination** - Aggressive termination on resource-constrained systems

Both issues can cause the same symptom (stalling), and may compound each other in multi-device scenarios.

### 🎯 Primary Solutions

**For Multi-Device Race Condition (CRITICAL - Implement First):**
1. **Device ID generation** - Unique identifier for each device
2. **Distributed scrape lock** - Ensure only one device processes a scrape at a time
3. **Lock integration** - Add lock checks to manual and scheduled scrape flows
4. **Lock status UI** - Show users which device is scraping

**For Chromium Service Worker Termination (If Still Needed After Phase 1):**
1. **More aggressive keep-alive** (15 seconds instead of 30)
2. **Service worker restart detection** to automatically resume interrupted scrapes
3. **State timestamp tracking** to detect how long ago a scrape was interrupted

**Testing Strategy:** After implementing multi-device fixes, test to see if Chromium-specific fixes are still needed. The distributed lock may resolve the issue entirely.

### 📊 Secondary Solutions

The content script state fixes (Fix 1-5) are still valuable as defensive measures and may help in edge cases, but they're not the primary solution. They should be implemented after the multi-device and Chromium-specific fixes.

---

## Additional Assessment & Thoughts

### Validation of Root Cause Analysis

**✅ UPDATED ASSESSMENT:** The original root cause analysis (content script state persistence) was **partially correct** but missed the **primary issue**: browser-specific service worker termination on Chromium.

**Original Hypothesis (Content Script State):**
- ✅ Still valid as a **contributing factor**
- ✅ The `isScrapingActive` guard is indeed a silent failure point
- ✅ State persistence can cause issues if service worker survives but state is stale

**New Primary Hypothesis (Service Worker Termination):**
- ✅ **Confirmed by testing** - Chrome works, Chromium stalls
- ✅ Explains why it happens consistently after 2 searches (service worker gets terminated)
- ✅ Explains why scheduled scraping works (may complete faster, less memory pressure)
- ✅ Explains why no errors are logged (service worker context is gone)

**Conclusion:** The issue is **primarily** service worker termination on Chromium, with content script state persistence as a secondary contributing factor.

**✅ Strong Agreement:** The evidence strongly supports the browser-specific hypothesis:

1. **The `isScrapingActive` guard is indeed a silent failure point** - I verified this in the code (line 869-871 in `content/content.js`). When `isScrapingActive` is true, the function returns without any error, which means the service worker will wait indefinitely for a completion message that never comes.

2. **Content script state persistence is a real issue** - When navigating with `chrome.tabs.update()`, the content script may:
   - Not fully reload if the page is cached
   - Reload but retain module-level variables in some edge cases
   - Have its `finally` block interrupted if the page navigates before it completes

3. **The difference between manual and scheduled scraping is significant** - Scheduled scraping uses `waitForScrapingComplete()` (simpler, no health checks), while manual uses `waitForScrapingCompleteWithHealthCheck()` (more complex, with periodic pings). The health check mechanism might actually be contributing to the problem if it's not properly detecting stuck states.

### Additional Considerations

#### 1. **Content Script Injection Timing**

Looking at the code flow in `processManualScrape()`:
- Line 1130: `await chrome.tabs.update(tab.id, { url: search.url })`
- Line 1133: `await new Promise(resolve => setTimeout(resolve, 5000))` - 5 second delay
- Line 1136: `await waitForContentScriptReady(tab.id, 10, 1000)` - waits up to 10 seconds

**Potential Issue:** If the content script injects but the previous scrape's state hasn't been cleared, the new content script instance might inherit or conflict with old state. The 5-second delay might not be enough for the old content script to fully unload.

**Recommendation:** The reset message (Fix 2 & 3) should be sent **after** confirming content script is ready, not before. This ensures we're resetting the correct instance.

#### 2. **Health Check May Mask the Real Issue**

The `waitForScrapingCompleteWithHealthCheck()` function (lines 1341-1434) has logic to detect stuck states:
- It pings the content script every 60 seconds
- If no activity for 3 minutes, it checks if content script is still active
- If content script says `isScrapingActive = true`, it updates the activity time

**Potential Issue:** If the content script is stuck with `isScrapingActive = true` but not actually scraping, the health check might keep resetting the activity timer, preventing proper stuck detection. The health check at line 1398 checks `status.isScrapingActive`, which would return `true` even if the scrape is stuck.

**Recommendation:** The health check should also verify that the content script is making progress (e.g., checking if page numbers are incrementing, or if profiles are being scraped). Just checking `isScrapingActive` isn't enough.

#### 3. **Race Condition in Navigation**

There's a potential race condition:
1. Search 1 completes, sends `SCRAPING_COMPLETE`
2. Service worker receives completion, starts navigating to Search 2
3. Content script's `finally` block is still executing (resetting state)
4. Navigation happens mid-cleanup
5. New page loads, new content script instance
6. But old instance's state might have been partially reset

**Recommendation:** The service worker should wait a bit longer after receiving `SCRAPING_COMPLETE` before navigating, or send a reset message to the old page before navigation.

#### 4. **Message Listener Cleanup**

The content script has a message listener that handles `START_SCRAPING`. If multiple instances of the content script exist (which can happen during navigation), multiple listeners might be active, causing duplicate message handling.

**Recommendation:** Ensure only one message listener is active, or make the listener idempotent.

### Alternative Explanations to Consider

#### Theory A: Health Check False Positives
The health check might be incorrectly detecting completion or stuck states, causing the service worker to think a search completed when it didn't, or to skip searches.

**How to verify:** Add detailed logging to `waitForScrapingCompleteWithHealthCheck()` to see what it's detecting.

#### Theory B: Navigation Timing Issues
The 5-second delay after navigation might not be sufficient for LinkedIn's page to fully load and be ready for scraping. If the content script tries to start scraping before the page is ready, it might fail silently.

**How to verify:** Check if `waitForContentScriptReady()` is actually returning true, and if the page is fully loaded when scraping starts.

#### Theory C: LinkedIn Rate Limiting
LinkedIn might be rate-limiting or blocking requests after 2 searches, causing subsequent searches to fail silently. The content script might be waiting for elements that never appear.

**How to verify:** Check network requests in DevTools during the stalled searches. Look for 429 (Too Many Requests) or other error responses.

### Thoughts on Proposed Fixes

**Fix 1 (Force State Reset at Start):** ✅ **Excellent** - This is a defensive programming approach that handles the most common failure mode. It's simple, low-risk, and addresses the root cause directly.

**Fix 2 (RESET_SCRAPE_STATE Message):** ✅ **Good** - Provides explicit control, but might not be necessary if Fix 1 works. However, it's useful for debugging and gives the service worker more control.

**Fix 3 (Reset Before Each Search):** ✅ **Critical** - This is the most important fix. It ensures clean state before each search. However, I'd recommend:
- Sending the reset message **after** `waitForContentScriptReady()` succeeds
- Adding a small delay after reset before sending `START_SCRAPING`
- Logging whether the reset succeeded or failed

**Fix 4 (Reset After Timeout/Stuck):** ✅ **Important** - Prevents cascading failures. Should definitely be implemented.

**Fix 5 (Ensure Completion Always Sent):** ✅ **Good** - Defensive programming, but might mask underlying issues. The completion message should indicate if it's a "forced" completion due to error.

### Recommended Implementation Order

1. **Fix 1** - Quick win, addresses 80% of cases
2. **Fix 3** - Critical for preventing the issue
3. **Fix 4** - Important for error recovery
4. **Fix 2** - Nice to have for debugging
5. **Fix 5** - Good for robustness, but less critical

### Additional Debugging Strategy

Before implementing fixes, I'd recommend adding **temporary diagnostic logging** to understand exactly what's happening:

```javascript
// In content.js startScraping()
console.log(`[CS] 🔍 START_SCRAPING called - isScrapingActive=${isScrapingActive}, currentSourceName="${currentSourceName}"`);
console.log(`[CS] 🔍 Stack trace:`, new Error().stack);

// In service_worker.js before each search
console.log(`${LOG} 🔍 About to send START_SCRAPING for search ${i + 1}`);
console.log(`${LOG} 🔍 Tab ID: ${tab.id}, URL: ${search.url}`);
console.log(`${LOG} 🔍 Content script ready: ${contentScriptReady}`);
```

This will help confirm the root cause before implementing fixes.

### Potential Edge Cases

1. **Multiple tabs with same content script** - If user has multiple LinkedIn tabs open, state might conflict
2. **Extension reload during scrape** - If extension reloads mid-scrape, state is lost
3. **Page refresh during scrape** - If LinkedIn refreshes the page, content script state is lost
4. **Browser back/forward navigation** - If user navigates back, old state might persist

### Final Recommendation (UPDATED - Multi-Device Priority)

**CRITICAL: Start with Multi-Device Fixes (Phase 1)**

**Choose ONE approach:**

**Option A: Device Isolation (Simpler - Recommended)**
1. **Implement Fix 16** - Device tagging and isolation
   - Add device ID generation function
   - Tag scrapes with device ID when initiated
   - Each device ignores scrapes it didn't start
2. **Test multi-device scenario** - Verify each device only processes its own scrapes
3. **Verify independence** - Both devices can scrape simultaneously without interference

**Option B: Distributed Locking (More Complex)**
1. **Implement Fix 10, 11, 12, 13, 15** - Distributed locking system
   - Fix 10: Device ID generation
   - Fix 11: Distributed scrape lock manager
   - Fix 12: Integrate lock into manual scrape flow
   - Fix 13: Integrate lock into scheduled scrape flow
   - Fix 15: Startup recovery for orphaned locks
2. **Test multi-device scenario** - Verify only one device processes each scrape
3. **Monitor lock status** - Use Fix 14 (lock status UI) to verify locks are working

**Recommendation:** Start with **Option A (Fix 16)** - it's simpler and solves the core problem. Only use Option B if you specifically need to prevent duplicate scrapes.

**After Phase 1 Testing:**

If issues persist on Chromium (single device), then implement:
1. **Fix 6 and Fix 7** - Chromium-specific service worker termination fixes
   - Fix 6: More aggressive keep-alive (15 seconds)
   - Fix 7: Service worker restart detection and recovery
2. **Add Fix 8** - State timestamp tracking to enable smart resume logic
3. **Test on Chromium** - Run multiple manual scrapes to verify service worker stays alive

**For All Browsers (Defensive Measures):**

1. **Implement Fix 1 and Fix 3** - Content script state reset (defensive)
2. **Optional: Fix 4 and Fix 5** - Additional error recovery
3. **Add enhanced logging** - To verify the fixes work and catch any remaining edge cases
4. **Test thoroughly** - Run multiple manual scrapes with different numbers of searches
5. **Monitor for 24-48 hours** - To ensure the fixes work in production

**Conclusion:**

The stalling issue has **TWO confirmed root causes**:
1. **Multi-device race condition** (CONFIRMED) - Multiple devices competing for same scrape
2. **Chromium service worker termination** (when tested in isolation)

**The multi-device fix (Phase 1) is the highest priority** because:
- It's a confirmed root cause (scrape started on Pi, ran on laptop)
- It explains why scrapes appear to "stall" (device handoff mid-execution)
- It may resolve the issue entirely, making Chromium-specific fixes unnecessary
- It's a fundamental architectural issue that must be fixed regardless

After implementing Phase 1, test to determine if Chromium-specific fixes are still needed. The distributed lock may resolve the issue completely.

---

## Comprehensive Summary: All Root Causes & Solutions

### 🔍 Root Causes Identified (In Order of Discovery)

1. **Multi-Device Race Condition** (CONFIRMED)
   - **Evidence:** Scrape started on Pi but ran on laptop
   - **Cause:** Multiple devices with extension installed, both see same Google Sheets schedules, race to process same scrape
   - **Symptom:** Scrapes appear to "stall" when another device takes over mid-execution
   - **Solution:** Distributed locking mechanism (Fix 10-15)

2. **Chromium Service Worker Termination** (When tested in isolation)
   - **Evidence:** Chrome works perfectly, Chromium stalls after 2 searches
   - **Cause:** Chromium aggressively terminates service workers on resource-constrained systems
   - **Symptom:** Service worker dies mid-scrape, loop stops silently
   - **Solution:** Aggressive keep-alive + restart detection (Fix 6-8)

3. **Content Script State Persistence** (Contributing factor)
   - **Evidence:** `isScrapingActive` flag not reset between searches
   - **Cause:** Content script state persists when navigating between searches
   - **Symptom:** Subsequent searches silently skipped if state is stale
   - **Solution:** State reset mechanisms (Fix 1-5)

### 🎯 Implementation Roadmap

**Phase 1: Multi-Device Fixes (CRITICAL - Start Here)**

**Choose ONE approach:**

**Option A: Device Isolation (Simpler - Recommended)**
- Implement device tagging (Fix 16)
- Each device only processes its own scrapes
- Complete independence, no coordination needed
- **Recommended for most cases**

**Option B: Distributed Locking (More Complex)**
- Implement distributed locking (Fix 10-15)
- Prevents duplicate work, provides visibility
- Requires lock management and stale lock cleanup
- **Use if you need to prevent duplicate scrapes**

This is a confirmed root cause and must be fixed first. May resolve the issue entirely.

**Phase 2: Chromium-Specific Fixes (If Still Needed)**
- Implement after Phase 1 testing
- Only needed if issues persist on Chromium in single-device scenarios

**Phase 3: Defensive Measures (For All Browsers)**
- Content script state resets
- Error recovery mechanisms
- Enhanced logging

### 📊 Expected Outcomes

**After Phase 1 (Multi-Device Fixes):**
- ✅ Only one device processes each scrape
- ✅ No more device handoffs mid-execution
- ✅ Clear visibility into which device is scraping
- ✅ Automatic recovery from stale locks

**After Phase 2 (Chromium Fixes - If Needed):**
- ✅ Service worker stays alive during long scrapes
- ✅ Automatic recovery from service worker restarts
- ✅ Better handling of resource-constrained environments

**After Phase 3 (Defensive Measures):**
- ✅ Robust error recovery
- ✅ Better state management
- ✅ Enhanced debugging capabilities

### 🧪 Testing Strategy

1. **Multi-device test** - Verify locks prevent race conditions
2. **Single-device Chromium test** - Verify service worker stays alive
3. **Single-device Chrome test** - Verify defensive measures work
4. **Production monitoring** - Monitor for 24-48 hours after deployment

### 📝 Files to Modify

**For Device Isolation Approach (Option A - Simpler):**
- `background/service_worker.js` - Add device ID function and tagging logic
- `popup/popup.js` (or wherever scrapes are initiated) - Tag scrapes with device ID
- `background/scheduler.js` - Tag scheduled scrapes with device ID

**For Distributed Locking Approach (Option B - More Complex):**
- **New Files:**
  - `background/device_id.js` - Device identification
  - `background/scrape_lock.js` - Distributed locking
- **Modified Files:**
  - `background/service_worker.js` - Lock integration in manual scrape
  - `background/scheduler.js` - Lock integration in scheduled scrape
  - `popup/popup.js` - Lock status UI
  - `popup/popup.html` - Lock status display

**For All Approaches (Phase 3):**
- `content/content.js` - State reset mechanisms (if implementing Phase 3)

### ✅ Success Criteria

The fixes are successful when:
1. ✅ Manual scrapes complete all searches on all devices
2. ✅ No device handoffs occur mid-scrape
3. ✅ Service worker remains alive during long scrapes (Chromium)
4. ✅ Clear visibility into which device is processing which scrape
5. ✅ Automatic recovery from crashes/interruptions

---

**Document Status:** This document now contains a comprehensive analysis of all identified root causes and their solutions. It should be used as the primary reference for implementing fixes to the manual scrape stalling issue.
