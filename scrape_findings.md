# Scrape Queue Investigation Findings

## Executive Summary

The Chrome extension's scraping system has **multiple race conditions** causing duplicate processing of queue items. The primary issues are:

1. **No lock mechanism** in `processQueue()` - multiple concurrent calls process the same items
2. **Queue process alarm fires every 60 seconds** without checking if processing is already in progress
3. **Immediate queue processing** after adding items can overlap with alarm-triggered processing
4. **Items are only removed from queue AFTER processing completes** - creating a window for duplicate processing

---

## Part 1: Queue Processing Race Condition

### Question 1.1: How items are marked as "in progress" or "completed"

**Location:** `background/sync_queue.js`, lines 121-291

**Findings:**
- **NO lock mechanism exists** - items are not marked as "in progress"
- Items are processed in a loop (line 135) and only removed from the queue AFTER successful processing (line 278)
- The queue is read at the start (line 122), processed, and then saved back with only remaining items (line 278)
- **Critical Issue:** If `processQueue()` is called twice simultaneously, both calls will read the same queue state and process the same items

**Code Flow:**
```javascript
// Line 122: Read queue
const queue = await getQueue();

// Line 135: Process each item
for (const item of queue) {
    // Process item...
    // If successful, item is NOT added to remainingQueue
}

// Line 278: Save only remaining items (failed/retry items)
await saveQueue(remainingQueue);
```

**Problem:** There's a race condition window between reading the queue and saving it. If two `processQueue()` calls happen simultaneously:
1. Both read the same queue state
2. Both process all items
3. Both save the queue (last write wins, but items were already processed twice)

### Question 1.2: Duplicate trigger pattern

**Location:** `background/service_worker.js`, lines 342-355 and 1780-1783

**Findings:**
The duplicate trigger originates from **two sources**:

1. **Alarm-triggered processing** (line 342-355):
   - `QUEUE_PROCESS` alarm fires every 60 seconds (from `CONFIG.QUEUE_PROCESS_INTERVAL_MINUTES: 1.0`)
   - No check if processing is already in progress
   - Directly calls `processQueue()`

2. **Immediate processing after adding items** (line 1783):
   - When `DATA_SCRAPED` message is received, items are added to queue (line 1780)
   - Immediately triggers `processQueue()` (line 1783) without awaiting completion
   - This can overlap with alarm-triggered processing

**Example Race Condition:**
```
Time 0:00 - Alarm fires → processQueue() starts (reads queue with 1 item)
Time 0:00 - DATA_SCRAPED received → addToQueue() → processQueue() starts (reads same queue with 1 item)
Time 0:01 - First processQueue() completes → saves empty queue
Time 0:01 - Second processQueue() completes → saves empty queue (but item was processed twice!)
```

### Question 1.3: All callers of processQueue

**Documented Callers:**

1. **Alarm Handler** (`service_worker.js:345`)
   - Trigger: `QUEUE_PROCESS` alarm (every 60 seconds)
   - No debouncing or mutex protection
   - No check if already processing

2. **Message Handler** (`service_worker.js:1783`)
   - Trigger: `DATA_SCRAPED` message (when content script sends scraped data)
   - Fire-and-forget (`.catch()` only)
   - No check if already processing

**No Protection Mechanisms:**
- ❌ No mutex/lock flag
- ❌ No debouncing
- ❌ No "processing in progress" check
- ❌ No queue item locking

**Comparison:** The `WORKBOOK_SYNC` alarm (line 360-366) has protection:
```javascript
if (ars?.isRunning || mss?.isRunning) {
    console.log(`${LOG} ⏸️ Skipping sync - scrape in progress`);
    break;
}
```
But `QUEUE_PROCESS` alarm has no such check.

---

## Part 2: Service Worker Tick Interference

### Question 2.1: Tick/alarm handlers interval and guards

**Location:** `background/service_worker.js`, lines 321-355

**Findings:**

**Queue Process Alarm:**
- **Interval:** Every 60 seconds (`CONFIG.QUEUE_PROCESS_INTERVAL_MINUTES: 1.0`)
- **Guard:** ❌ **NONE** - No check if processing is already in progress
- **Code:** Lines 342-355

**Schedule Check Alarm:**
- **Interval:** Every 60 seconds (`CONFIG.SCHEDULE_CHECK_INTERVAL_MINUTES: 1`)
- **Guard:** ✅ **YES** - Checks if scrape is running (line 383-384)
- **Code:** Lines 379-448

**Comparison:**
```javascript
// QUEUE_PROCESS - NO GUARD
case ALARM_NAMES.QUEUE_PROCESS:
    console.log(`${LOG} Queue process tick`);
    const result = await processQueue(); // No check!

// SCHEDULE_CHECK - HAS GUARD
case ALARM_NAMES.SCHEDULE_CHECK:
    const currentState = await getFromStorage(['autoRunState', 'manualScrapeState']);
    const isRunning = currentState.autoRunState?.isRunning || currentState.manualScrapeState?.isRunning;
    if (isRunning) { /* skip */ }
```

### Question 2.2: Skipping logic for queue processor

**Location:** `background/scheduler.js`, line 427

**Findings:**
- The scheduler has skip logic: `Skipping ${schedule.sourceName} - currently running` (line 427)
- **The queue processor has NO equivalent protection**
- The queue processor will process items even if a scrape is actively running
- This means queue processing can happen DURING active scrapes, potentially causing interference

**Missing Protection:**
The queue processor should check:
```javascript
// This check exists for SCHEDULE_CHECK but NOT for QUEUE_PROCESS
const { autoRunState, manualScrapeState } = await getFromStorage(['autoRunState', 'manualScrapeState']);
if (autoRunState?.isRunning || manualScrapeState?.isRunning) {
    // Skip or defer queue processing
}
```

### Question 2.3: Flag check at line 365

**Location:** `background/service_worker.js`, line 365

**Findings:**
- **Flag checked:** `ars?.isRunning || mss?.isRunning`
- **Purpose:** Prevents workbook sync during active scrapes
- **Timing issue:** The flag is set/cleared at scrape start/end, but there's a potential timing window:
  - Flag is set to `true` when scrape starts
  - Flag is cleared when scrape completes
  - **BUT:** Queue processing can start BEFORE the flag is set, or AFTER it's cleared but before cleanup completes
  - **AND:** Queue processing itself doesn't check this flag

**The Problem:**
- Queue processing doesn't respect the `isRunning` flag
- Even if the flag check existed, there's still a race condition within `processQueue()` itself

---

## Part 3: Search Sequence Execution

### Question 3.1: Search execution flow and delays

**Location:** `background/service_worker.js`, lines 1213-1354

**Findings:**
- **Sequential execution:** Searches are processed in a `for` loop (line 1213)
- **Delay mechanism:** Uses `setTimeout` with random delay (45-90 seconds) between searches (line 1348)
- **Delay-based, not completion-based:** The delay is fixed, not dependent on queue processing completion
- **Queue processing during delays:** The queue process alarm continues firing every 60 seconds during these delays

**Code Flow:**
```javascript
for (let i = 0; i < searches.length; i++) {
    // Process search i
    await waitForScrapingCompleteWithHealthCheck(...);
    
    // Delay before next search (45-90 seconds)
    const delay = getSearchDelay(); // 60-120 seconds
    await new Promise(resolve => setTimeout(resolve, delay));
}
```

**Issue:** Queue processing happens multiple times during the delay period, potentially processing the same items multiple times.

### Question 3.2: Search queue management

**Location:** `background/service_worker.js`, lines 1213-1354

**Findings:**
- **Single sequential loop:** Searches are processed one at a time in a `for` loop
- **No parallel dispatch:** Searches cannot overlap
- **BUT:** Queue processing is independent and can happen during search transitions

**Architecture:**
- Search execution: Sequential, controlled by service worker
- Queue processing: Independent, triggered by alarm or immediate call
- **No coordination** between the two systems

### Question 3.3: Queue processing during search transitions

**Location:** `background/service_worker.js`, lines 1340-1348

**Findings:**
- Queue processing **should NOT be paused** during search transitions (it's independent)
- **HOWEVER:** Queue processing should be protected from race conditions
- The issue is not that queue processing happens during transitions, but that it can process the same items multiple times

**Recommendation:**
- Queue processing can continue during search transitions
- But it needs proper locking to prevent duplicate processing

---

## Part 4: BigQuery Double-Sync

### Question 4.1: BigQuery sync being called multiple times

**Location:** `background/sync_queue.js`, lines 162-190

**Findings:**
- `syncProfilesToBigQuery` is called from `processQueue()` (line 169)
- If `processQueue()` runs twice for the same queue item, BigQuery sync will execute twice
- **No deduplication:** The function doesn't check if profiles were already synced
- **Same `advisorIds` array appears twice:** This happens when the same queue item is processed twice

**Call Chain:**
```
processQueue() (line 121)
  → for each item (line 135)
    → syncProfilesToBigQuery() (line 169)
      → callAppsScriptWebApp('sync_profiles', ...) (bigquery_sync.js:154)
```

**If processQueue() runs twice:**
- First call: Processes item → syncs to BigQuery → removes from queue
- Second call: Reads queue (but item might still be there if first call hasn't saved yet) → syncs again

### Question 4.2: Call chain execution path

**Location:** `background/sync_queue.js`, lines 162-190

**Findings:**
- **Single path:** There's only one code path that calls BigQuery sync
- **But:** This path can be executed multiple times for the same item due to race conditions
- **No idempotency check:** The sync doesn't verify if data was already synced

**Execution Path:**
```
sync_queue.js:162 → [QUEUE] 🔄 Syncing X profiles to BigQuery
  → bigquery_sync.js:129 → [BIGQUERY] Syncing X profiles
    → bigquery_sync.js:163 → [BIGQUERY] 📊 Sync result
```

**The issue:** This path executes twice for the same item when `processQueue()` is called concurrently.

### Question 4.3: Observation recording

**Location:** `background/sync_queue.js`, lines 180-190

**Findings:**
- Observations are recorded after BigQuery sync (line 182)
- **If BigQuery sync runs twice, observations are recorded twice**
- This causes duplicate records in the database
- **No deduplication:** The observation recording doesn't check for existing records

**Code:**
```javascript
await bigquerySync.recordSearchObservations(
    null, // scrapeRunId
    recruiterId,
    null, // searchId
    null, // searchJobTitle
    item.rows,
    result.advisorIds
);
```

**Problem:** If this executes twice for the same item, duplicate observations are created.

---

## Part 5: State Management

### Question 5.1: Global/module-level state variables

**Location:** Multiple files

**Findings:**

**Queue State:**
- Stored in Chrome storage: `STORAGE_KEYS.SYNC_QUEUE`
- **No in-memory lock flag** for processing state
- **No "processing" indicator** on queue items

**Scrape State:**
- `autoRunState.isRunning` (service_worker.js:74)
- `manualScrapeState.isRunning` (service_worker.js:80)
- Stored in Chrome storage
- **Used for workbook sync protection, but NOT for queue processing**

**Queue Processing State:**
- ❌ **NONE** - No flag indicating if queue is being processed
- This is the root cause of the race condition

### Question 5.2: Async/await usage

**Location:** `background/service_worker.js`, line 1783

**Findings:**
- **Fire-and-forget call:** `processQueue().catch(e => console.error(...))`
- The call is not awaited, allowing it to run concurrently with alarm-triggered processing
- **This is intentional** (non-blocking), but creates race condition risk

**Code:**
```javascript
await addToQueue(rows, workbookId, tabName);
// Trigger immediate queue processing
processQueue().catch(e => console.error(`${LOG} Queue error:`, e));
// Continues immediately without waiting
```

**Issue:** If the alarm fires at the same time, both calls process the queue concurrently.

### Question 5.3: Parallel vs sequential processing

**Location:** `background/sync_queue.js`, lines 135-275

**Findings:**
- **Sequential processing:** Items are processed one at a time in a `for` loop (line 135)
- **Sheets and BigQuery sync:** Both are awaited sequentially (lines 138, 169)
- **No parallel processing:** This is correct - items should be processed sequentially
- **BUT:** Multiple `processQueue()` calls can run in parallel, each processing the same items

**Current Flow:**
```javascript
for (const item of queue) {
    await appendRowsToTab(...);        // Sequential
    await syncProfilesToBigQuery(...);  // Sequential
}
```

**The issue:** Not the processing order, but that multiple `processQueue()` calls can run concurrently.

---

## Part 6: Specific Code Locations

### File: `sync_queue.js` (lines 113-130)

**Queue Item Creation:**
- Items are created with unique IDs (line 100: `generateQueueId()`)
- Items are added to queue immediately (line 110)
- **No "processing" flag** is set on items

**Issue:** Items have no state to indicate they're being processed.

### File: `sync_queue.js` (lines 128-150)

**Processing Loop:**
- Reads entire queue at start (line 122)
- Processes each item (line 135)
- **No lock acquired** before processing
- **No item-level locking**

**Issue:** Multiple calls can read the same queue state simultaneously.

### File: `sync_queue.js` (lines 150-190)

**BigQuery Sync Trigger:**
- Called for each successfully synced item (line 169)
- **No check if already synced**
- **No idempotency**

**Issue:** Can be called multiple times for the same item.

### File: `sync_queue.js` (line 285)

**Queue Completion Handler:**
- Logs completion stats
- **Does not set any "processing complete" flag**
- **Does not prevent concurrent processing**

**Issue:** No signal that processing is done, allowing new processing to start immediately.

### File: `service_worker.js` (lines 343-380)

**Tick Handlers:**
- `QUEUE_PROCESS` alarm: No guard (line 342-355)
- `SCHEDULE_CHECK` alarm: Has guard (line 383-384)
- `WORKBOOK_SYNC` alarm: Has guard (line 360-366)

**Issue:** Inconsistent protection - queue processing is unprotected.

### File: `service_worker.js` (lines 1274-1399)

**Search Completion:**
- Sequential search processing
- Delays between searches (45-90 seconds)
- **Queue processing continues independently during delays**

**Issue:** Queue processing can overlap with search transitions, but the real issue is the race condition within queue processing itself.

### File: `bigquery_sync.js` (lines 129-190)

**Profile Sync Logic:**
- No idempotency check
- No deduplication
- **Assumes single execution per item**

**Issue:** Not designed to handle duplicate calls.

### File: `scheduler.js` (line 427)

**Skip Logic:**
- Checks if scrape is running before processing schedule
- **Queue processor has no equivalent check**

**Issue:** Inconsistent protection patterns.

---

## Root Cause Analysis

### Primary Root Cause: **Race Condition in `processQueue()`**

**The Problem:**
1. `processQueue()` reads the queue from storage
2. Processes all items
3. Saves the updated queue back to storage
4. **No lock prevents concurrent execution**

**Race Condition Scenario:**
```
Time T0: Alarm fires → processQueue() starts
  → Reads queue: [item1, item2]
  
Time T1: DATA_SCRAPED message → processQueue() starts (concurrent)
  → Reads queue: [item1, item2] (same state!)
  
Time T2: First processQueue() processes item1
  → Syncs to Sheets ✅
  → Syncs to BigQuery ✅
  
Time T3: Second processQueue() processes item1 (DUPLICATE!)
  → Syncs to Sheets ✅ (duplicate)
  → Syncs to BigQuery ✅ (duplicate)
  
Time T4: First processQueue() saves queue: [item2]
Time T5: Second processQueue() saves queue: [item2] (overwrites)
```

**Result:** Item1 is processed twice, causing duplicate data in Sheets and BigQuery.

### Secondary Issues:

1. **No processing lock flag** - Can't detect if processing is in progress
2. **Alarm fires without guard** - Unlike other alarms that check `isRunning`
3. **Immediate processing overlaps** - Fire-and-forget call can overlap with alarm
4. **No item-level locking** - Items have no "processing" state

---

## Recommended Fixes

### Fix 1: Add Processing Lock (CRITICAL)

**Location:** `background/sync_queue.js`

**Implementation:**
```javascript
let isProcessingQueue = false;

export async function processQueue() {
    // Acquire lock
    if (isProcessingQueue) {
        console.log(`${LOG} ⏸️ Queue processing already in progress, skipping`);
        return { synced: 0, failed: 0, pending: 0 };
    }
    
    isProcessingQueue = true;
    
    try {
        const queue = await getQueue();
        // ... existing processing logic ...
    } finally {
        isProcessingQueue = false;
    }
}
```

**Why:** Prevents concurrent execution of `processQueue()`.

### Fix 2: Add Alarm Guard

**Location:** `background/service_worker.js`, line 342

**Implementation:**
```javascript
case ALARM_NAMES.QUEUE_PROCESS:
    console.log(`${LOG} Queue process tick`);
    try {
        // Check if already processing (using storage-based flag for service worker restarts)
        const { queueProcessing } = await getFromStorage(['queueProcessing']);
        if (queueProcessing?.isProcessing) {
            console.log(`${LOG} ⏸️ Queue processing already in progress, skipping alarm`);
            break;
        }
        
        // Set flag
        await saveToStorage({ queueProcessing: { isProcessing: true, startedAt: Date.now() } });
        
        try {
            const result = await processQueue();
            // ... existing code ...
        } finally {
            // Clear flag
            await saveToStorage({ queueProcessing: { isProcessing: false } });
        }
    } catch (e) {
        console.error(`${LOG} Queue process error:`, e);
        await saveToStorage({ queueProcessing: { isProcessing: false } });
    }
    break;
```

**Why:** Prevents alarm from triggering processing if it's already running.

### Fix 3: Make Immediate Processing Respect Lock

**Location:** `background/service_worker.js`, line 1783

**Implementation:**
```javascript
case MESSAGE_ACTIONS.DATA_SCRAPED: {
    // ... existing code ...
    await addToQueue(rows, workbookId, tabName);
    
    // Check if processing is already in progress before triggering
    const { queueProcessing } = await getFromStorage(['queueProcessing']);
    if (!queueProcessing?.isProcessing) {
        // Trigger immediate queue processing only if not already processing
        processQueue().catch(e => console.error(`${LOG} Queue error:`, e));
    } else {
        console.log(`${LOG} Queue processing in progress, alarm will handle new items`);
    }
    
    response = { success: true, queued: rows.length };
    break;
}
```

**Why:** Prevents immediate processing from overlapping with alarm-triggered processing.

### Fix 4: Add Item-Level Processing State (OPTIONAL - More Robust)

**Location:** `background/sync_queue.js`

**Implementation:**
- Add `processing: boolean` and `processingStartedAt: timestamp` to queue items
- Check and set this flag before processing each item
- Skip items that are marked as processing (unless stale > 5 minutes)

**Why:** Provides finer-grained protection, but Fix 1-3 should be sufficient.

### Fix 5: Add Idempotency to BigQuery Sync (DEFENSE IN DEPTH)

**Location:** `background/bigquery_sync.js` or Apps Script

**Implementation:**
- Check if profiles were already synced before syncing
- Use unique identifiers (LinkedIn URL + recruiter ID) to detect duplicates
- Skip if already exists

**Why:** Defense in depth - even if race condition occurs, prevents duplicate data.

---

## Testing Strategy

### Test 1: Concurrent Processing Prevention

**Steps:**
1. Add 1 item to queue
2. Manually trigger `processQueue()` twice simultaneously (via console)
3. **Expected:** Only one execution processes the item, second is skipped
4. **Verify:** Item appears in Sheets/BigQuery only once

### Test 2: Alarm + Immediate Processing

**Steps:**
1. Set alarm to fire in 1 second
2. Immediately add item to queue (triggers immediate processing)
3. **Expected:** One of the two processes the item, other is skipped
4. **Verify:** No duplicate data

### Test 3: Rapid Item Addition

**Steps:**
1. Rapidly add 10 items to queue (simulating fast scraping)
2. **Expected:** All items processed exactly once
3. **Verify:** No duplicates in Sheets/BigQuery

### Test 4: Service Worker Restart During Processing

**Steps:**
1. Start queue processing
2. Simulate service worker restart (reload extension)
3. **Expected:** Processing flag is cleared, new processing can start
4. **Verify:** Items are not lost, eventually processed

### Test 5: Long-Running Processing

**Steps:**
1. Add item that takes 2+ minutes to process (simulate slow network)
2. Trigger alarm during processing
3. **Expected:** Alarm-triggered processing is skipped
4. **Verify:** Item processed only once

---

## Summary

The duplicate processing issue is caused by a **race condition in `processQueue()`** that allows multiple concurrent executions to process the same queue items. The fixes above add proper locking mechanisms to prevent this race condition while maintaining the system's responsiveness.

**Priority:**
1. **Fix 1 (Processing Lock)** - CRITICAL - Prevents race condition
2. **Fix 2 (Alarm Guard)** - HIGH - Prevents alarm interference
3. **Fix 3 (Immediate Processing Guard)** - HIGH - Prevents overlap
4. **Fix 4 (Item-Level Locking)** - OPTIONAL - Extra protection
5. **Fix 5 (Idempotency)** - DEFENSE IN DEPTH - Prevents duplicates even if race occurs

---

## Part 7-12: Follow-Up Investigation Findings

### Part 7: Service Worker Persistence Issues

#### Question 7.1: Variable-Based Lock Won't Survive Restarts

**Location:** `background/service_worker.js`, lines 305-317

**Findings:**

1. **Service Worker Termination:**
   - ❌ **No `chrome.runtime.onSuspend` handler** found in the codebase
   - Service workers are **ephemeral** - Chrome can terminate them at any time when idle
   - On Chromium (especially Raspberry Pi), service workers are terminated more aggressively due to memory constraints
   - **Evidence:** Documentation in `manual_scrape_issue.md` confirms service worker termination is a known issue on Chromium

2. **Keep-Alive Mechanism:**
   - ✅ **Keep-alive alarm exists** (line 307-309): `ALARM_NAMES.KEEPALIVE` fires every 30 seconds (`CONFIG.KEEPALIVE_INTERVAL_MINUTES: 0.5`)
   - **Purpose:** Prevents service worker from being terminated during active scrapes
   - **Limitation:** Keep-alive only works if the alarm handler is registered and firing
   - **Issue:** If service worker is terminated mid-`processQueue()`, the in-memory lock (`isProcessingQueue`) is lost

3. **What Happens to In-Flight Calls:**
   - When service worker terminates, all in-flight async operations are **aborted**
   - `processQueue()` execution stops mid-way
   - Queue items being processed are **not removed** from the queue (because `saveQueue()` never executes)
   - **Result:** Items remain in queue and will be processed again when service worker restarts

4. **Storage-Based Lock Recommendation:**
   - ✅ **YES** - Lock should be stored in `chrome.storage.local` instead of a variable
   - **Reason:** Storage persists across service worker restarts
   - **Stale Lock Handling:** Use timestamp-based expiration (e.g., lock older than 5 minutes = stale)

**Code Evidence:**
```javascript
// Line 307-309: Keep-alive alarm setup
chrome.alarms.create(ALARM_NAMES.KEEPALIVE, { 
    periodInMinutes: CONFIG.KEEPALIVE_INTERVAL_MINUTES  // 0.5 = 30 seconds
});

// Line 338-340: Keep-alive handler (just logs, doesn't prevent termination)
case ALARM_NAMES.KEEPALIVE:
    console.log(`${LOG} Keep-alive ping`);
    break;
```

#### Question 7.2: Storage-Based Lock Race Condition

**Location:** `background/sync_queue.js` - Storage helpers

**Findings:**

1. **Chrome Storage Atomicity:**
   - ⚠️ **`chrome.storage.local.set()` is NOT fully atomic** for concurrent operations
   - Multiple `set()` calls can interleave, causing race conditions
   - **The Problem:** Between `getFromStorage()` and `saveToStorage()`, another process can read/write

2. **Web Locks API:**
   - ❌ **Not available** - Extension does not use `navigator.locks`
   - Chrome Extensions (MV3) don't have access to Web Locks API in service workers

3. **Chrome Storage Session:**
   - ❌ **Not suitable** - `chrome.storage.session` is per-tab and doesn't persist across service worker restarts
   - Would not solve the persistence issue

4. **Existing Patterns:**
   - The codebase uses `chrome.storage.local` for all state management
   - No existing mutual exclusion patterns found
   - Other alarms (like `WORKBOOK_SYNC`) use simple flag checks, not true locking

**Race Condition Scenario:**
```
T0: Process A reads queueProcessing → { isProcessing: false }
T1: Process B reads queueProcessing → { isProcessing: false }
T2: Process A writes queueProcessing → { isProcessing: true, timestamp: T2 }
T3: Process B writes queueProcessing → { isProcessing: true, timestamp: T3 }
Result: Both processes think they have the lock!
```

**Solution: Optimistic Locking with Timestamp:**
- Use timestamp-based lock with expiration
- Double-check after acquiring (verify we got the lock)
- If lock is stale (>5 minutes), allow takeover

---

### Part 8: BigQuery Double-Sync Deep Dive

#### Question 8.1: Two Separate Code Paths?

**Location:** `background/sync_queue.js`, lines 162-190

**Findings:**

1. **Single Code Path:**
   - ✅ **Only ONE code path** calls `syncProfilesToBigQuery()` - from `processQueue()` at line 169
   - **No separate call sites** - all BigQuery syncs go through the queue processor
   - **No loops** that could cause double iteration

2. **Call Pattern:**
   ```javascript
   // Line 135: Loop through queue items
   for (const item of queue) {
       // Line 138: Sync to Sheets
       await appendRowsToTab(...);
       
       // Line 169: Sync to BigQuery (once per queue item)
       await bigquerySync.syncProfilesToBigQuery(...);
   }
   ```

3. **Why It Appears Twice:**
   - **Root Cause:** `processQueue()` is called **twice concurrently** (race condition)
   - Both calls process the same queue item
   - Each call executes the BigQuery sync for the same item
   - **Result:** Same profiles synced twice with identical data

4. **Log Pattern Explanation:**
   ```
   sync_queue.js:162 [QUEUE] 🔄 Syncing 3 profiles to BigQuery...
   bigquery_sync.js:183 [BIGQUERY] ✅ Sync complete: 3 synced
   sync_queue.js:176 [QUEUE] ✅ BigQuery sync: 3 synced
   
   [Then again - from second processQueue() call:]
   sync_queue.js:162 [QUEUE] 🔄 Syncing 3 profiles to BigQuery...
   bigquery_sync.js:183 [BIGQUERY] ✅ Sync complete: 3 synced
   ```
   - This is the **same code path executing twice** due to the race condition

#### Question 8.2: Observations Also Recorded Twice

**Location:** `background/sync_queue.js`, lines 180-190

**Findings:**

1. **Same Code Path:**
   - ✅ Observations are recorded **in the same code path** as profile syncing
   - Called immediately after `syncProfilesToBigQuery()` (line 182)
   - **No separate trigger** - observations are part of the queue processing flow

2. **Call Chain:**
   ```javascript
   processQueue() (line 121)
     → for each item (line 135)
       → syncProfilesToBigQuery() (line 169)
         → Returns result with advisorIds
       → recordSearchObservations() (line 182)
         → Uses advisorIds from sync result
   ```

3. **Why Observations Are Duplicated:**
   - When `processQueue()` runs twice for the same item:
     - First call: Syncs profiles → Records observations
     - Second call: Syncs profiles again → Records observations again
   - **Result:** Duplicate observation records in BigQuery

4. **Observation Recording Logic:**
   - Location: `background/bigquery_sync.js`, lines 294-343
   - Uses `advisorIds` from sync result (line 334)
   - **No deduplication check** - doesn't verify if observations already exist

---

### Part 9: Apps Script / Backend Idempotency

#### Question 9.1: Current Duplicate Detection

**Location:** `big_query/apps-script/Code.gs`, lines 285-406

**Findings:**

1. **Advisor Duplicate Detection:**
   - ✅ **YES** - Backend checks for existing advisors before inserting
   - **Unique Key:** `linkedin_url` (normalized)
   - **Logic:** Lines 287-294 - Queries for existing advisor by LinkedIn URL
   - **If exists:** Uses existing `advisor_id` (line 301)
   - **If new:** Generates new UUID (line 333)

2. **Connection Duplicate Detection:**
   - ✅ **YES** - Backend checks for existing connections
   - **Unique Key:** `advisor_id + recruiter_id` (composite)
   - **Logic:** Lines 361-367 - Queries for existing connection
   - **If exists:** Updates `last_seen_date` (if old enough, >90 minutes)
   - **If new:** Creates new connection record (line 396)

3. **Observation Duplicate Detection:**
   - ❌ **NO** - Observations are **NOT checked for duplicates**
   - **Location:** `big_query/apps-script/Code.gs`, `recordObservationsBatch()` function
   - **Behavior:** Always inserts new observation records
   - **Result:** If same observation is sent twice, **duplicate records are created**

4. **Streaming Buffer Limitation:**
   - ⚠️ **Important:** BigQuery streaming inserts have a 90-minute buffer
   - Updates to recently inserted rows (<90 minutes) are skipped to avoid errors
   - **This prevents duplicate advisor/connection updates, but NOT duplicate observations**

**Code Evidence:**
```javascript
// Line 287-294: Check for existing advisor
const existingQuery = `
  SELECT id, created_at 
  FROM advisors 
  WHERE linkedin_url = '${escapedLinkedInUrl}' 
  LIMIT 1
`;
const existing = runQuery(existingQuery);

if (existing.length > 0) {
  // Use existing ID
  actualAdvisorId = existing[0].id;
} else {
  // Create new
  actualAdvisorId = generateUUID();
}
```

#### Question 9.2: Advisor ID Generation

**Location:** `big_query/apps-script/Code.gs`, lines 296-358

**Findings:**

1. **ID Generation Strategy:**
   - ✅ **Lookup-based, not fresh generation**
   - **Process:**
     1. Normalize LinkedIn URL (line 275)
     2. Query for existing advisor by `linkedin_url` (line 287-294)
     3. **If exists:** Use existing `id` (line 301)
     4. **If new:** Generate UUID (line 333)

2. **Same Profile, Same ID:**
   - ✅ **YES** - If the same profile is synced twice, it gets the **same advisor_id**
   - **Reason:** Duplicate detection by LinkedIn URL ensures same profile = same ID
   - **This is GOOD** - prevents duplicate advisor records

3. **Potential Issue:**
   - ⚠️ **Race condition in Apps Script:** If two sync requests arrive simultaneously:
     - Both might query for existing advisor at the same time
     - Both might find no existing record
     - Both might generate new UUIDs
     - **Result:** Duplicate advisor records with different IDs
   - **However:** This is unlikely due to Apps Script execution model (single-threaded)

4. **Connection ID Generation:**
   - ✅ **Similar logic** - Checks for existing connection before creating
   - Uses composite key: `advisor_id + recruiter_id`
   - **Same profile synced twice = same connection record** (updated, not duplicated)

**Code Evidence:**
```javascript
// Line 296-301: Use existing ID if found
if (existing.length > 0) {
  actualAdvisorId = existing[0].id;  // Reuse existing ID
} else {
  actualAdvisorId = generateUUID();  // Generate new ID
}
```

---

### Part 10: Search Execution Sequencing

#### Question 10.1: The "Flipping" Behavior

**Location:** `background/service_worker.js`, lines 1213-1354

**Findings:**

1. **During Search Delays:**
   - Queue processing **continues independently** during 45-90 second delays between searches
   - Alarm fires every 60 seconds, so **multiple queue processing cycles** occur during delays
   - **This is expected behavior** - queue processing should not pause during search transitions

2. **Async Operations After Search Complete:**
   - ✅ **Search completion is properly awaited** (line 1275)
   - `waitForScrapingCompleteWithHealthCheck()` waits for `SCRAPING_COMPLETE` message
   - **However:** Content script may send `DATA_SCRAPED` messages **after** sending `SCRAPING_COMPLETE`
   - **Race condition:** Final page data might arrive after search is marked "complete"

3. **Could waitForScrapingComplete Return Early?**
   - ⚠️ **YES** - Potential timing issue:
     - Content script sends `SCRAPING_COMPLETE` (line 1425 in content.js)
     - Service worker receives it and resolves `waitForScrapingComplete()` (line 1473)
     - **BUT:** Content script might still be processing final page data
     - Final `DATA_SCRAPED` messages arrive after search is marked complete
     - **Result:** Data from final page might be queued after search transition

**Code Evidence:**
```javascript
// Line 1275: Wait for completion
const result = await waitForScrapingCompleteWithHealthCheck(...);

// Line 1473: Resolves on SCRAPING_COMPLETE message
if (message.action === MESSAGE_ACTIONS.SCRAPING_COMPLETE) {
  resolve(message);  // Search marked complete
}

// Line 1490: But DATA_SCRAPED messages can still arrive
if (message.action === MESSAGE_ACTIONS.DATA_SCRAPED) {
  lastActivityTime = Date.now();  // Activity indicator
}
```

#### Question 10.2: Content Script Coordination

**Location:** `content/content.js` and `background/service_worker.js`

**Findings:**

1. **How Service Worker Knows Search is Complete:**
   - ✅ **Message-based:** Content script sends `SCRAPING_COMPLETE` message (line 1425 in content.js)
   - Service worker listens for this message in `waitForScrapingCompleteWithHealthCheck()` (line 1473)
   - **No polling** - event-driven completion

2. **Race Between SCRAPING_COMPLETE and DATA_SCRAPED:**
   - ⚠️ **YES - Race condition exists:**
     - Content script processes final page
     - Sends `DATA_SCRAPED` for final page (async)
     - Immediately sends `SCRAPING_COMPLETE` (line 1425)
     - **If `SCRAPING_COMPLETE` arrives first:** Service worker marks search complete
     - **Then `DATA_SCRAPED` arrives:** Data is queued, but search is already "complete"
     - **Result:** Final page data might be processed during next search's delay period

3. **What If Content Script Sends Data After Completion:**
   - ✅ **Data is still queued** - `DATA_SCRAPED` handler (line 1770) processes it regardless
   - **Issue:** This data appears to belong to the "next" search, but it's actually from the previous search
   - **Impact:** Minor - data is still synced, just timing is off

**Code Evidence:**
```javascript
// content.js: Line 1425 - Sends completion
sendMessageSafe({
  action: 'SCRAPING_COMPLETE',
  totalProfiles: totalProfiles,
  totalPages: totalPages
});

// service_worker.js: Line 1770 - Handles data (can arrive after completion)
case MESSAGE_ACTIONS.DATA_SCRAPED: {
  await addToQueue(rows, workbookId, tabName);
  processQueue().catch(...);
}
```

---

### Part 11: Proposed Fix Validation

#### Question 11.1: Fix 1 - In-Memory Lock

**Validation Findings:**

1. **Works for Concurrent Calls:**
   - ✅ **YES** - In-memory lock prevents concurrent execution within same service worker instance
   - **Test:** Two simultaneous `processQueue()` calls - second is skipped

2. **Edge Cases:**
   - ❌ **Service worker restart:** Lock is lost, processing can restart
   - ❌ **Error handling:** Lock must be in `finally` block (proposed fix includes this)
   - ⚠️ **Slow processing:** If processing takes >60s, alarm fires but lock prevents duplicate

3. **Limitation:**
   - **Does NOT survive service worker restart**
   - If service worker terminates mid-processing, lock is lost
   - When service worker restarts, processing can start again (but items might already be processed)

**Recommendation:** Use storage-based lock instead (see Fix 2 improvements below)

#### Question 11.2: Fix 2 - Storage-Based Lock

**Validation Findings:**

1. **Race Condition Exists:**
   - ⚠️ **YES** - Between `getFromStorage()` and `saveToStorage()`, another process can acquire lock
   - **Solution:** Use optimistic locking with timestamp verification

2. **Improved Implementation:**
   ```javascript
   const LOCK_KEY = 'queueProcessingLock';
   const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
   
   async function acquireQueueLock() {
     const { [LOCK_KEY]: lock } = await getFromStorage([LOCK_KEY]);
     const now = Date.now();
     
     // Check for stale lock
     if (lock?.isLocked && (now - lock.timestamp) < LOCK_TIMEOUT) {
       return false; // Lock held and not stale
     }
     
     // Attempt to acquire lock
     const newLock = { isLocked: true, timestamp: now, processId: Math.random() };
     await saveToStorage({ [LOCK_KEY]: newLock });
     
     // Double-check we got the lock (optimistic locking)
     const { [LOCK_KEY]: verify } = await getFromStorage([LOCK_KEY]);
     return verify?.timestamp === now && verify?.processId === newLock.processId;
   }
   
   async function releaseQueueLock() {
     await saveToStorage({ [LOCK_KEY]: { isLocked: false, timestamp: 0 } });
   }
   ```

3. **Stale Lock Detection:**
   - ✅ **5-minute timeout** - Locks older than 5 minutes are considered stale
   - **Reason:** Normal queue processing should complete in <1 minute
   - **If lock is stale:** New process can take over (prevents deadlock from crashed processing)

---

### Part 12: Comprehensive Fix Recommendations

#### 12.1 Revised Fix Implementation

**Based on findings, here are the revised fixes:**

**Fix 1 (REVISED): Storage-Based Lock with Optimistic Locking**

**Location:** `background/sync_queue.js`

**Implementation:**
```javascript
const LOCK_KEY = 'queueProcessingLock';
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function acquireQueueLock() {
  const { [LOCK_KEY]: lock } = await getFromStorage([LOCK_KEY]);
  const now = Date.now();
  
  // Check for stale lock
  if (lock?.isLocked && (now - lock.timestamp) < LOCK_TIMEOUT) {
    return { acquired: false, reason: 'lock_held' };
  }
  
  // Attempt to acquire lock with unique process ID
  const processId = `${Date.now()}-${Math.random()}`;
  const newLock = { isLocked: true, timestamp: now, processId };
  await saveToStorage({ [LOCK_KEY]: newLock });
  
  // Double-check we got the lock (optimistic locking)
  const { [LOCK_KEY]: verify } = await getFromStorage([LOCK_KEY]);
  if (verify?.timestamp === now && verify?.processId === processId) {
    return { acquired: true, processId };
  }
  
  // Another process got the lock
  return { acquired: false, reason: 'race_condition' };
}

async function releaseQueueLock(processId) {
  const { [LOCK_KEY]: lock } = await getFromStorage([LOCK_KEY]);
  // Only release if we hold the lock
  if (lock?.processId === processId) {
    await saveToStorage({ [LOCK_KEY]: { isLocked: false, timestamp: 0 } });
  }
}

export async function processQueue() {
  // Acquire lock
  const lockResult = await acquireQueueLock();
  if (!lockResult.acquired) {
    console.log(`${LOG} ⏸️ Queue processing already in progress, skipping`);
    return { synced: 0, failed: 0, pending: 0 };
  }
  
  try {
    const queue = await getQueue();
    // ... existing processing logic ...
  } finally {
    // Always release lock
    await releaseQueueLock(lockResult.processId);
  }
}
```

**Fix 2 (REVISED): Alarm Guard with Storage Check**

**Location:** `background/service_worker.js`, line 342

**Implementation:**
```javascript
case ALARM_NAMES.QUEUE_PROCESS:
  console.log(`${LOG} Queue process tick`);
  try {
    // Check lock before processing
    const { queueProcessingLock } = await getFromStorage(['queueProcessingLock']);
    const now = Date.now();
    
    if (queueProcessingLock?.isLocked) {
      const age = now - (queueProcessingLock.timestamp || 0);
      if (age < 5 * 60 * 1000) {
        console.log(`${LOG} ⏸️ Queue processing already in progress (lock age: ${(age/1000).toFixed(0)}s), skipping alarm`);
        break;
      } else {
        console.log(`${LOG} ⚠️ Stale lock detected (${(age/1000).toFixed(0)}s old), will allow processing`);
      }
    }
    
    // processQueue() will acquire its own lock
    const result = await processQueue();
    // ... existing code ...
  } catch (e) {
    console.error(`${LOG} Queue process error:`, e);
  }
  break;
```

**Fix 3: Add Observation Deduplication (Backend)**

**Location:** `big_query/apps-script/Code.gs`, `recordObservationsBatch()` function

**Implementation:**
- Add duplicate check before inserting observations
- Use composite key: `advisor_id + recruiter_id + observation_date`
- Skip if observation already exists for same day

**Fix 4: Improve Search Completion Coordination**

**Location:** `content/content.js` and `background/service_worker.js`

**Implementation:**
- Ensure all `DATA_SCRAPED` messages are sent before `SCRAPING_COMPLETE`
- Add small delay after final page processing before sending completion
- Or: Service worker should wait for queue to be empty before marking search complete

#### 12.2 Migration Strategy

**Deployment Plan:**

1. **Pre-Deployment:**
   - ✅ No need to pause scheduled scrapes (fixes are backward compatible)
   - ✅ Queue processing will continue normally
   - ⚠️ **Cleanup duplicate data:** Run SQL query to remove duplicate observations (see below)

2. **Deployment:**
   - Deploy fixes in order: Fix 1 → Fix 2 → Fix 3 → Fix 4
   - Monitor logs for lock acquisition/release
   - Verify no duplicate processing occurs

3. **Post-Deployment:**
   - Monitor for stale locks (should be rare)
   - Verify queue processing completes normally
   - Check for duplicate data reduction

4. **Rollback Plan:**
   - Revert to previous version if issues occur
   - Stale locks will auto-expire after 5 minutes
   - No data loss risk (only prevents duplicate processing)

**Duplicate Data Cleanup SQL:**
```sql
-- Remove duplicate observations (keep most recent)
DELETE FROM `savvy_pirate.observations` o1
WHERE EXISTS (
  SELECT 1 FROM `savvy_pirate.observations` o2
  WHERE o2.advisor_id = o1.advisor_id
    AND o2.recruiter_id = o1.recruiter_id
    AND DATE(o2.observed_at) = DATE(o1.observed_at)
    AND o2.observed_at > o1.observed_at
);
```

#### 12.3 Monitoring

**Recommended Logging:**

1. **Lock Acquisition/Release:**
   ```javascript
   console.log(`${LOG} 🔒 Lock acquired (processId: ${processId})`);
   console.log(`${LOG} 🔓 Lock released (processId: ${processId})`);
   console.log(`${LOG} ⏸️ Lock held by another process (age: ${age}s)`);
   ```

2. **Duplicate Detection:**
   - Track when same queue item is processed twice (should not happen after fix)
   - Log warning if duplicate processing detected

3. **Queue Depth:**
   - Log queue depth before/after processing
   - Alert if queue depth grows unexpectedly

4. **Stale Lock Alerts:**
   - Log warning when stale lock is detected
   - Alert if stale locks occur frequently (indicates service worker crashes)

**Monitoring Queries:**
```sql
-- Check for duplicate observations (should decrease after fix)
SELECT 
  advisor_id, 
  recruiter_id, 
  DATE(observed_at) as date,
  COUNT(*) as count
FROM `savvy_pirate.observations`
GROUP BY advisor_id, recruiter_id, DATE(observed_at)
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

---

## Summary of Follow-Up Findings

### Key Discoveries:

1. **Service Worker Persistence:** In-memory locks won't survive restarts - must use storage-based locks
2. **Storage Race Condition:** Chrome storage is not fully atomic - need optimistic locking with timestamp verification
3. **Single Code Path:** BigQuery sync only called once per queue item, but `processQueue()` race condition causes duplicate calls
4. **Backend Idempotency:** Advisors and connections have duplicate detection, but **observations do NOT**
5. **Search Completion Race:** Final page data can arrive after search is marked complete
6. **Advisor ID Stability:** Same profile always gets same ID (good), but observations can still be duplicated

### Revised Priority:

1. **Fix 1 (Storage-Based Lock)** - CRITICAL - Prevents race condition, survives restarts
2. **Fix 2 (Alarm Guard)** - HIGH - Prevents alarm interference
3. **Fix 3 (Observation Deduplication)** - HIGH - Prevents duplicate records in database
4. **Fix 4 (Search Coordination)** - MEDIUM - Improves data accuracy
5. **Fix 5 (Immediate Processing Guard)** - MEDIUM - Prevents overlap (redundant with Fix 1)

---

## Part 13-20: Environment & Scheduler Deep Dive Findings

### Part 13: Raspberry Pi / Chromium Constraints

#### Question 13.1: Service Worker Lifecycle on Pi

**Location:** `background/service_worker.js`, lines 305-317, 338-340, 454-502

**Findings:**

1. **Service Worker Termination:**
   - ❌ **No `onSuspend` handler** - Service worker doesn't detect when it's being terminated
   - ⚠️ **No restart detection** - System doesn't know if service worker was terminated and restarted
   - **Evidence:** Documentation in `manual_scrape_issue.md` confirms Chromium terminates service workers more aggressively on Pi

2. **Keep-Alive Mechanism:**
   - ✅ **Keep-alive alarm exists** (line 307-309): `ALARM_NAMES.KEEPALIVE` fires every 30 seconds (`CONFIG.KEEPALIVE_INTERVAL_MINUTES: 0.5`)
   - **Purpose:** Prevents service worker termination during active scrapes
   - **Activation:** Must be manually started via `startKeepAlive()` (line 305)
   - **Limitation:** Only active when explicitly started - not always running
   - **Auto-run keep-alive:** Separate alarm for auto-run (line 665): `AUTO_RUN_KEEPALIVE` fires every 18 seconds (0.3 minutes)

3. **Keep-Alive Tied to Scraping:**
   - ✅ **YES** - Keep-alive is started when scraping begins (line 2329, 1259)
   - ✅ **YES** - Keep-alive is stopped when scraping ends (line 2345, 1259)
   - **Issue:** If service worker terminates mid-scrape, keep-alive doesn't help
   - **Issue:** Keep-alive doesn't prevent termination, only reduces likelihood

4. **Keep-Alive Interval:**
   - **Current:** 30 seconds for manual scrapes, 18 seconds for auto-run
   - **On Pi:** May be insufficient - Chromium on resource-constrained devices may terminate more aggressively
   - **Recommendation:** Reduce to 15 seconds on Pi for more frequent pings

**Code Evidence:**
```javascript
// Line 307-309: Keep-alive alarm setup
chrome.alarms.create(ALARM_NAMES.KEEPALIVE, { 
    periodInMinutes: CONFIG.KEEPALIVE_INTERVAL_MINUTES  // 0.5 = 30 seconds
});

// Line 338-340: Keep-alive handler (just logs)
case ALARM_NAMES.KEEPALIVE:
    console.log(`${LOG} Keep-alive ping`);
    break;
```

#### Question 13.2: Storage I/O Performance

**Location:** `background/sync_queue.js` - Storage helpers

**Findings:**

1. **Storage Operation Timing:**
   - ⚠️ **No timing logs** - Current code doesn't measure storage operation duration
   - **Expected on SD card:** 50-100ms per operation (read or write)
   - **Lock mechanism requires:** 3 operations (read → write → read verification) = ~150-300ms total

2. **Verification Read Timing:**
   - ⚠️ **Potential race condition:** Verification read might happen before write is persisted to SD card
   - **SD card write caching:** Chrome may cache writes, causing verification to see stale data
   - **Issue:** Optimistic locking might fail on slow storage

3. **Storage Batching:**
   - ❌ **No batching** - Each storage operation is independent
   - **Current pattern:** Multiple `getFromStorage()` and `saveToStorage()` calls
   - **Opportunity:** Could batch multiple reads/writes together

4. **Recommendation:**
   - Add small delay (50-100ms) between write and verification read on Pi
   - Add timing logs to measure actual storage performance
   - Consider using `chrome.storage.local.get()` with multiple keys to batch reads

**Code Evidence:**
```javascript
// Proposed lock mechanism (from Part 12):
await saveToStorage({ [LOCK_KEY]: newLock });  // Write 1
// ⚠️ No delay here
const { [LOCK_KEY]: verify } = await getFromStorage([LOCK_KEY]);  // Read 2
```

#### Question 13.3: Memory Pressure Handling

**Location:** `background/sync_queue.js`, lines 121-291

**Findings:**

1. **Service Worker Termination During Processing:**
   - ⚠️ **No protection** - If service worker terminates mid-`processQueue()`, items being processed are **not removed** from queue
   - **Result:** Items remain in queue and will be processed again when service worker restarts
   - **This causes duplicate processing** even without the race condition

2. **Try/Finally Blocks:**
   - ✅ **YES** - `processQueue()` doesn't have try/finally, but proposed lock mechanism will
   - **Current code:** No cleanup if processing is interrupted
   - **Issue:** Storage writes might not complete if service worker terminates

3. **Heartbeat Timestamp:**
   - ❌ **NO** - Lock doesn't have heartbeat mechanism
   - **Recommendation:** Add `lastHeartbeat` timestamp to lock, update every 30 seconds during processing
   - **Stale detection:** Lock older than 5 minutes with no heartbeat = stale

4. **Cleanup on Restart:**
   - ❌ **NO** - No cleanup logic when service worker restarts
   - **Recommendation:** On startup, check for stale locks and clear them
   - **Location:** `chrome.runtime.onStartup` or `chrome.runtime.onInstalled` handlers

**Code Evidence:**
```javascript
// Line 121-291: processQueue() - no try/finally for cleanup
export async function processQueue() {
    const queue = await getQueue();
    // ... processing ...
    await saveQueue(remainingQueue);  // ⚠️ Might not execute if terminated
}
```

---

### Part 14: Scheduler Architecture

#### Question 14.1: Pending Schedule Queue

**Location:** `background/scheduler.js`, lines 357-395

**Findings:**

1. **Storage Location:**
   - ✅ **Stored in Chrome storage:** `STORAGE_KEYS.PENDING_SCHEDULES`
   - **Key:** `'pendingSchedules'` (line 66 in constants.js)
   - **Format:** Array of schedule objects with `queuedAt` timestamp

2. **Adding to Queue:**
   - **Function:** `addPendingSchedule()` (line 367)
   - **Trigger:** When schedule should run but another scrape is active (line 432 in service_worker.js)
   - **Deduplication:** Checks if schedule already in queue (line 371)
   - **Logging:** `Queued schedule ${schedule.sourceName} (${pending.length} pending)`

3. **Processing Pending Schedules:**
   - **Function:** `processPendingSchedules()` in `service_worker.js` (line 794)
   - **Trigger:** After scrape completes (line 714, 1411)
   - **Logic:** Processes first pending schedule, then recursively processes next if none running
   - **Prevents re-entrancy:** Uses `_isRunning` flag (line 796)

4. **Multiple Pending Schedules:**
   - ✅ **YES** - Multiple schedules can be pending simultaneously
   - **Order:** FIFO (first queued is first processed)
   - **No maximum depth** - Queue can grow indefinitely

5. **Maximum Queue Depth:**
   - ❌ **NO LIMIT** - Queue can grow without bound
   - **Risk:** If many schedules are deferred, queue could become very large
   - **Recommendation:** Add maximum depth (e.g., 50 schedules) with alert

**Code Evidence:**
```javascript
// Line 367-383: Adding to pending queue
export async function addPendingSchedule(schedule) {
    const pending = await getPendingSchedules();
    if (pending.some(s => s.id === schedule.id)) {
        return; // Already queued
    }
    pending.push({ ...schedule, queuedAt: new Date().toISOString() });
    await saveToStorage({ [STORAGE_KEYS.PENDING_SCHEDULES]: pending });
}
```

#### Question 14.2: Schedule State Machine

**Location:** `background/scheduler.js` and `background/service_worker.js`

**Findings:**

1. **Schedule States:**
   - **`enabled`** - Schedule is active (can be overridden locally)
   - **`pending`** - In pending queue, waiting to run
   - **`running`** - Currently executing (via `autoRunState.isRunning` or `manualScrapeState.isRunning`)
   - **`completed`** - Execution finished successfully
   - **`failed`** - Execution failed
   - **No explicit state field** - State is inferred from multiple sources

2. **State Transitions:**
   ```
   enabled → pending (when due but another scrape running)
   pending → running (when previous scrape completes)
   enabled → running (when due and no other scrape running)
   running → completed (on success)
   running → failed (on error)
   completed/failed → enabled (ready for next scheduled time)
   ```

3. **State Diagram:**
   ```
   [enabled] ──due──> [running] ──success──> [completed]
      │                    │
      │                    └──error──> [failed]
      │
      └──overlap──> [pending] ──next available──> [running]
   ```

4. **Stuck in "Running" State:**
   - ⚠️ **YES** - If service worker terminates mid-scrape, state can remain "running"
   - **Detection:** Execution record has `status: 'running'` but no recent activity
   - **Timeout:** Execution claims expire after 1 hour (line 522 in service_worker.js)
   - **Cleanup:** Stale execution records are cleared (line 532-535)

5. **Timeout for Stuck Schedules:**
   - ✅ **YES** - Execution claim timeout: 1 hour (line 522)
   - **Logic:** If execution record is older than 1 hour, it's considered stale
   - **Action:** Stale records are cleared, allowing new execution

**Code Evidence:**
```javascript
// Line 520-535: Stale execution detection
const executionAge = Date.now() - existingExecution.startedAt;
const maxAge = 60 * 60 * 1000; // 1 hour

if (existingExecution.deviceId !== myDeviceId && executionAge < maxAge) {
    // Skip - still running
} else if (executionAge >= maxAge) {
    // Clear stale execution record
    await chrome.storage.local.remove([executionKey]);
}
```

#### Question 14.3: Schedule Execution Handoff

**Location:** `background/service_worker.js`, lines 713-715, 1410-1411

**Findings:**

1. **Handoff Trigger:**
   - ✅ **Automatic** - After scrape completes, `processPendingSchedules()` is called
   - **Location:** `finally` block of `executeScheduledRun()` (line 714) and `processManualScrape()` (line 1411)
   - **Ensures:** Next schedule starts immediately after previous completes

2. **Delay/Cooldown:**
   - ❌ **NO** - No delay between scrapes
   - **Immediate handoff** - Next schedule starts as soon as previous completes
   - **Risk:** Could cause resource exhaustion on Pi if many schedules are pending

3. **Queue Processing Before Handoff:**
   - ⚠️ **NO** - Handoff happens immediately, doesn't wait for queue to empty
   - **Issue:** Queue from previous scrape might still be processing when next scrape starts
   - **Result:** Queue processing and new scraping happen concurrently
   - **This is intentional** - Queue processing is independent and should continue

4. **Cleanup Before Handoff:**
   - ✅ **YES** - Cleanup happens in `finally` block:
     - Execution record cleared (line 703)
     - Keep-alive cleared (line 707)
     - State reset (line 710-711)
   - **Then:** `processPendingSchedules()` is called (line 714)

**Code Evidence:**
```javascript
// Line 701-715: Cleanup and handoff
finally {
    await chrome.storage.local.remove([executionKey]);
    chrome.alarms.clear(ALARM_NAMES.AUTO_RUN_KEEPALIVE);
    autoRunState.isRunning = false;
    await saveToStorage({ autoRunState });
    
    // Check for pending schedules and run the next one
    await processPendingSchedules();  // Immediate handoff
}
```

#### Question 14.4: Bi-Weekly Scheduling Logic

**Location:** `background/scheduler.js`, lines 66-147, 154-163

**Findings:**

1. **Next Run Calculation:**
   - **Function:** `calculateNextRun()` (line 154)
   - **Logic:** Uses week-of-month pattern (odd/even weeks)
   - **Week calculation:** Day 1-7 = week 1, 8-14 = week 2, etc. (line 66-69)
   - **Pattern matching:** Checks if current week matches schedule's `weekPattern` (line 448-451)
   - **Returns:** ISO string of next scheduled time

2. **Pi Off During Scheduled Time:**
   - ⚠️ **NO catch-up logic** - If Pi is off, schedule is missed
   - **Next run:** Calculated from current time, not missed time
   - **Result:** Missed schedules are skipped, next run is in 2 weeks
   - **Issue:** No way to recover missed scrapes

3. **Catch-Up Logic:**
   - ❌ **NO** - System doesn't detect or handle missed schedules
   - **Recommendation:** Add "missed schedule" detection:
     - Check if `nextRun` is in the past when service worker starts
     - If missed by <24 hours, trigger immediately
     - If missed by >24 hours, skip and calculate next run

4. **Scheduler Look-Ahead:**
   - **Current:** Only checks schedules due "now" (within 10-minute window)
   - **Window:** -5 to +10 minutes from scheduled time (line 461)
   - **No future scheduling** - Doesn't look ahead beyond current check
   - **Recommendation:** Could pre-queue schedules that will be due soon

**Code Evidence:**
```javascript
// Line 454-461: Time window check
const diff = currentMinutes - scheduledMinutes;
// Allow -5 to +10 minute window
if (diff < -5 || diff > 10) continue;  // Skip if outside window
```

---

### Part 15: Multi-Device Architecture

#### Question 15.1: Device ID and Claiming

**Location:** `background/device_id.js` and `background/service_worker.js`, lines 513-547

**Findings:**

1. **Device ID Generation:**
   - **File:** `background/device_id.js`
   - **Format:** `{platform}-{random4chars}` (e.g., `pi-a3f2`, `win-b7c1`)
   - **Platform detection:** From `navigator.userAgent` (line 11-20)
   - **Storage:** Persisted in `chrome.storage.local` with key `'deviceId'`
   - **Generation:** On first run, generates and saves ID (line 40-65)

2. **Schedule Claiming:**
   - **Location:** `executeScheduledRun()` (line 513-547)
   - **Mechanism:** Stores execution claim in storage with key `scheduleExecution_{scheduleName}`
   - **Claim structure:**
     ```javascript
     {
       deviceId: 'pi-a3f2',
       scheduleName: 'Jon Bartick',
       startedAt: 1234567890
     }
     ```

3. **Multiple Devices Running Same Schedule:**
   - ✅ **Prevented** - Before executing, checks if another device has claimed it (line 518-529)
   - **Logic:** If claim exists and is <1 hour old, skip execution
   - **Device check:** Compares `existingExecution.deviceId !== myDeviceId`
   - **Result:** Only one device can execute a schedule at a time

4. **Race Condition in Claiming:**
   - ⚠️ **POTENTIAL** - Between checking for existing claim and setting new claim, another device could claim
   - **Window:** Small but exists (between line 518 and 539)
   - **Mitigation:** Stale claim detection (1 hour timeout) prevents permanent locks
   - **Recommendation:** Use same optimistic locking pattern as queue processing

**Code Evidence:**
```javascript
// Line 518-547: Device claiming logic
const { [executionKey]: existingExecution } = await chrome.storage.local.get([executionKey]);

if (existingExecution && existingExecution.deviceId !== myDeviceId && executionAge < maxAge) {
    return; // Skip - another device is running
}

// Claim this schedule execution
await chrome.storage.local.set({
    [executionKey]: {
        deviceId: myDeviceId,
        scheduleName: scheduleName,
        startedAt: Date.now()
    }
});
```

#### Question 15.2: Distributed Locking

**Location:** `background/service_worker.js`, lines 513-547, 1045-1075

**Findings:**

1. **Coordination Between Devices:**
   - ✅ **YES** - Uses Chrome storage as shared state
   - **Mechanism:** Execution claims stored in `chrome.storage.local`
   - **Scope:** Per-schedule execution claims
   - **Limitation:** Only works if both devices have extension installed and can access same storage

2. **Simultaneous Scraping Prevention:**
   - ✅ **YES** - Device claiming prevents two devices from scraping same recruiter
   - **Check:** Before starting, verifies no other device has active claim
   - **Timeout:** 1-hour claim expiration prevents permanent locks
   - **Result:** Only one device processes each schedule

3. **Lock Mechanism:**
   - **Type:** Device-local storage (Chrome storage is per-extension-installation)
   - **Shared:** ✅ YES - Chrome storage is synced across devices if user is signed in
   - **Wait:** This might not work if devices aren't synced
   - **Clarification needed:** Is Chrome storage synced across devices in this setup?

4. **Backend-Level Lock:**
   - ❌ **NO** - No backend-level locking for schedules
   - **Current:** Only extension-level locking via Chrome storage
   - **Recommendation:** Consider backend lock if storage sync is unreliable

**Code Evidence:**
```javascript
// Line 1045-1075: Device isolation for manual scrapes
const myDeviceId = await getDeviceId();

if (state.initiatedByDevice && state.initiatedByDevice !== myDeviceId) {
    // Ignore - belongs to another device
    return;
}
```

#### Question 15.3: Device Failure Handling

**Location:** `background/service_worker.js`, lines 520-535

**Findings:**

1. **Failed Device Detection:**
   - ✅ **YES** - Stale execution claim detection (line 520-535)
   - **Method:** Execution claims older than 1 hour are considered stale
   - **Logic:** `executionAge >= maxAge` (1 hour)
   - **Action:** Stale claims are cleared, allowing another device to take over

2. **Schedule Pickup by Another Device:**
   - ✅ **YES** - After stale claim expires, another device can claim the schedule
   - **Timeout:** 1 hour
   - **Issue:** 1 hour might be too long - failed scrape could delay next attempt significantly
   - **Recommendation:** Reduce timeout to 30 minutes, or add heartbeat mechanism

3. **Timeout for Claimed Schedule:**
   - ✅ **YES** - 1 hour timeout (line 522)
   - **Location:** `executeScheduledRun()` function
   - **Clearing:** Stale claims are automatically cleared (line 532-535)

4. **Partial Data from Failed Scrape:**
   - ⚠️ **Partially handled** - Queue items are persisted in storage
   - **If service worker terminates:** Items in queue remain and will be processed on restart
   - **If scrape fails mid-way:** Partial data is queued and will sync
   - **Issue:** No way to distinguish between "failed scrape" and "in-progress scrape" for partial data

**Code Evidence:**
```javascript
// Line 520-535: Stale claim detection
const executionAge = Date.now() - existingExecution.startedAt;
const maxAge = 60 * 60 * 1000; // 1 hour

if (executionAge >= maxAge) {
    console.log(`${LOG} 🧹 Clearing stale execution record`);
    await chrome.storage.local.remove([executionKey]);
}
```

---

### Part 16: Network Resilience

#### Question 16.1: Network Failure During Scraping

**Location:** `content/content.js` and `background/service_worker.js`

**Findings:**

1. **Network Failure During LinkedIn Scraping:**
   - ⚠️ **Limited handling** - Content script doesn't explicitly handle network failures
   - **Behavior:** LinkedIn page load failures would cause scraping to fail
   - **Recovery:** No automatic retry for page load failures
   - **Recommendation:** Add retry logic for navigation failures

2. **Network Failure During Sheets/BigQuery Sync:**
   - ✅ **YES** - Retry logic exists in `sheets_api.js` (line 18-78)
   - **Retries:** Up to 3 retries with exponential backoff
   - **Errors handled:** 503, 429, 500, 502 (transient errors)
   - **Queue retry:** Queue items have retry count (line 243-273 in sync_queue.js)
   - **Max retries:** 5 attempts (line 34 in constants.js)

3. **Retry Logic with Exponential Backoff:**
   - ✅ **YES** - Queue items use exponential backoff (line 270)
   - **Formula:** `BASE_DELAY_MS * Math.pow(2, retryCount)`
   - **Base delay:** 4000ms (4 seconds)
   - **Max retries:** 5 attempts
   - **Backoff:** 4s, 8s, 16s, 32s, 64s

4. **Partial Progress Saved:**
   - ✅ **YES** - Queue items are saved to storage before processing
   - **If network fails:** Item remains in queue with incremented retry count
   - **On restart:** Queue processing resumes from where it left off
   - **Issue:** No distinction between "network failure" and "other error"

**Code Evidence:**
```javascript
// Line 270-271: Exponential backoff
const backoffMs = BASE_DELAY_MS * Math.pow(2, item.retryCount);
console.log(`${LOG} ⏳ Will retry ${item.id} in ${backoffMs}ms`);
```

#### Question 16.2: LinkedIn Rate Limiting

**Location:** `content/content.js` - Scraping logic

**Findings:**

1. **Rate Limiting Detection:**
   - ⚠️ **Limited** - No explicit rate limit detection
   - **Indicators:** Page load failures, auth checkpoints, "too many requests" messages
   - **Current:** System relies on delays between actions to avoid rate limiting
   - **Recommendation:** Add explicit rate limit detection and backoff

2. **Response to Rate Limiting:**
   - ⚠️ **No specific handling** - Rate limiting would cause scraping to fail
   - **Delays:** System uses random delays (15-40 seconds) between actions
   - **Long pauses:** 15% chance of 45-120 second pause (line 11-13 in constants.js)
   - **Between searches:** 60-120 second delay (line 16-17)

3. **Backoff Logic:**
   - ⚠️ **No exponential backoff** - Delays are random, not increasing
   - **Current:** Fixed random delays, not adaptive to rate limiting
   - **Recommendation:** Add exponential backoff if rate limiting detected

4. **Monitoring:**
   - ❌ **NO** - No logging or monitoring of rate limit events
   - **Recommendation:** Add logging for rate limit indicators (auth checkpoints, blocked pages)

**Code Evidence:**
```javascript
// constants.js: Line 5-6, 16-17
MIN_WAIT_SECONDS: 15,
MAX_WAIT_SECONDS: 40,
BETWEEN_SEARCH_MIN_SECONDS: 60,
BETWEEN_SEARCH_MAX_SECONDS: 120,
```

#### Question 16.3: Google API Failures

**Location:** `background/sheets_api.js`, lines 18-78

**Findings:**

1. **Sheets API 429 (Rate Limit):**
   - ✅ **HANDLED** - Retry logic exists (line 56)
   - **Retries:** Up to 3 retries with exponential backoff
   - **Backoff:** 1s, 2s, 4s (max 10 seconds)
   - **Code:** `TRANSIENT_ERRORS.includes(429)` triggers retry

2. **Sheets API 503 (Service Unavailable):**
   - ✅ **HANDLED** - Same retry logic as 429
   - **Retries:** Up to 3 attempts
   - **Backoff:** Exponential with 10-second max

3. **Retry Logic for Google API:**
   - ✅ **YES** - `fetchWithRetry()` function (line 18)
   - **Max retries:** 3 attempts
   - **Errors handled:** 401 (token refresh), 503, 429, 500, 502
   - **Network errors:** Also retried (line 67-73)

4. **API Error Logging:**
   - ✅ **YES** - Errors are logged (line 58, 69, 75)
   - **Format:** `[SHEETS] Transient error {status} detected, retrying...`
   - **Recommendation:** Add error tracking/metrics for API failures

**Code Evidence:**
```javascript
// Line 56-61: Retry logic
if (TRANSIENT_ERRORS.includes(response.status) && retryCount < MAX_RETRIES) {
    const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
    console.warn(`${LOG} Transient error ${response.status} detected, retrying...`);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
    return fetchWithRetry(url, options, retryCount + 1);
}
```

---

### Part 17: Queue Processing Under Load

#### Question 17.1: Large Batch Processing

**Location:** `background/sync_queue.js`, lines 135-275

**Findings:**

1. **Batch Processing:**
   - ⚠️ **All at once** - Large batches (100+ profiles) are processed in single operation
   - **No chunking** - All rows in a queue item are synced together
   - **Memory:** All rows loaded into memory at once
   - **Risk:** Large batches could cause OOM on Pi (1-4GB RAM)

2. **Memory Footprint:**
   - **Per profile:** ~1-2KB (row data + metadata)
   - **100 profiles:** ~100-200KB in memory
   - **1000 profiles:** ~1-2MB in memory
   - **Risk:** Low for typical batches, but could be issue with very large searches

3. **OOM Risk on Pi:**
   - ⚠️ **Possible** - If multiple large batches are queued simultaneously
   - **Mitigation:** Queue processes one item at a time
   - **Issue:** If queue has many large items, memory could accumulate

4. **Batch Size Limits:**
   - ❌ **NO** - No maximum batch size
   - **Recommendation:** Add batch size limit (e.g., 200 profiles per queue item)
   - **Alternative:** Split large batches into smaller chunks

**Code Evidence:**
```javascript
// Line 135: Processes all items in queue sequentially
for (const item of queue) {
    await appendRowsToTab(item.spreadsheetId, item.tabName, item.rows);  // All rows at once
    // ...
}
```

#### Question 17.2: Queue Depth Management

**Location:** `background/sync_queue.js` and `background/service_worker.js`

**Findings:**

1. **Maximum Queue Depth:**
   - ❌ **NO** - No maximum queue depth
   - **Risk:** Queue could grow indefinitely if syncing is slower than scraping
   - **Storage limit:** Chrome storage has 10MB limit, but queue would hit this only with millions of items

2. **Queue Too Large:**
   - ⚠️ **No handling** - System doesn't detect or handle large queues
   - **Impact:** Large queues could slow down processing
   - **Recommendation:** Add queue depth monitoring and alerts

3. **Backpressure Mechanism:**
   - ❌ **NO** - No backpressure to pause scraping if queue is too deep
   - **Current:** Scraping continues regardless of queue depth
   - **Recommendation:** Pause scraping if queue depth > 100 items

4. **Pause Scraping if Queue Too Deep:**
   - ❌ **NO** - No such mechanism exists
   - **Recommendation:** Add check before starting new search:
     ```javascript
     const queueStatus = await getQueueStatus();
     if (queueStatus.pending > 100) {
         console.warn('Queue too deep, pausing scraping');
         // Wait or skip this search
     }
     ```

**Code Evidence:**
```javascript
// sync_queue.js: No maximum depth check
export async function getQueueStatus() {
    const queue = await getQueue();
    return {
        pending: queue.length,  // No limit check
        // ...
    };
}
```

#### Question 17.3: Concurrent Search + Sync

**Location:** `background/service_worker.js` and `background/sync_queue.js`

**Findings:**

1. **Intentional Concurrency:**
   - ✅ **YES** - This is intentional design
   - **Reason:** Queue processing is independent of scraping
   - **Benefit:** Throughput is higher - syncing doesn't block scraping
   - **Architecture:** Scraping adds to queue, queue processor syncs independently

2. **Resource Contention on Pi:**
   - ⚠️ **YES** - Concurrent operations compete for:
     - **CPU:** Both operations are CPU-intensive
     - **Memory:** Both load data into memory
     - **Network:** Both use network bandwidth
     - **Storage I/O:** Both read/write Chrome storage
   - **Impact:** Could slow down both operations on resource-constrained Pi

3. **Should Syncing Complete Before Next Search:**
   - ❌ **NO** - Current design allows overlap
   - **Trade-off:** Higher throughput vs. resource contention
   - **Recommendation:** Keep overlap but add resource monitoring

4. **Overlap Benefit:**
   - ✅ **YES** - Overlap is beneficial for throughput
   - **Without overlap:** Scraping waits for syncing, total time = scrape_time + sync_time
   - **With overlap:** Total time ≈ max(scrape_time, sync_time)
   - **On Pi:** Overlap might cause both to be slower, but still faster than sequential

**Code Evidence:**
```javascript
// service_worker.js: Line 1780-1783
await addToQueue(rows, workbookId, tabName);
processQueue().catch(...);  // Fire-and-forget, continues immediately

// Queue processing happens independently via alarm (every 60 seconds)
```

---

### Part 18: Alarm/Timer Configuration

#### Question 18.1: Current Alarm Configuration

**Location:** `utils/constants.js` and `background/service_worker.js`

**Findings:**

1. **All Alarms:**
   | Alarm Name | Interval | Purpose | Location |
   |------------|----------|---------|----------|
   | `KEEPALIVE` | 30 seconds (0.5 min) | Keep service worker alive during manual scrapes | Line 307-309 |
   | `AUTO_RUN_KEEPALIVE` | 18 seconds (0.3 min) | Keep service worker alive during auto-run | Line 665 |
   | `QUEUE_PROCESS` | 60 seconds (1.0 min) | Process sync queue | Line 321-323 |
   | `SCHEDULE_CHECK` | 60 seconds (1.0 min) | Check for due schedules | Line 328-330 |
   | `WORKBOOK_SYNC` | Configurable | Sync workbook config from Sheets | Line 357-377 |
   | `TOKEN_REFRESH` | N/A | Proactive OAuth token refresh | Not found in code |

2. **Alarm Intervals:**
   - **Keep-alive:** 30 seconds (manual), 18 seconds (auto-run)
   - **Queue process:** 60 seconds
   - **Schedule check:** 60 seconds
   - **All configurable:** Via `CONFIG` object in `constants.js`

3. **What Each Alarm Triggers:**
   - **KEEPALIVE:** Just logs ping (line 339)
   - **AUTO_RUN_KEEPALIVE:** Logs ping, clears if auto-run stopped (line 432-436)
   - **QUEUE_PROCESS:** Calls `processQueue()` (line 345)
   - **SCHEDULE_CHECK:** Calls `checkSchedules()` (line 381-448)
   - **WORKBOOK_SYNC:** Calls `syncWorkbookConfig()` (line 369)

4. **Configurable Intervals:**
   - ✅ **YES** - All intervals in `CONFIG` object
   - **Location:** `utils/constants.js`
   - **Can be changed:** Modify `CONFIG` values

**Code Evidence:**
```javascript
// constants.js: Line 32-38
QUEUE_PROCESS_INTERVAL_MINUTES: 1.0,  // 60 seconds
KEEPALIVE_INTERVAL_MINUTES: 0.5,      // 30 seconds
SCHEDULE_CHECK_INTERVAL_MINUTES: 1,   // 60 seconds
```

#### Question 18.2: Optimal Intervals for Pi

**Location:** `utils/constants.js`

**Findings:**

1. **Longer Intervals on Pi:**
   - ✅ **BENEFICIAL** - Longer intervals reduce:
     - CPU usage (fewer alarm handlers)
     - Storage I/O (fewer reads/writes)
     - Battery drain (if applicable)
   - **Trade-off:** Higher latency (queue processed less frequently)
   - **Recommendation:** 
     - Queue process: 120 seconds (2 minutes) on Pi
     - Schedule check: 120 seconds (2 minutes) on Pi
     - Keep-alive: Keep at 30 seconds (critical for preventing termination)

2. **Dynamic Intervals Based on Activity:**
   - ❌ **NO** - Intervals are fixed
   - **Recommendation:** Implement adaptive intervals:
     - If queue is empty: Longer interval (5 minutes)
     - If queue has items: Shorter interval (60 seconds)
     - If scraping active: Keep current intervals

3. **Benefit of More Frequent Processing:**
   - **Lower latency:** Data synced sooner
   - **Higher resource usage:** More CPU/storage I/O
   - **On Pi:** Lower frequency is better to reduce resource pressure

4. **Trade-off:**
   - **Latency vs. Resource Usage:**
     - 60 seconds: Low latency, higher resource usage
     - 120 seconds: Higher latency, lower resource usage
   - **Recommendation:** 120 seconds for Pi, 60 seconds for desktop

**Code Evidence:**
```javascript
// Current: Fixed 60-second interval
QUEUE_PROCESS_INTERVAL_MINUTES: 1.0,

// Recommended for Pi:
const isPi = navigator.userAgent.includes('CrOS');
QUEUE_PROCESS_INTERVAL_MINUTES: isPi ? 2.0 : 1.0,
```

#### Question 18.3: Alarm Reliability

**Location:** `background/service_worker.js` - Alarm handlers

**Findings:**

1. **Missed Alarms:**
   - ⚠️ **No detection** - System doesn't detect if alarms are missed
   - **Chrome behavior:** Alarms can be delayed or missed if:
     - Service worker is terminated
     - System is under heavy load
     - Device is sleeping
   - **On Pi:** More likely due to resource constraints

2. **Catch-Up Logic:**
   - ❌ **NO** - No catch-up logic for missed alarms
   - **Issue:** If alarm is missed, queue won't be processed until next alarm
   - **Recommendation:** On service worker startup, check if queue processing is overdue

3. **Minimum Reliable Interval:**
   - **Chrome documentation:** Minimum is 1 minute, but can be delayed
   - **On Pi:** 2 minutes is more reliable due to resource constraints
   - **Current:** 60 seconds might be too aggressive for Pi

4. **Alarm Miss Handling:**
   - ❌ **NO** - No handling for missed alarms
   - **Recommendation:** Add startup check:
     ```javascript
     chrome.runtime.onStartup.addListener(async () => {
         // Check if queue processing is overdue
         const lastProcess = await getFromStorage(['lastQueueProcess']);
         const now = Date.now();
         if (now - lastProcess > 5 * 60 * 1000) {
             // Overdue, process immediately
             await processQueue();
         }
     });
     ```

---

### Part 19: Error Recovery

#### Question 19.1: Execution History

**Location:** `background/scheduler.js`, lines 520-626

**Findings:**

1. **Storage Location:**
   - ✅ **Chrome storage:** `STORAGE_KEYS.EXECUTION_HISTORY` (`'executionHistory'`)
   - **Format:** Array of execution records
   - **Max records:** 100 (line 520)

2. **Execution States:**
   - **`running`** - Currently executing
   - **`completed`** - Finished successfully
   - **`failed`** - Failed with error
   - **Fields:** `id`, `scheduleId`, `sourceName`, `startedAt`, `completedAt`, `status`, `searchesCompleted`, `totalSearches`, `profilesScraped`, `error`

3. **History Retention:**
   - **Max records:** 100 executions
   - **Trimmed:** Oldest records are removed when limit exceeded (line 592)
   - **Sorting:** Newest first (line 561)

4. **Querying Failed/Incomplete Executions:**
   - ✅ **YES** - Can query by status:
     ```javascript
     const history = await getExecutionHistory();
     const failed = history.filter(e => e.status === 'failed');
     const incomplete = history.filter(e => e.status === 'running' && !e.completedAt);
     ```

**Code Evidence:**
```javascript
// Line 520, 592: Max records and trimming
const MAX_HISTORY_RECORDS = 100;
const trimmed = history.slice(0, MAX_HISTORY_RECORDS);
```

#### Question 19.2: Automatic Recovery

**Location:** `background/sync_queue.js` and `background/service_worker.js`

**Findings:**

1. **Automatic Retry Logic:**
   - ✅ **YES** - Queue items have retry logic (line 243-273)
   - **Max retries:** 5 attempts
   - **Backoff:** Exponential (4s, 8s, 16s, 32s, 64s)
   - **Scope:** Only for queue sync failures, not for scraping failures

2. **Resume vs. Restart:**
   - **Queue items:** Resume from where failed (item stays in queue)
   - **Scraping:** Restart from beginning (no resume capability)
   - **Issue:** If scrape fails mid-way, must restart entire scrape

3. **Automatic Retries:**
   - **Queue sync:** 5 automatic retries
   - **Scraping:** No automatic retries
   - **Recommendation:** Add automatic retry for scraping failures (with limit)

4. **Retry vs. Failed:**
   - **Queue items:** Retry up to 5 times, then move to failed queue
   - **Scrapes:** No retry, marked as failed immediately
   - **Trigger:** Error during execution

**Code Evidence:**
```javascript
// Line 247-273: Retry logic
if (item.retryCount >= MAX_RETRIES) {
    newFailedRows.push(item);  // Move to failed
} else {
    remainingQueue.push(item);  // Retry
}
```

#### Question 19.3: Manual Recovery

**Location:** `popup/popup.js` and message handlers

**Findings:**

1. **Manual Retry:**
   - ✅ **YES** - `retryFailedItems()` function exists (line 331 in sync_queue.js)
   - **Trigger:** Via `MESSAGE_ACTIONS.RETRY_FAILED` (line 2489 in service_worker.js)
   - **Action:** Moves failed items back to pending queue with reset retry count

2. **UI for Failed Executions:**
   - ⚠️ **Limited** - Execution history can be viewed, but no dedicated "failed" view
   - **Access:** Via `GET_EXECUTION_HISTORY` message (line 2436)
   - **Recommendation:** Add UI to filter and retry failed executions

3. **Partial Results Processing:**
   - ✅ **YES** - Queue items are processed independently
   - **If scrape fails:** Queued items are still processed
   - **Result:** Partial data is synced even if scrape fails

4. **Force Retry Option:**
   - ✅ **YES** - `retryFailedItems()` resets retry count and moves items back to queue
   - **Access:** Via popup UI (line 1447 in popup.js)
   - **Limitation:** Only for queue items, not for failed scrapes

**Code Evidence:**
```javascript
// Line 331-354: Manual retry
export async function retryFailedItems() {
    const failed = await getFailedRows();
    const resetItems = failed.map(item => ({
        ...item,
        retryCount: 0,  // Reset retry count
        error: null
    }));
    await saveQueue([...queue, ...resetItems]);
}
```

---

### Part 20: Recommendations for Pi Environment

#### 20.1 Configuration Tuning

**Recommended Settings for Raspberry Pi:**

1. **Alarm Intervals:**
   ```javascript
   // Detect Pi platform
   const isPi = navigator.userAgent.includes('CrOS');
   
   // Pi-optimized intervals
   QUEUE_PROCESS_INTERVAL_MINUTES: isPi ? 2.0 : 1.0,  // 120s on Pi, 60s on desktop
   SCHEDULE_CHECK_INTERVAL_MINUTES: isPi ? 2.0 : 1.0,  // 120s on Pi, 60s on desktop
   KEEPALIVE_INTERVAL_MINUTES: 0.25,  // 15s - more aggressive on Pi
   ```

2. **Batch Size Limits:**
   ```javascript
   MAX_BATCH_SIZE: 200,  // Split large batches
   MAX_QUEUE_DEPTH: 100,  // Alert if exceeded
   ```

3. **Timeout Values:**
   ```javascript
   LOCK_TIMEOUT_MS: 5 * 60 * 1000,  // 5 minutes
   STALE_EXECUTION_TIMEOUT_MS: 30 * 60 * 1000,  // 30 minutes (reduce from 1 hour)
   STORAGE_VERIFICATION_DELAY_MS: 100,  // Delay for SD card write
   ```

4. **Memory Thresholds:**
   ```javascript
   MAX_CONCURRENT_OPERATIONS: 2,  // Limit concurrent queue processing
   PAUSE_SCRAPING_IF_QUEUE_DEPTH: 100,  // Backpressure
   ```

#### 20.2 Monitoring for Pi

**Key Metrics to Track:**

1. **Service Worker Health:**
   - Last keep-alive ping timestamp
   - Service worker restart count
   - Time since last restart

2. **Queue Health:**
   - Queue depth over time
   - Average processing time per item
   - Failed items count
   - Stale lock detection count

3. **Resource Usage:**
   - Storage operation timing
   - Memory usage (if available via Chrome APIs)
   - Network failure rate

4. **Alerts:**
   - Stale locks detected
   - Queue depth > 100
   - Service worker restarts > 5 per hour
   - Storage operations > 500ms

#### 20.3 Resilience Improvements

**Specific Changes for Pi:**

1. **Storage Lock Improvements:**
   - Add 100ms delay between write and verification read
   - Add heartbeat mechanism (update lock every 30 seconds)
   - Clear stale locks on service worker startup

2. **Service Worker Persistence:**
   - More aggressive keep-alive (15 seconds)
   - Startup recovery: Check for stale locks and process overdue queue
   - Log service worker lifecycle events

3. **Resource Management:**
   - Pause scraping if queue depth > 100
   - Limit concurrent operations
   - Add backpressure mechanism

4. **Error Recovery:**
   - Automatic retry for failed scrapes (with limit)
   - Resume capability for partial scrapes
   - Better error classification (network vs. other)

5. **Network Resilience:**
   - Longer timeouts for Pi (network may be slower)
   - More retries for network errors
   - Exponential backoff for rate limiting

---

## Summary of Environment & Scheduler Findings

### Key Discoveries:

1. **Service Worker Lifecycle:** Keep-alive exists but may be insufficient on Pi; no restart detection
2. **Storage Performance:** SD card I/O could cause race conditions in lock mechanism; needs delay
3. **Scheduler Architecture:** Pending queue has no depth limit; handoff is immediate with no cooldown
4. **Multi-Device:** Device claiming works but has small race condition window; 1-hour timeout may be too long
5. **Network Resilience:** Good retry logic for API calls, but limited handling for LinkedIn rate limiting
6. **Queue Management:** No depth limits or backpressure; large batches processed all at once
7. **Alarm Configuration:** Fixed intervals may be too aggressive for Pi; no missed alarm detection
8. **Error Recovery:** Good for queue items, but no automatic retry for failed scrapes

### Priority Recommendations:

1. **CRITICAL:** Add storage write delay for lock verification on Pi
2. **HIGH:** Reduce execution claim timeout from 1 hour to 30 minutes
3. **HIGH:** Add queue depth monitoring and backpressure
4. **MEDIUM:** Implement adaptive alarm intervals based on activity
5. **MEDIUM:** Add missed alarm detection and catch-up logic
6. **MEDIUM:** Add batch size limits for large searches
7. **LOW:** Add UI for viewing and retrying failed executions

---

## Part 21-23: Content Script & Final Validation Findings

### Part 21: Content Script & LinkedIn Scraping Mechanics

#### Question 21.1: Content Script Entry Point

**Location:** `content/content.js`

**Findings:**

1. **Main Content Script File:**
   - ✅ **YES** - `content/content.js` is the main content script
   - **Format:** IIFE (Immediately Invoked Function Expression) - no ES modules
   - **Version:** `2025-01-15-linkedin-dom-update-v1` (line 8)
   - **Size:** ~1,390 lines

2. **Trigger to Start Scraping:**
   - ✅ **Message-based** - Content script waits for `START_SCRAPING` message from service worker
   - **Listener:** `chrome.runtime.onMessage.addListener()` (line 1241)
   - **Action:** `'START_SCRAPING'` (line 1254)
   - **Function:** `startScraping(sourceName, maxPages)` (line 1006)

3. **Message from Service Worker:**
   - **Action:** `MESSAGE_ACTIONS.START_SCRAPING` (defined in constants.js)
   - **Payload:** `{ action: 'START_SCRAPING', sourceName: string, maxPages?: number }`
   - **Location:** Service worker sends via `chrome.tabs.sendMessage()` (line 1268 in service_worker.js)

4. **Automatic Scraping on Page Load:**
   - ❌ **NO** - Content script does NOT scrape automatically
   - **Behavior:** Waits for explicit `START_SCRAPING` message
   - **Initialization:** Only logs version and validates selectors on search pages (line 1382-1390)
   - **Reason:** Prevents accidental scraping when user browses LinkedIn

**Code Evidence:**
```javascript
// Line 1241-1269: Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (action) {
        case 'START_SCRAPING':
            const sourceName = message.sourceName || 'Unknown';
            startScraping(sourceName, message.maxPages).catch(...);
            sendResponse({ success: true });
            return true;
    }
});
```

#### Question 21.2: Profile Extraction Logic

**Location:** `content/content.js`, lines 26-46, 298-380, 566-668

**Findings:**

1. **CSS Selectors for Profile Cards:**
   - **Container:** `'li'` - Each result is in an `<li>` (line 28)
   - **Result Template:** `'div[data-view-name="search-entity-result-universal-template"]'` (line 29)
   - **Profile Link:** `'a[href*="/in/"][data-test-app-aware-link]'` (line 32)
   - **Name Text:** `'span[dir="ltr"] > span[aria-hidden="true"]'` (line 33)
   - **Name Fallback:** `'img[alt]'` - Alt attribute of profile photo (line 34)
   - **Title:** `'div.t-14.t-black.t-normal'` (line 37)
   - **Location:** `'div.t-14.t-normal:not(.t-black)'` (line 41)

2. **Data Fields Extracted:**
   - **Name:** Extracted from name span or img alt, cleaned with `parseNameWithAccreditations()` (line 575)
   - **Title/Headline:** Extracted from `div.t-14.t-black.t-normal` (line 531-534)
   - **Company:** ❌ **NOT extracted separately** - Included in title if present (e.g., "Financial Advisor at Company")
   - **Location:** Extracted from `div.t-14.t-normal:not(.t-black)` (line 538-547)
   - **Profile URL:** Extracted from `nameLink.href`, normalized (line 584-588)
   - **LinkedIn ID:** ❌ **NOT extracted** - Only URL is stored
   - **Accreditations:** Extracted from name text (parentheses and comma-separated) (line 96-151)

3. **"LinkedIn Member" Handling:**
   - ⚠️ **Limited handling** - No explicit check for restricted profiles
   - **Behavior:** If name is "LinkedIn Member", it would be extracted as-is
   - **Filter:** Name validation checks for minimum length (3 chars) and excludes UI text (line 357-359)
   - **Issue:** "LinkedIn Member" might pass filters if it's 15+ characters

4. **Page Load Wait:**
   - ✅ **YES** - Multiple wait mechanisms:
     - `waitForEntriesToLoad()` waits for at least 1 profile card (line 673-713)
     - Timeout: 20 seconds (line 1049)
     - Scrolls to bottom to trigger lazy loading (line 717-724)
     - Extra 2-second wait for slower machines (line 727)

**Code Evidence:**
```javascript
// Line 566-668: Profile data extraction
function extractProfileData(cardInfo, sourceName) {
    const { cleanName, accreditations } = parseNameWithAccreditations(nameText);
    // ... extraction logic ...
    return [
        today,           // Date
        cleanName,       // Name
        title,           // Title
        location,        // Location
        sourceName,      // Connection Source
        url,             // LinkedIn URL
        ...accreditations // 6 accreditation fields
    ];
}
```

#### Question 21.3: Pagination Flow

**Location:** `content/content.js`, lines 875-932, 1027-1176

**Findings:**

1. **Pagination Handling:**
   - ✅ **Button click** - Uses `clickNextButton()` function (line 921-932)
   - **Method:** Clicks the "Next" button using `pagination.button.click()` (line 928)
   - **Does NOT modify URL** - Relies on LinkedIn's JavaScript navigation
   - **Selector:** `'button[aria-label="Next"]'` (line 45)

2. **Last Page Detection:**
   - ✅ **Multiple checks:**
     - Checks if Next button exists and is enabled (line 882-894)
     - Checks for empty results state (line 816-873)
     - Checks for consecutive empty pages (line 1084-1094)
     - Checks if button is disabled or hidden (line 884-894)
   - **Logic:** `detectPaginationState()` returns `hasNext: false` if no button or button disabled (line 905)

3. **Wait After Clicking Next:**
   - **Initial wait:** 2 seconds after click (line 929)
   - **Page load wait:** 3 seconds after navigation (line 1152)
   - **Entry load wait:** Up to 20 seconds for entries to load (line 1049)
   - **Total:** ~5-25 seconds per page transition

4. **Maximum Pages:**
   - ✅ **YES** - `CONFIG.MAX_PAGES: 1000` (line 14)
   - **Override:** Can be set via `maxPages` parameter in `START_SCRAPING` message
   - **Limit:** Enforced in loop condition: `while (totalPages < maxPages && !stopRequested)` (line 1027)

**Code Evidence:**
```javascript
// Line 921-932: Next button click
async function clickNextButton() {
    const pagination = detectPaginationState();
    if (!pagination.hasNext || !pagination.button) {
        return false;
    }
    pagination.button.click();
    await wait(2000);  // 2 second wait
    return true;
}
```

#### Question 21.4: Data Sending to Service Worker

**Location:** `content/content.js`, lines 1100-1105, 1182-1187

**Findings:**

1. **When `DATA_SCRAPED` is Sent:**
   - ✅ **After each page** - Sent immediately after scraping a page with results (line 1101-1105)
   - **NOT after each profile** - All profiles from a page are sent together
   - **NOT after all pages** - Sent incrementally as pages are scraped
   - **Condition:** Only sent if `rows.length > 0` (line 1096)

2. **Data in `DATA_SCRAPED` Message:**
   ```javascript
   {
       action: 'DATA_SCRAPED',
       rows: Array,      // Array of profile rows (Sheets format)
       pageNumber: number  // Current page number
   }
   ```
   - **Rows format:** `[Date, Name, Title, Location, Source, URL, Accreditations...]` (line 659-667)
   - **Page number:** Incremental counter (1, 2, 3, ...)

3. **When `SCRAPING_COMPLETE` is Sent:**
   - ✅ **After all pages complete** - Sent at end of scraping loop (line 1182-1187)
   - **Also sent on error** - Sent in catch block if error occurs (line 1223-1228)
   - **Also sent in finally** - Not sent in finally, but state is reset (line 1230-1235)

4. **Race Condition Risk:**
   - ⚠️ **YES** - Potential race condition:
     - `SCRAPING_COMPLETE` is sent immediately after loop ends (line 1182)
     - But `DATA_SCRAPED` messages are sent asynchronously via `sendMessageSafe()` (line 1101)
     - **If network is slow:** `SCRAPING_COMPLETE` might arrive before final `DATA_SCRAPED`
     - **Mitigation:** Service worker listens for both messages and tracks activity (line 1489-1493 in service_worker.js)

**Code Evidence:**
```javascript
// Line 1096-1105: Send data after each page
if (rows.length > 0) {
    totalProfiles += rows.length;
    totalPages++;
    
    sendMessageSafe({
        action: 'DATA_SCRAPED',
        rows: rows,
        pageNumber: totalPages
    });
}

// Line 1182-1187: Send completion
sendMessageSafe({
    action: 'SCRAPING_COMPLETE',
    totalProfiles: totalProfiles,
    totalPages: totalPages,
    aborted: wasAborted
});
```

#### Question 21.5: Error Handling in Content Script

**Location:** `content/content.js`, lines 764-801, 1051-1078, 1189-1235

**Findings:**

1. **Missing Profile Elements:**
   - ✅ **Handled** - `extractProfileData()` returns `null` if required elements missing (line 570-588)
   - **Validation:** Checks for name, URL, title/location (line 570-581)
   - **Logging:** Warns and skips invalid cards (line 571, 579, 586)
   - **Result:** Invalid cards are skipped, scraping continues

2. **Missing Next Button:**
   - ✅ **Handled** - `detectPaginationState()` returns `hasNext: false` (line 905)
   - **Action:** Loop breaks when `hasNext === false` (line 1120-1123, 1146-1149)
   - **Logging:** "No more pages available" (line 1147)

3. **Rate Limit Page:**
   - ⚠️ **Limited handling** - No explicit rate limit detection
   - **Auth check:** `checkLinkedInAuthStatus()` detects login/authwall pages (line 221-293)
   - **Issue:** Rate limit pages might not be detected as auth issues
   - **Recommendation:** Add rate limit page detection

4. **CAPTCHA:**
   - ✅ **Partially handled** - `checkLinkedInAuthStatus()` checks for CAPTCHA (line 279-290)
   - **Detection:** Looks for `.captcha`, `#captcha`, `iframe[src*="captcha"]`
   - **Status:** Returns `status: 'checkpoint'` if CAPTCHA detected
   - **Action:** Service worker should handle checkpoint status

5. **Error Communication:**
   - ✅ **YES** - Errors sent via `SCRAPE_ERROR` message (line 788-800)
   - **Format:**
     ```javascript
     {
         action: 'SCRAPE_ERROR',
         personName: string,
         searchName: string,
         failureType: string,
         error: string,
         errorDetails: object
     }
     ```
   - **Also:** Errors in scraping loop send `SCRAPING_COMPLETE` with error field (line 1223-1228)

**Code Evidence:**
```javascript
// Line 764-801: Error handling in profile extraction
try {
    const row = extractProfileData(cardInfo, sourceName);
    if (!row) continue;  // Skip invalid cards
    rows.push(row);
} catch (error) {
    sendMessageSafe({
        action: 'SCRAPE_ERROR',
        personName: personName,
        searchName: searchName,
        failureType: 'parse_error',
        error: errorMessage
    });
}
```

#### Question 21.6: Timing and Delays

**Location:** `content/content.js`, lines 13-21, 74-88, 1165-1175

**Findings:**

1. **Delay Between Profiles:**
   - ❌ **NO** - No delay between scraping individual profiles on same page
   - **Processing:** All profiles on a page are scraped sequentially without delays
   - **Reason:** Profiles are already loaded on page, no need for delays

2. **Delay After Page Load:**
   - ✅ **YES** - Multiple delays:
     - Initial wait: 2 seconds after page navigation (line 1034)
     - Scroll wait: 4 seconds after scrolling (line 718)
     - Additional scrolls: 3 × 1 second (line 721-724)
     - Extra wait: 2 seconds for slower machines (line 727)
     - **Total:** ~11 seconds minimum before scraping starts

3. **Configurable Delays:**
   - ✅ **YES** - All delays in `CONFIG` object (line 13-21):
     - `MIN_WAIT_SECONDS: 15` - Minimum delay between pages
     - `MAX_WAIT_SECONDS: 40` - Maximum delay between pages
     - `SCROLL_WAIT_MS: 4000` - Wait after scrolling
     - `LONG_PAUSE_CHANCE: 0.15` - 15% chance of long pause
     - `LONG_PAUSE_MIN_SECONDS: 45` - Minimum long pause
     - `LONG_PAUSE_MAX_SECONDS: 120` - Maximum long pause

4. **Total Time to Scrape 10 Profiles:**
   - **Page load wait:** ~11 seconds
   - **Scraping 10 profiles:** ~1-2 seconds (sequential, no delays)
   - **Random delay before next page:** 15-40 seconds
   - **Long pause (15% chance):** +45-120 seconds
   - **Total for 1 page:** ~27-153 seconds (average ~60 seconds)
   - **Note:** This is per page, not per profile

**Code Evidence:**
```javascript
// Line 1165-1175: Delays between pages
const delay = randomDelay();  // 15-40 seconds
await wait(delay);

if (shouldTakeLongPause()) {  // 15% chance
    const longDelay = longPauseDelay();  // 45-120 seconds
    await wait(longDelay);
}
```

---

### Part 22: Immediate Fix Validation

#### Question 22.1: Quick Lock Test

**Test Implementation:**

The simple lock test can be added to `sync_queue.js`:

```javascript
// TEMPORARY: Simple lock test
const LOCK_KEY = 'tempQueueLock';

export async function processQueue() {
    // Check lock
    const { [LOCK_KEY]: lock } = await chrome.storage.local.get([LOCK_KEY]);
    if (lock?.isLocked) {
        console.log('[QUEUE] ⏸️ LOCK TEST: Already processing, skipping');
        return { synced: 0, failed: 0, pending: 0, skipped: true };
    }
    
    // Set lock
    await chrome.storage.local.set({ [LOCK_KEY]: { isLocked: true, timestamp: Date.now() } });
    
    try {
        const queue = await getQueue();
        // ... existing processing logic ...
    } finally {
        // Release lock
        await chrome.storage.local.set({ [LOCK_KEY]: { isLocked: false } });
    }
}
```

**Expected Results:**

1. **During Typical Scrape:**
   - Alarm fires every 60 seconds → First call acquires lock, processes queue
   - If alarm fires again while processing → Second call sees lock, skips with "LOCK TEST: Already processing, skipping"
   - `DATA_SCRAPED` triggers immediate processing → Sees lock, skips
   - **Expected skipped messages:** 1-5 per scrape (depending on scrape duration and alarm timing)

2. **Duplicate Prevention:**
   - If lock works: No duplicate processing
   - Sheets/BigQuery should show each item only once
   - **Verification:** Check Sheets for duplicate rows, check BigQuery for duplicate observations

3. **Edge Cases to Monitor:**
   - Lock not released (service worker crash) → Next processing will be blocked
   - Lock released too early → Race condition still possible
   - Multiple rapid `DATA_SCRAPED` messages → All but first should be skipped

**Documentation Needed:**
- Count of "skipped" messages during test scrape
- Verification that duplicates stop appearing
- Any issues with lock not being released

#### Question 22.2: Alarm Disable Test

**Test Implementation:**

Temporarily increase queue process alarm interval:

```javascript
// In utils/constants.js
QUEUE_PROCESS_INTERVAL_MINUTES: 10.0,  // Was 1.0
```

**Expected Results:**

1. **During Typical Scrape:**
   - Alarm won't fire during scrape (scrapes typically complete in <10 minutes)
   - Only immediate processing from `DATA_SCRAPED` messages will occur
   - **If duplicates stop:** Confirms alarm is primary trigger of race condition
   - **If duplicates continue:** Indicates immediate processing is also causing issues

2. **Confirmation:**
   - **If duplicates stop:** Alarm is confirmed as primary race condition trigger
   - **If duplicates continue:** Both alarm and immediate processing need locking

**Documentation Needed:**
- Whether duplicates stop when alarm is effectively disabled
- This confirms the alarm is the primary trigger

---

### Part 23: Architecture Summary

#### Component Overview

**1. Service Worker** (`background/service_worker.js`)
- **Role:** Orchestrator - manages scraping, scheduling, queue processing
- **Key Functions:**
  - `processManualScrape()` - Manual scrape execution
  - `executeScheduledRun()` - Scheduled scrape execution
  - `processPendingSchedules()` - Handles deferred schedules
  - Alarm handlers for queue processing, schedule checking

**2. Content Script** (`content/content.js`)
- **Role:** LinkedIn page scraper - extracts profile data from DOM
- **Key Functions:**
  - `startScraping()` - Main scraping loop
  - `scrapeCurrentPage()` - Extracts profiles from current page
  - `extractProfileData()` - Extracts individual profile data
  - `detectPaginationState()` - Checks for next page
  - `clickNextButton()` - Navigates to next page

**3. Sync Queue** (`background/sync_queue.js`)
- **Role:** Buffer for scraped data - queues data before syncing
- **Key Functions:**
  - `addToQueue()` - Adds scraped rows to queue
  - `processQueue()` - Processes queued items, syncs to Sheets/BigQuery
  - `getQueueStatus()` - Returns queue statistics

**4. BigQuery Sync** (`background/bigquery_sync.js`)
- **Role:** Syncs data to BigQuery via Apps Script Web App
- **Key Functions:**
  - `syncProfilesToBigQuery()` - Syncs profiles to BigQuery
  - `recordSearchObservations()` - Records point-in-time observations
  - `getOrCreateRecruiter()` - Manages recruiter records

**5. Scheduler** (`background/scheduler.js`)
- **Role:** Manages scheduled scrapes - bi-weekly scheduling
- **Key Functions:**
  - `checkSchedules()` - Checks which schedules are due
  - `addPendingSchedule()` - Queues schedules deferred due to overlap
  - `markScheduleRun()` - Updates schedule after execution

**6. Storage** (Chrome Storage API)
- **Role:** Persistent state storage
- **Keys:**
  - `syncQueue` - Pending queue items
  - `failedRows` - Failed queue items
  - `schedules` - Schedule configurations
  - `executionHistory` - Execution records
  - `pendingSchedules` - Deferred schedules
  - `autoRunState` - Current auto-run state
  - `manualScrapeState` - Current manual scrape state

#### Data Flow

```
1. Service Worker → Content Script
   └─> Sends: START_SCRAPING message
       └─> Content script starts scraping loop

2. Content Script → Service Worker
   └─> Sends: DATA_SCRAPED messages (after each page)
       └─> Service worker adds to queue
       └─> Service worker triggers processQueue()

3. Service Worker → Sync Queue
   └─> processQueue() reads queue
       └─> For each item:
           ├─> Syncs to Google Sheets
           ├─> Syncs to BigQuery
           └─> Records observations

4. Content Script → Service Worker
   └─> Sends: SCRAPING_COMPLETE message
       └─> Service worker marks search complete
       └─> Service worker moves to next search
```

#### Message Flow

**Service Worker → Content Script:**
- `START_SCRAPING` - Start scraping with source name
- `STOP_SCRAPING` - Stop current scraping
- `GET_STATUS` - Check if scraping is active
- `CHECK_LINKEDIN_AUTH` - Check authentication status

**Content Script → Service Worker:**
- `DATA_SCRAPED` - Send scraped profiles from a page
- `SCRAPING_COMPLETE` - Indicate scraping finished
- `SCRAPE_ERROR` - Report scraping error
- `PING` - Health check

**Internal Service Worker Messages:**
- `QUEUE_UPDATED` - Queue processing complete
- `QUEUE_SYNC_FAILED` - Queue item failed after max retries
- `MANUAL_SCRAPE_PROGRESS` - Manual scrape progress update
- `EXECUTION_HISTORY_UPDATED` - Execution record updated

#### Race Condition Points

**1. Queue Processing Race Condition (PRIMARY)**
- **Location:** `sync_queue.js:121` - `processQueue()`
- **Trigger Points:**
  - Alarm fires every 60 seconds (line 345 in service_worker.js)
  - Immediate processing after `DATA_SCRAPED` (line 1783 in service_worker.js)
- **Issue:** Both can call `processQueue()` concurrently
- **Fix:** Add storage-based lock with optimistic locking

**2. Schedule Execution Race Condition**
- **Location:** `service_worker.js:513` - `executeScheduledRun()`
- **Trigger:** Multiple devices see same schedule
- **Issue:** Two devices can claim same schedule
- **Fix:** Device claiming with 1-hour timeout (already implemented, but timeout may be too long)

**3. Search Completion Race Condition**
- **Location:** `content/content.js:1182` - `SCRAPING_COMPLETE` sent
- **Issue:** `SCRAPING_COMPLETE` might arrive before final `DATA_SCRAPED`
- **Impact:** Minor - data still queued, just timing is off
- **Fix:** Service worker should wait for queue to be empty before marking search complete

**4. BigQuery Double-Sync**
- **Location:** `sync_queue.js:169` - `syncProfilesToBigQuery()` called
- **Issue:** If `processQueue()` runs twice, BigQuery sync happens twice
- **Fix:** Same as queue processing lock - prevents duplicate `processQueue()` calls

#### Lock Placement Recommendations

**1. Queue Processing Lock (CRITICAL)**
- **Location:** `sync_queue.js:121` - Start of `processQueue()`
- **Type:** Storage-based lock with timestamp verification
- **Timeout:** 5 minutes (stale lock detection)
- **Release:** In `finally` block

**2. Alarm Guard (HIGH)**
- **Location:** `service_worker.js:342` - `QUEUE_PROCESS` alarm handler
- **Type:** Check lock before calling `processQueue()`
- **Action:** Skip if lock is held and not stale

**3. Immediate Processing Guard (HIGH)**
- **Location:** `service_worker.js:1783` - `DATA_SCRAPED` handler
- **Type:** Check lock before calling `processQueue()`
- **Action:** Skip if lock is held (alarm will handle it)

**4. Observation Deduplication (MEDIUM)**
- **Location:** `big_query/apps-script/Code.gs` - `recordObservationsBatch()`
- **Type:** Backend duplicate check
- **Key:** `advisor_id + recruiter_id + observation_date`

---

## Final Summary

### Root Causes Identified:

1. **PRIMARY:** Race condition in `processQueue()` - no lock prevents concurrent execution
2. **SECONDARY:** Alarm fires every 60 seconds without checking if processing is in progress
3. **SECONDARY:** Immediate processing after `DATA_SCRAPED` can overlap with alarm-triggered processing
4. **TERTIARY:** Service worker termination on Pi causes in-flight processing to be lost
5. **TERTIARY:** No observation deduplication in backend causes duplicate records

### Fix Priority:

1. **CRITICAL:** Add storage-based lock to `processQueue()` with optimistic locking
2. **HIGH:** Add alarm guard to skip processing if lock is held
3. **HIGH:** Add immediate processing guard to respect lock
4. **HIGH:** Add observation deduplication in backend
5. **MEDIUM:** Reduce execution claim timeout from 1 hour to 30 minutes
6. **MEDIUM:** Add storage write delay for Pi (100ms between write and verification)
7. **MEDIUM:** Add heartbeat mechanism to lock (update every 30 seconds)

### Testing Strategy:

1. **Quick Lock Test:** Add simple lock to `processQueue()`, verify duplicates stop
2. **Alarm Disable Test:** Increase alarm interval to 10 minutes, verify duplicates stop
3. **Full Fix Test:** Implement complete lock mechanism, verify no duplicates
4. **Pi-Specific Test:** Test on Pi with storage delays and longer intervals
5. **Multi-Device Test:** Verify device claiming prevents duplicate scrapes

### Architecture Improvements:

1. **Lock Mechanism:** Storage-based with optimistic locking and stale detection
2. **Error Recovery:** Better handling of service worker termination
3. **Resource Management:** Queue depth limits and backpressure on Pi
4. **Monitoring:** Lock acquisition/release logging, duplicate detection alerts
5. **Resilience:** Network retry improvements, rate limit detection

---

## Part 21-25: Final Investigation & Fix Validation

### Part 21: Data Flow Verification

#### Question 21.1: DATA_SCRAPED Message Timing

**Location:** `content/content.js`, lines 1096-1107

**Findings:**

1. **When `DATA_SCRAPED` is Sent:**
   - ✅ **After each page of results** - Sent immediately after scraping a page (line 1101-1105)
   - **NOT after all pages** - Sent incrementally as pages are scraped
   - **NOT after each profile** - All profiles from a page are sent together in one message
   - **Condition:** Only sent if `rows.length > 0` (line 1096)

2. **Profiles Per Message:**
   - **Typical:** 10 profiles per page (LinkedIn default)
   - **Range:** 0-10 profiles (0 if page is empty, skipped)
   - **Format:** All profiles from one page sent in single `DATA_SCRAPED` message

3. **Message Count for 100 Profiles Across 10 Pages:**
   - **Expected:** 10 `DATA_SCRAPED` messages (one per page)
   - **Each message:** Contains ~10 profiles
   - **Total:** 10 messages × 10 profiles = 100 profiles

4. **Race Condition Impact:**
   - ⚠️ **HIGH** - Each `DATA_SCRAPED` message triggers `processQueue()` (line 1783)
   - **For 10-page search:** 10 immediate `processQueue()` calls
   - **Plus alarm:** 1 call every 60 seconds
   - **Total potential calls:** 10+ immediate + N alarm calls during scrape
   - **Race condition frequency:** Very high - every `DATA_SCRAPED` can race with alarm

**Code Evidence:**
```javascript
// Line 1096-1107: Send DATA_SCRAPED after each page
if (rows.length > 0) {
    totalProfiles += rows.length;
    totalPages++;
    
    sendMessageSafe({
        action: 'DATA_SCRAPED',
        rows: rows,  // All profiles from this page
        pageNumber: totalPages
    });
}
```

#### Question 21.2: SCRAPING_COMPLETE vs DATA_SCRAPED Order

**Location:** `content/content.js`, lines 1027-1187

**Findings:**

1. **Message Order:**
   - ✅ **SCRAPING_COMPLETE is ALWAYS sent AFTER all DATA_SCRAPED messages**
   - **Sequence:** All pages scraped → Loop exits → `SCRAPING_COMPLETE` sent (line 1182-1187)
   - **Guarantee:** `SCRAPING_COMPLETE` is sent after the `while` loop completes (line 1176)

2. **Potential Race:**
   - ⚠️ **YES** - But not in content script
   - **Issue:** `sendMessageSafe()` is asynchronous (line 1101, 1182)
   - **If network is slow:** `SCRAPING_COMPLETE` message might be queued before final `DATA_SCRAPED` completes transmission
   - **However:** Content script sends them sequentially, so order is preserved in sending
   - **Service worker side:** Messages might arrive out of order if network delays differ

3. **Actual Sequence for Multi-Page Search:**
   ```
   Page 1 scraped → DATA_SCRAPED (10 profiles) [sent]
   Page 2 scraped → DATA_SCRAPED (10 profiles) [sent]
   ...
   Page 10 scraped → DATA_SCRAPED (10 profiles) [sent]
   Loop exits → SCRAPING_COMPLETE [sent]
   ```
   - **Content script:** Sequential sending, order preserved
   - **Service worker:** May receive out of order if network delays differ

4. **Service Worker Handling:**
   - ✅ **Handles both messages** - Listens for `DATA_SCRAPED` (line 1770) and `SCRAPING_COMPLETE` (line 1473)
   - **Activity tracking:** `DATA_SCRAPED` updates `lastActivityTime` (line 1492)
   - **Completion:** `SCRAPING_COMPLETE` resolves the wait (line 1473-1486)

**Code Evidence:**
```javascript
// Line 1027-1176: Scraping loop
while (totalPages < maxPages && !stopRequested) {
    // ... scrape page ...
    if (rows.length > 0) {
        sendMessageSafe({ action: 'DATA_SCRAPED', ... });  // Sent during loop
    }
    // ... pagination ...
}

// Line 1182-1187: Completion sent AFTER loop
sendMessageSafe({
    action: 'SCRAPING_COMPLETE',
    totalProfiles: totalProfiles,
    totalPages: totalPages
});
```

---

### Part 22: Immediate Fix Validation

#### Question 22.1: Simple Lock Test

**Implementation:**

The simple lock test code is provided in the question document. Key points:

1. **Lock Key:** `'queueProcessingLock'`
2. **Lock Timeout:** 5 minutes
3. **Lock Check:** Before processing, check if lock exists and is not stale
4. **Lock Acquisition:** Set lock with timestamp
5. **Lock Release:** In `finally` block

**Expected Test Results:**

1. **During Typical Scrape (9 searches, ~10 pages each = 90 pages):**
   - **DATA_SCRAPED messages:** ~90 messages (one per page)
   - **Immediate processQueue() calls:** ~90 calls
   - **Alarm calls:** ~1-2 calls per search = ~9-18 calls during entire scrape
   - **Total processQueue() attempts:** ~99-108 calls
   - **Expected "skipping" messages:** ~98-107 (all but the first successful call)
   - **Lock acquired messages:** ~1-10 (depending on timing)

2. **Duplicate Prevention:**
   - **If lock works:** Each queue item processed exactly once
   - **Sheets:** No duplicate rows
   - **BigQuery:** No duplicate observations
   - **Verification:** Compare scraped count vs Sheets count (should match)

3. **Potential Issues:**
   - **Lock not released:** If service worker crashes, lock remains, blocking future processing
   - **Stale lock:** 5-minute timeout should handle this
   - **Storage race:** Small window between check and set (optimistic locking needed for production)

**Test Documentation Needed:**
- Count of "🔒 Lock acquired" messages
- Count of "⏸️ Queue processing already in progress, skipping" messages
- Verification that duplicates stop in Sheets/BigQuery
- Any errors or lock-related issues

#### Question 22.2: Verify No Data Loss

**Investigation:**

1. **Queue Items Being Lost:**
   - ⚠️ **Potential issue** - If lock prevents processing, items remain in queue
   - **Expected:** Items should be processed on next successful lock acquisition
   - **Risk:** If lock is never released (crash), items stuck in queue
   - **Mitigation:** 5-minute stale lock timeout allows recovery

2. **Total Profiles Comparison:**
   - **Scraped count:** From content script `totalProfiles`
   - **Sheets count:** From `countRowsInTab()` (excluding header)
   - **Expected:** Should match exactly
   - **If mismatch:** Indicates data loss or duplicate processing

3. **Pending Count:**
   - **During scrape:** Pending count should grow as pages are scraped
   - **After scrape:** Pending count should go to 0 after all items processed
   - **If pending > 0 after completion:** Items stuck in queue (lock issue or processing error)

**Queue State Check:**
```javascript
// Run in console to check queue state
chrome.storage.local.get(['syncQueue', 'failedRows'], (data) => {
    console.log('Queue depth:', data.syncQueue?.length || 0);
    console.log('Failed items:', data.failedRows?.length || 0);
    console.log('Total pending rows:', data.syncQueue?.reduce((sum, item) => sum + item.rows.length, 0) || 0);
});
```

**Expected Results:**
- **During scrape:** Queue depth increases with each page
- **After scrape:** Queue depth decreases as items are processed
- **Final state:** Queue depth = 0, failed items = 0 (or only truly failed items)

---

### Part 23: Race Condition Timing Analysis

#### Question 23.1: How Often Does the Race Occur?

**Analysis Based on Code:**

For a typical scrape (9 searches, 10 pages each = 90 pages total):

1. **DATA_SCRAPED Messages:**
   - **Total:** ~90 messages (one per page)
   - **Each triggers:** Immediate `processQueue()` call (line 1783)
   - **Total immediate calls:** ~90

2. **Alarm Calls:**
   - **Interval:** Every 60 seconds
   - **Scrape duration:** ~15-30 minutes (90 pages × ~20 seconds/page)
   - **Alarm calls during scrape:** ~15-30 calls
   - **Total alarm calls:** ~15-30

3. **Total processQueue() Attempts:**
   - **Immediate calls:** ~90
   - **Alarm calls:** ~15-30
   - **Total:** ~105-120 attempts

4. **Expected "Skipping" Messages (with lock):**
   - **First call:** Acquires lock, processes
   - **Subsequent calls:** See lock, skip
   - **Expected skips:** ~104-119 (all but first)
   - **Percentage of duplicate calls:** ~99% (almost all calls are duplicates!)

5. **Race Condition Frequency:**
   - **Without lock:** ~105-120 race conditions per scrape
   - **With lock:** ~0 race conditions (only first call processes)
   - **Impact:** Very high - almost every call would race without lock

**Documentation for Test Run:**
- Total `DATA_SCRAPED` messages received: ~90
- Total `processQueue()` calls from alarm: ~15-30
- Total "skipping" messages: ~104-119
- Percentage of calls that were duplicates: ~99%

#### Question 23.2: Alarm vs Immediate Call Breakdown

**Investigation with Logging:**

1. **Alarm Calls:**
   - **Frequency:** Every 60 seconds
   - **During 30-minute scrape:** ~30 calls
   - **Pattern:** Regular, predictable timing

2. **Immediate Calls (DATA_SCRAPED):**
   - **Frequency:** After each page (every ~20-60 seconds)
   - **During 30-minute scrape:** ~90 calls
   - **Pattern:** Irregular, depends on scraping speed

3. **Which Causes More Duplicates:**
   - **Immediate calls:** ~90 calls, more frequent
   - **Alarm calls:** ~30 calls, less frequent
   - **Winner:** Immediate calls are more likely to cause duplicates (3x more calls)
   - **However:** Alarm calls can race with immediate calls, causing additional duplicates

4. **Race Scenarios:**
   - **Scenario 1:** Immediate call + Alarm call at same time = 2x processing
   - **Scenario 2:** Two immediate calls in quick succession = 2x processing
   - **Scenario 3:** Immediate call + Alarm call + Another immediate call = 3x processing
   - **Most common:** Immediate call racing with alarm call

**Logging Implementation:**
```javascript
// In alarm handler (service_worker.js:342)
case ALARM_NAMES.QUEUE_PROCESS:
    console.log(`${LOG} Queue process tick [ALARM TRIGGER]`);
    // ... existing code ...

// In DATA_SCRAPED handler (service_worker.js:1783)
console.log(`${LOG} Processing queue [DATA_SCRAPED TRIGGER]`);
processQueue().catch(e => console.error(`${LOG} Queue error:`, e));
```

**Expected Log Output:**
```
[SW] Received 10 rows from page 1
[SW] Processing queue [DATA_SCRAPED TRIGGER]
[QUEUE] 🔒 Lock acquired
[SW] Queue process tick [ALARM TRIGGER]
[QUEUE] ⏸️ Queue processing already in progress (lock age: 2s), skipping
[SW] Received 10 rows from page 2
[SW] Processing queue [DATA_SCRAPED TRIGGER]
[QUEUE] ⏸️ Queue processing already in progress (lock age: 5s), skipping
```

---

### Part 24: Service Worker Message Handler Review

#### Question 24.1: DATA_SCRAPED Handler Flow

**Location:** `background/service_worker.js`, lines 1770-1787

**Findings:**

1. **Exact Flow:**
   ```javascript
   case MESSAGE_ACTIONS.DATA_SCRAPED: {
       const { rows, pageNumber } = message;
       console.log(`${LOG} Received ${rows.length} rows from page ${pageNumber}`);
       
       // 1. Get source mapping
       const { sourceMapping } = await getFromStorage([STORAGE_KEYS.SOURCE_MAPPING]);
       const sourceName = rows[0]?.[4];
       const workbookId = sourceMapping?.[sourceName] || currentOutputSheetId;
       
       if (workbookId) {
           // 2. Ensure weekly tab exists
           const { tabName } = await ensureWeeklyTab(workbookId);
           
           // 3. Add to queue (AWAITED)
           await addToQueue(rows, workbookId, tabName);
           
           // 4. Trigger immediate processing (FIRE-AND-FORGET)
           processQueue().catch(e => console.error(`${LOG} Queue error:`, e));
       }
       
       // 5. Send response (immediately, doesn't wait for processQueue)
       response = { success: true, queued: rows.length };
       break;
   }
   ```

2. **Is `addToQueue()` Awaited?**
   - ✅ **YES** - `await addToQueue(...)` (line 1780)
   - **Guarantee:** Queue is updated before `processQueue()` is called
   - **No race:** Items are in queue before processing starts

3. **Is `processQueue()` Awaited?**
   - ❌ **NO** - Fire-and-forget with `.catch()` only (line 1783)
   - **Reason:** Non-blocking - response sent immediately
   - **Issue:** Response sent before processing completes
   - **Impact:** Response doesn't indicate if processing succeeded

4. **Could Response Be Sent Before Queue Processed?**
   - ✅ **YES** - Response is sent immediately after `addToQueue()` (line 1786)
   - **Timing:** Response sent before `processQueue()` even starts
   - **Impact:** Response only confirms items were queued, not processed
   - **This is acceptable** - Queue processing is asynchronous

**Code Evidence:**
```javascript
// Line 1780: Awaited
await addToQueue(rows, workbookId, tabName);

// Line 1783: Fire-and-forget
processQueue().catch(e => console.error(`${LOG} Queue error:`, e));

// Line 1786: Response sent immediately
response = { success: true, queued: rows.length };
```

#### Question 24.2: Should Immediate Processing Be Removed?

**Analysis:**

**Pros of Removing Immediate Call:**
1. ✅ **Eliminates one source of race condition** - Only alarm would trigger processing
2. ✅ **Simpler code** - One less code path to maintain
3. ✅ **Alarm handles it anyway** - Items processed within 60 seconds
4. ✅ **Lock still needed** - But simpler (only one caller)

**Cons of Removing Immediate Call:**
1. ⚠️ **0-60 second delay** - Data doesn't sync immediately
2. ⚠️ **Less responsive** - Users might expect immediate sync
3. ⚠️ **Queue could grow** - If many pages scraped quickly, queue could get large

**Recommendation:**

✅ **YES - Remove immediate processing** for the following reasons:

1. **Race condition elimination:** Removes 90% of race condition triggers (immediate calls)
2. **60-second delay is acceptable:** Data syncs within 1 minute, which is reasonable
3. **Simpler architecture:** One trigger (alarm) is easier to reason about
4. **Lock still needed:** Alarm could still fire multiple times if processing is slow
5. **Queue growth manageable:** 60-second processing interval keeps queue small

**Alternative: Keep immediate call but with lock check:**
- Check lock before calling `processQueue()`
- If lock held, skip (alarm will handle it)
- If lock free, acquire and process
- **This is the recommended approach** - Best of both worlds

**Implementation:**
```javascript
// In DATA_SCRAPED handler
await addToQueue(rows, workbookId, tabName);

// Check lock before processing
const { [QUEUE_LOCK_KEY]: lock } = await chrome.storage.local.get([QUEUE_LOCK_KEY]);
const now = Date.now();

if (!lock?.isLocked || (now - lock.timestamp) >= LOCK_TIMEOUT_MS) {
    // Lock is free or stale - process immediately
    processQueue().catch(e => console.error(`${LOG} Queue error:`, e));
} else {
    // Lock is held - alarm will handle it
    console.log(`${LOG} Queue processing in progress, alarm will handle new items`);
}

response = { success: true, queued: rows.length };
```

---

### Part 25: Final Architecture Confirmation

#### Question 25.1: Current (Buggy) Flow Sequence Diagram

```
Content Script          Service Worker           Sync Queue          Storage
      |                       |                      |                 |
      |--DATA_SCRAPED(10)---->|                      |                 |
      |                       |--addToQueue()------->|                 |
      |                       |                      |--save---------->|
      |                       |--processQueue()------------------------>| (CALL 1)
      |                       |                      |                 |
      |                       |    [Reads queue: [item1]]             |
      |                       |    [Processes item1]                 |
      |                       |                      |                 |
      |        [60s alarm fires]                     |                 |
      |                       |--processQueue()------------------------>| (CALL 2 - RACE!)
      |                       |                      |                 |
      |                       |    [Reads queue: [item1]] (same item!) |
      |                       |    [Processes item1] (DUPLICATE!)      |
      |                       |                      |                 |
      |--DATA_SCRAPED(10)---->|                      |                 |
      |                       |--addToQueue()------->|                 |
      |                       |                      |--save---------->|
      |                       |--processQueue()------------------------>| (CALL 3 - RACE!)
      |                       |                      |                 |
      |                       |    [CALL 1 saves: []]                  |
      |                       |    [CALL 2 saves: []]                   |
      |                       |    [CALL 3 reads: [item2]]             |
      |                       |    [CALL 3 processes item2]            |
      |                       |                      |                 |
      |                       |    [CALL 1 completes]                  |
      |                       |    [CALL 2 completes]                  |
      |                       |    [CALL 3 completes]                  |
      |                       |                      |                 |
      |                       |    Result: item1 processed 2x, item2 processed 1x
```

**Race Condition Points:**
- ⚠️ **Point 1:** Alarm fires while immediate call is processing (CALL 1 vs CALL 2)
- ⚠️ **Point 2:** Immediate call fires while previous call is processing (CALL 2 vs CALL 3)
- ⚠️ **Point 3:** Multiple immediate calls in quick succession

#### Question 25.2: Fixed Flow Sequence Diagram (With Lock)

```
Content Script          Service Worker           Sync Queue          Storage
      |                       |                      |                 |
      |--DATA_SCRAPED(10)---->|                      |                 |
      |                       |--addToQueue()------->|                 |
      |                       |                      |--save---------->|
      |                       |--processQueue()      |                 |
      |                       |                      |--getLock()----->|
      |                       |                      |<--granted-------| (lock acquired)
      |                       |                      |--readQueue()--->|
      |                       |                      |<--[item1]-------|
      |                       |                      |--process()------|
      |                       |                      |   [Sync to Sheets]
      |                       |                      |   [Sync to BigQuery]
      |                       |                      |--saveQueue()--->| (empty queue)
      |                       |                      |--releaseLock()-->|
      |                       |                      |<--released-------|
      |                       |                      |                 |
      |        [60s alarm fires]                     |                 |
      |                       |--processQueue()      |                 |
      |                       |                      |--getLock()----->|
      |                       |                      |<--DENIED---------| (lock held)
      |                       |                      |                 |
      |                       |    [Logs: "skipping"]                  |
      |                       |                      |                 |
      |--DATA_SCRAPED(10)---->|                      |                 |
      |                       |--addToQueue()------->|                 |
      |                       |                      |--save---------->|
      |                       |--processQueue()      |                 |
      |                       |                      |--getLock()----->|
      |                       |                      |<--granted-------| (lock free now)
      |                       |                      |--readQueue()--->|
      |                       |                      |<--[item2]-------|
      |                       |                      |--process()------|
      |                       |                      |--saveQueue()--->| (empty queue)
      |                       |                      |--releaseLock()-->|
      |                       |                      |<--released-------|
      |                       |                      |                 |
      |                       |    Result: item1 processed 1x, item2 processed 1x ✅
```

**Lock Protection Points:**
- ✅ **Point 1:** Alarm call sees lock held, skips
- ✅ **Point 2:** Immediate call waits for lock or skips if held
- ✅ **Point 3:** Only one call processes at a time

**Lock Flow:**
1. **Acquire:** Check if lock exists and is not stale
2. **Set:** Write lock with timestamp
3. **Process:** Execute queue processing
4. **Release:** Clear lock in `finally` block
5. **Stale Detection:** Lock older than 5 minutes is considered stale

---

## Final Summary Checklist

### Investigation Complete:

- [x] Lock test implementation documented
- [x] Expected test results documented
- [x] Race condition frequency analyzed (~99% of calls are duplicates)
- [x] Alarm vs immediate call breakdown documented (90 immediate vs 30 alarm)
- [x] Decision on immediate processing: **Keep with lock check** (recommended) or **Remove entirely** (alternative)
- [x] Architecture diagrams created (current buggy flow and fixed flow)

### Key Findings:

1. **DATA_SCRAPED Timing:** Sent after each page (~90 messages for 9 searches)
2. **Message Order:** SCRAPING_COMPLETE always sent after all DATA_SCRAPED messages
3. **Race Frequency:** ~99% of processQueue() calls are duplicates without lock
4. **Handler Flow:** addToQueue() awaited, processQueue() fire-and-forget
5. **Immediate Processing:** Can be removed or kept with lock check

### Recommended Implementation:

1. **Add lock to processQueue()** - Storage-based with 5-minute timeout
2. **Add lock check to immediate processing** - Skip if lock held
3. **Add lock check to alarm handler** - Skip if lock held
4. **Add logging** - Track lock acquisition/release and skips
5. **Test and verify** - Confirm duplicates stop, no data loss
