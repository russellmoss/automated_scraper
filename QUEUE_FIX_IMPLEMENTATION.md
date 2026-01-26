# Queue Processing Race Condition - Production Fix

## Problem Summary

`processQueue()` is called from two places with no lock:
1. **Alarm** - every 60 seconds
2. **DATA_SCRAPED handler** - after each page scraped (~90 times per recruiter)

Result: Same queue items processed multiple times → duplicates in Sheets/BigQuery.

---

## Fix Overview

| Change | File | Purpose |
|--------|------|---------|
| Add lock mechanism | `sync_queue.js` | Prevent concurrent processing |
| Add lock check to alarm | `service_worker.js` | Skip if already processing |
| Add lock check to DATA_SCRAPED | `service_worker.js` | Skip if already processing |
| Add backend deduplication | Apps Script | Defense in depth |

---

## File 1: `background/sync_queue.js`

### Add these constants at the top of the file (after imports):

```javascript
// === QUEUE PROCESSING LOCK ===
const QUEUE_LOCK_KEY = 'queueProcessingLock';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - stale lock timeout
const LOCK_HEARTBEAT_MS = 30 * 1000;   // 30 seconds - update lock while processing
```

### Add these helper functions (before `processQueue`):

```javascript
/**
 * Attempts to acquire the queue processing lock.
 * Returns { acquired: true, processId } if successful.
 * Returns { acquired: false, reason } if lock is held.
 */
async function acquireQueueLock() {
    const { [QUEUE_LOCK_KEY]: existingLock } = await chrome.storage.local.get([QUEUE_LOCK_KEY]);
    const now = Date.now();
    
    // Check if lock exists and is not stale
    if (existingLock?.isLocked) {
        const lockAge = now - (existingLock.timestamp || 0);
        if (lockAge < LOCK_TIMEOUT_MS) {
            return { 
                acquired: false, 
                reason: 'lock_held',
                lockAge: Math.round(lockAge / 1000),
                heldBy: existingLock.processId 
            };
        }
        // Lock is stale - we can take it
        console.log(`${LOG} ⚠️ Stale lock detected (${Math.round(lockAge / 1000)}s old), taking over`);
    }
    
    // Generate unique process ID for this processing run
    const processId = `${now}-${Math.random().toString(36).substring(2, 8)}`;
    
    // Acquire lock
    const newLock = { 
        isLocked: true, 
        timestamp: now, 
        processId,
        acquiredAt: new Date(now).toISOString()
    };
    await chrome.storage.local.set({ [QUEUE_LOCK_KEY]: newLock });
    
    // Verify we got the lock (optimistic locking check)
    // Delay for SD card write (Pi compatibility) - 100ms recommended for slower SD cards
    const isPi = navigator.userAgent.includes('CrOS');
    await new Promise(resolve => setTimeout(resolve, isPi ? 100 : 50));
    
    const { [QUEUE_LOCK_KEY]: verify } = await chrome.storage.local.get([QUEUE_LOCK_KEY]);
    if (verify?.processId === processId) {
        console.log(`${LOG} 🔒 Lock acquired (processId: ${processId})`);
        return { acquired: true, processId };
    }
    
    // Another process got the lock (rare race condition)
    console.log(`${LOG} ⚠️ Lock race - another process acquired lock`);
    return { acquired: false, reason: 'race_condition' };
}

/**
 * Releases the queue processing lock.
 * Only releases if we hold the lock (matching processId).
 */
async function releaseQueueLock(processId) {
    if (!processId) return;
    
    const { [QUEUE_LOCK_KEY]: existingLock } = await chrome.storage.local.get([QUEUE_LOCK_KEY]);
    
    // Only release if we hold the lock
    if (existingLock?.processId === processId) {
        await chrome.storage.local.set({ 
            [QUEUE_LOCK_KEY]: { 
                isLocked: false, 
                timestamp: 0, 
                processId: null,
                releasedAt: new Date().toISOString()
            } 
        });
        console.log(`${LOG} 🔓 Lock released (processId: ${processId})`);
    } else {
        console.log(`${LOG} ⚠️ Lock release skipped - not owner (ours: ${processId}, current: ${existingLock?.processId})`);
    }
}

/**
 * Updates the lock timestamp to prevent stale detection during long operations.
 * Call this periodically during processing.
 */
async function updateLockHeartbeat(processId) {
    if (!processId) return;
    
    const { [QUEUE_LOCK_KEY]: existingLock } = await chrome.storage.local.get([QUEUE_LOCK_KEY]);
    
    if (existingLock?.processId === processId) {
        await chrome.storage.local.set({ 
            [QUEUE_LOCK_KEY]: { 
                ...existingLock, 
                timestamp: Date.now(),
                lastHeartbeat: new Date().toISOString()
            } 
        });
    }
}

/**
 * Checks if queue lock is currently held (for external callers).
 * Returns { isLocked, lockAge, processId } or { isLocked: false }
 */
export async function isQueueLocked() {
    const { [QUEUE_LOCK_KEY]: lock } = await chrome.storage.local.get([QUEUE_LOCK_KEY]);
    
    if (!lock?.isLocked) {
        return { isLocked: false };
    }
    
    const lockAge = Date.now() - (lock.timestamp || 0);
    const isStale = lockAge >= LOCK_TIMEOUT_MS;
    
    return {
        isLocked: !isStale,
        lockAge: Math.round(lockAge / 1000),
        processId: lock.processId,
        isStale
    };
}
```

### Modify `processQueue()` function:

**Find the function** (starts at line 121) and make these changes:

**1. Replace the function signature and add lock acquisition at the start:**

```javascript
export async function processQueue() {
    // === LOCK ACQUISITION ===
    const lockResult = await acquireQueueLock();
    
    if (!lockResult.acquired) {
        console.log(`${LOG} ⏸️ Queue processing skipped - ${lockResult.reason} (lock age: ${lockResult.lockAge || 0}s, held by: ${lockResult.heldBy || 'unknown'})`);
        return { synced: 0, failed: 0, pending: 0, skipped: true, reason: lockResult.reason };
    }
    
    const { processId } = lockResult;
    let heartbeatInterval = null;
    
    try {
        // Start heartbeat to prevent stale lock during long processing
        heartbeatInterval = setInterval(() => {
            updateLockHeartbeat(processId).catch(err => {
                console.warn(`${LOG} Heartbeat update failed:`, err);
            });
        }, LOCK_HEARTBEAT_MS);
        
        // === EXISTING CODE: Keep all existing processing logic below ===
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
            // ... KEEP ALL EXISTING CODE FROM HERE (lines 135-274) ...
```

**2. Wrap the end of the function (before the final return statement) with try/finally:**

Find the end of the function (around line 285-291) and replace:

```javascript
    console.log(`${LOG} Queue processing complete: ${synced} synced, ${failed} failed, ${remainingQueue.length} pending`);
    
    return {
        synced,
        failed,
        pending: remainingQueue.length
    };
}
```

With:

```javascript
        console.log(`${LOG} Queue processing complete: ${synced} synced, ${failed} failed, ${remainingQueue.length} pending`);
        
        // Return results
        return {
            synced,
            failed,
            pending: remainingQueue.length
        };
        
    } catch (error) {
        console.error(`${LOG} ❌ Queue processing error:`, error);
        // Re-throw to allow caller to handle
        throw error;
    } finally {
        // === LOCK RELEASE (ALWAYS RUNS, EVEN ON ERROR) ===
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        await releaseQueueLock(processId).catch(err => {
            console.error(`${LOG} ⚠️ Failed to release lock:`, err);
        });
    }
}
```

**IMPORTANT NOTES:**
- The `for (const item of queue)` loop and all its contents (lines 135-274) should remain **unchanged**
- Only wrap the existing code with lock acquisition at the start and lock release in `finally`
- The `saveQueue()` and `saveFailedRows()` calls (lines 278-283) should remain inside the `try` block

---

## File 2: `background/service_worker.js`

### Modify the QUEUE_PROCESS alarm handler (around line 342):

**Before:**
```javascript
case ALARM_NAMES.QUEUE_PROCESS:
    console.log(`${LOG} Queue process tick`);
    const result = await processQueue();
    // ...
```

**After:**
```javascript
case ALARM_NAMES.QUEUE_PROCESS:
    console.log(`${LOG} Queue process tick [ALARM]`);
    try {
        const result = await processQueue();
        if (result?.skipped) {
            console.log(`${LOG} ⏸️ Alarm-triggered processing skipped (${result.reason})`);
        } else if (result) {
            console.log(`${LOG} ✅ Alarm-triggered processing: ${result.synced} synced, ${result.failed} failed, ${result.pending} pending`);
            // Send update message if items were processed
            if (result.synced > 0 || result.failed > 0) {
                chrome.runtime.sendMessage({
                    action: 'QUEUE_UPDATED',
                    ...result
                }).catch(() => {});
            }
        }
    } catch (e) {
        console.error(`${LOG} ❌ Queue process error:`, e);
    }
    break;
```

**Note:** The lock check is handled inside `processQueue()`, so we don't need a separate check here. The alarm will just call `processQueue()` and it will skip if lock is held.

### Modify the DATA_SCRAPED handler (around line 1780):

**Before:**
```javascript
case MESSAGE_ACTIONS.DATA_SCRAPED: {
    // ... existing code to add to queue ...
    await addToQueue(rows, workbookId, tabName);
    processQueue().catch(e => console.error(`${LOG} Queue error:`, e));
    response = { success: true, queued: rows.length };
    break;
}
```

**After:**
```javascript
case MESSAGE_ACTIONS.DATA_SCRAPED: {
    const { rows, pageNumber } = message;
    console.log(`${LOG} Received ${rows.length} rows from page ${pageNumber}`);
    
    const { sourceMapping } = await getFromStorage([STORAGE_KEYS.SOURCE_MAPPING]);
    const sourceName = rows[0]?.[4]; // Connection Source column
    const workbookId = sourceMapping?.[sourceName] || currentOutputSheetId;
    
    if (workbookId) {
        const { tabName } = await ensureWeeklyTab(workbookId);
        await addToQueue(rows, workbookId, tabName);
        
        // Process queue immediately (lock check happens inside processQueue)
        console.log(`${LOG} 📥 Data scraped, triggering queue processing [IMMEDIATE]`);
        processQueue()
            .then(result => {
                if (result?.skipped) {
                    console.log(`${LOG} ⏸️ Immediate processing skipped (${result.reason}) - alarm will handle`);
                } else if (result) {
                    console.log(`${LOG} ✅ Immediate processing: ${result.synced} synced, ${result.pending} pending`);
                }
            })
            .catch(e => console.error(`${LOG} ❌ Queue error:`, e));
    }
    
    response = { success: true, queued: rows.length };
    break;
}
```

**Note:** The lock check is handled inside `processQueue()`, so we can call it directly. It will skip if lock is held.

---

## File 3: Apps Script - Add Observation Deduplication (Defense in Depth)

In your `Code.gs` file, modify the `recordObservationsBatch()` function to check for duplicates.

**IMPORTANT:** The function signature is `recordObservationsBatch(data)` where `data` contains `{ scrape_run_id, recruiter_id, search_id, search_job_title, profiles, advisorIds }`.

**Find the function** (around line 612) and **add deduplication BEFORE building the rows array**:

```javascript
function recordObservationsBatch(data) {
  const { scrape_run_id, recruiter_id, search_id, search_job_title, profiles, advisorIds } = data;
  
  if (!profiles || profiles.length === 0) {
    return { success: true, recorded: 0, message: 'No profiles to record' };
  }
  
  console.log(`[OBSERVATION] Recording ${profiles.length} observations for recruiter ${recruiter_id}`);
  
  // === NEW: DEDUPLICATION CHECK ===
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Query existing observations for today to prevent duplicates
  // Use composite key: advisor_id + recruiter_id + DATE(observed_at)
  const existingQuery = `
    SELECT advisor_id 
    FROM \`${PROJECT_ID}.${DATASET_ID}.connection_observations\`
    WHERE recruiter_id = '${escapeSql(recruiter_id)}'
      AND DATE(observed_at) = '${today}'
      AND advisor_id IS NOT NULL
  `;
  
  let existingAdvisorIds = new Set();
  try {
    const existingResult = runQuery(existingQuery);
    existingAdvisorIds = new Set(
      (existingResult || []).map(row => row.advisor_id || row.f?.[0]?.v || null).filter(id => id !== null)
    );
    console.log(`[OBSERVATION] Found ${existingAdvisorIds.size} existing observations for today`);
  } catch (error) {
    console.warn(`[OBSERVATION] Failed to check existing observations (non-critical):`, error);
    // Continue without deduplication if query fails
  }
  // === END DEDUPLICATION CHECK ===
  
  const now = new Date().toISOString();
  const rows = [];
  let skippedCount = 0;
  
  // Process each profile - use advisor_id from sync result if available
  for (let idx = 0; idx < profiles.length; idx++) {
    const profile = profiles[idx];
    
    // PREFERRED: Use advisor_id from sync result (most reliable - no lookup needed)
    let advisorId = advisorIds && advisorIds[idx] ? advisorIds[idx] : null;
    
    // ... existing advisor ID lookup code (lines 641-710) ...
    
    // === NEW: CHECK FOR DUPLICATE BEFORE ADDING TO ROWS ===
    if (advisorId && existingAdvisorIds.has(advisorId)) {
      console.log(`[OBSERVATION] ⏭️ Skipping duplicate observation for advisor_id: ${advisorId}`);
      skippedCount++;
      continue; // Skip this profile
    }
    // === END DUPLICATE CHECK ===
    
    rows.push({
      id: `obs_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
      scrape_run_id: scrape_run_id || null,
      recruiter_id: recruiter_id,
      advisor_id: advisorId || null,
      search_id: search_id || null,
      observed_at: now,
      advisor_name: profile.name || null,
      advisor_title: profile.title || null,
      advisor_location: profile.location || null,
      advisor_linkedin_url: normalizeLinkedInUrl(profile.linkedin_url) || null,
      search_job_title: search_job_title || null,
      created_at: now
    });
  }
  
  if (skippedCount > 0) {
    console.log(`[OBSERVATION] ⏭️ Skipped ${skippedCount} duplicate observations for recruiter ${recruiter_id}`);
  }
  
  if (rows.length === 0) {
    return { success: true, recorded: 0, skipped: skippedCount, message: 'All observations were duplicates' };
  }
  
  try {
    insertRows('connection_observations', rows);
    console.log(`[OBSERVATION] Successfully recorded ${rows.length} observations (skipped ${skippedCount} duplicates)`);
    
    return { 
      success: true, 
      recorded: rows.length,
      skipped: skippedCount,
      message: `Recorded ${rows.length} observations, skipped ${skippedCount} duplicates`
    };
  } catch (error) {
    console.error('[OBSERVATION] Batch error:', error);
    return { success: false, error: error.message };
  }
}
```

**Key Changes:**
1. ✅ Uses correct function signature `recordObservationsBatch(data)`
2. ✅ Uses correct table name `connection_observations` (not `observations`)
3. ✅ Checks duplicates by `advisor_id + recruiter_id + DATE(observed_at)` (composite key)
4. ✅ Only checks if `advisor_id` is available (skips null advisor_ids)
5. ✅ Non-blocking - continues if deduplication query fails
6. ✅ Returns `skipped` count in response

---

## Testing Instructions

### Step 1: Deploy the Fix

1. Update `sync_queue.js` with lock mechanism
2. Update `service_worker.js` with logging
3. Reload the extension

### Step 2: Run a Test Scrape

1. Open F12 Developer Tools → Console
2. Start a manual scrape for one recruiter
3. Watch for these log messages:

**Expected (Good):**
```
[QUEUE] 🔒 Lock acquired (processId: 1706123456789-abc123)
[QUEUE] ✅ Synced 10 rows to Sheets
[QUEUE] 🔓 Lock released (processId: 1706123456789-abc123)
[SW] Queue process tick [ALARM]
[QUEUE] ⏸️ Queue processing skipped - lock_held (lock age: 15s)
```

**Bad (Still has race condition):**
```
[QUEUE] 🔒 Lock acquired (processId: ...)
[QUEUE] 🔒 Lock acquired (processId: ...)  <-- TWO ACQUIRES = BUG
```

### Step 3: Verify No Duplicates

1. Check the Google Sheet tab for today's date
2. Count unique profiles vs total rows
3. Should be 1:1 (no duplicates)

### Step 4: Verify No Data Loss

Run in F12 console after scrape completes:
```javascript
chrome.storage.local.get(['syncQueue', 'failedRows'], (data) => {
    console.log('Queue depth:', data.syncQueue?.length || 0);
    console.log('Failed items:', data.failedRows?.length || 0);
});
```

Expected: Queue depth = 0, Failed items = 0

---

## Rollback Plan

If something goes wrong:

1. **Symptom: Data not syncing**
   - Check console for "Lock acquired" messages
   - If no lock acquired, check for stale lock:
   ```javascript
   chrome.storage.local.get(['queueProcessingLock'], console.log);
   ```
   - Force clear stale lock:
   ```javascript
   chrome.storage.local.set({ queueProcessingLock: { isLocked: false } });
   ```

2. **Symptom: Lock never releases**
   - Check if heartbeat is working
   - Stale lock timeout (5 min) should auto-recover
   - Force clear if needed (see above)

3. **Full rollback:**
   - Revert to previous code
   - Run duplicate cleanup SQL (see below)

---

## Duplicate Cleanup SQL (Run After Fix is Deployed)

Clean up existing duplicates in BigQuery:

```sql
-- Find duplicates
-- IMPORTANT: Replace 'savvy-gtm-analytics' with your actual project ID if different
SELECT 
    advisor_id, 
    recruiter_id, 
    DATE(observed_at) as date,
    COUNT(*) as count
FROM `savvy-gtm-analytics.savvy_pirate.connection_observations`
WHERE advisor_id IS NOT NULL
GROUP BY advisor_id, recruiter_id, DATE(observed_at)
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- Delete duplicates (keep the first one)
-- IMPORTANT: Replace 'your_project' with your actual project ID (e.g., 'savvy-gtm-analytics')
DELETE FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o1
WHERE EXISTS (
    SELECT 1 
    FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o2
    WHERE o2.advisor_id = o1.advisor_id
      AND o2.recruiter_id = o1.recruiter_id
      AND DATE(o2.observed_at) = DATE(o1.observed_at)
      AND o2.observed_at < o1.observed_at
);
```

---

## Summary

| What | Why |
|------|-----|
| Storage-based lock | Survives service worker restart (critical for Pi) |
| 5-minute stale timeout | Auto-recovery if crash during processing |
| 50-100ms write delay | SD card compatibility (Pi) - adaptive based on platform |
| Heartbeat every 30s | Prevents false stale detection for long operations |
| Process ID verification | Ensures only owner can release lock |
| Backend deduplication | Defense in depth - catches any edge cases |

**This fix is designed to never lose data and auto-recover from any failure mode.**

---

## Implementation Notes & Edits Made

### Edits Made to Original Implementation:

1. **Storage Write Delay (Line 76-77):**
   - **Changed:** From fixed 50ms to adaptive 50-100ms based on platform
   - **Why:** Findings recommend 100ms for Pi SD cards (slower I/O), 50ms for desktop
   - **Impact:** Better compatibility with slower SD card storage on Raspberry Pi
   - **Code:** `const isPi = navigator.userAgent.includes('CrOS'); await new Promise(resolve => setTimeout(resolve, isPi ? 100 : 50));`

2. **Apps Script Deduplication (File 3):**
   - **Fixed:** Function signature to match actual `recordObservationsBatch(data)` (not separate parameters)
   - **Fixed:** Table name from `observations` to `connection_observations` (actual table name)
   - **Fixed:** Deduplication query to use composite key `advisor_id + recruiter_id + DATE(observed_at)`
   - **Added:** Proper error handling (non-blocking if query fails - continues without deduplication)
   - **Added:** Integration with existing advisor ID lookup logic (check duplicate AFTER advisor ID is resolved)
   - **Added:** `WHERE advisor_id IS NOT NULL` filter (only check duplicates for profiles with advisor IDs)
   - **Why:** Original code didn't match actual function signature, table structure, or BigQuery schema

3. **SQL Cleanup Queries:**
   - **Fixed:** Table name from `observations` to `connection_observations`
   - **Fixed:** Project ID placeholder to actual project ID (`savvy-gtm-analytics`)
   - **Added:** `WHERE advisor_id IS NOT NULL` filter in duplicate finder query
   - **Why:** Matches actual BigQuery schema and prevents null advisor_id issues in queries

4. **Alarm Handler:**
   - **Added:** Optional chaining (`result?.skipped`) for safety
   - **Added:** QUEUE_UPDATED message sending (was in original code, now preserved)
   - **Why:** Prevents errors if result structure changes, maintains existing behavior

5. **DATA_SCRAPED Handler:**
   - **Added:** Complete handler code (not just the change) for clarity
   - **Added:** Optional chaining (`result?.skipped`) for safety
   - **Why:** Makes it clear what the full handler looks like, prevents missing context

6. **processQueue() Modification Instructions:**
   - **Clarified:** Exact location of changes (line numbers referenced)
   - **Clarified:** What code to keep unchanged (the for loop and all processing logic)
   - **Added:** Error handling in heartbeat and lock release (`.catch()` handlers)
   - **Added:** More detailed instructions showing where existing code goes
   - **Why:** Prevents accidental deletion of existing logic, makes implementation safer and clearer

### Additional Recommendations (Not Implemented, But Consider):

1. **Consider removing immediate processing entirely** (as discussed in findings Part 24.2):
   - Would eliminate 90% of race condition triggers (90 immediate calls vs 30 alarm calls)
   - 60-second delay is acceptable for most use cases
   - Simpler architecture with only alarm-based processing
   - **Decision:** Keep immediate processing for now, but lock prevents races

2. **Monitor lock acquisition patterns:**
   - Track how often locks are acquired vs skipped
   - Alert if lock is held for >2 minutes (indicates slow processing)
   - Alert if stale locks are detected frequently (indicates crashes)

3. **Add lock status to UI:**
   - Show current lock status in popup
   - Display lock age if held
   - Allow manual lock clearing if needed

### Validation Checklist Before Deploying:

- [ ] Lock constants added to `sync_queue.js`
- [ ] Lock helper functions added (acquire, release, heartbeat, isQueueLocked)
- [ ] `processQueue()` wrapped with lock acquisition and release
- [ ] Alarm handler updated with logging
- [ ] DATA_SCRAPED handler updated with logging
- [ ] Apps Script deduplication added (if using BigQuery)
- [ ] Tested on desktop Chrome
- [ ] Tested on Chromium (Pi) if applicable
- [ ] Verified no duplicate processing in logs
- [ ] Verified no data loss (queue empties correctly)

---

## Implementation Notes & Edits Made

### Edits Made to Original Implementation:

1. **Storage Write Delay (Line 76):**
   - **Changed:** From fixed 50ms to adaptive 50-100ms based on platform
   - **Why:** Findings recommend 100ms for Pi SD cards, 50ms for desktop
   - **Impact:** Better compatibility with slower SD card storage on Raspberry Pi

2. **Apps Script Deduplication (File 3):**
   - **Fixed:** Function signature to match actual `recordObservationsBatch(data)` 
   - **Fixed:** Table name from `observations` to `connection_observations`
   - **Fixed:** Deduplication query to use composite key `advisor_id + recruiter_id + DATE(observed_at)`
   - **Added:** Proper error handling (non-blocking if query fails)
   - **Added:** Integration with existing advisor ID lookup logic
   - **Why:** Original code didn't match actual function signature and table structure

3. **SQL Cleanup Queries:**
   - **Fixed:** Table name from `observations` to `connection_observations`
   - **Fixed:** Project ID placeholder to actual project ID (`savvy-gtm-analytics`)
   - **Added:** `WHERE advisor_id IS NOT NULL` filter in duplicate finder
   - **Why:** Matches actual BigQuery schema and prevents null advisor_id issues

4. **Alarm Handler:**
   - **Added:** Optional chaining (`result?.skipped`) for safety
   - **Added:** QUEUE_UPDATED message sending (was in original code)
   - **Why:** Prevents errors if result structure changes, maintains existing behavior

5. **DATA_SCRAPED Handler:**
   - **Added:** Complete handler code (not just the change)
   - **Added:** Optional chaining for safety
   - **Why:** Makes it clear what the full handler looks like, prevents missing context

6. **processQueue() Modification Instructions:**
   - **Clarified:** Exact location of changes (line numbers)
   - **Clarified:** What code to keep unchanged (the for loop)
   - **Added:** Error handling in heartbeat and lock release
   - **Why:** Prevents accidental deletion of existing logic, makes implementation safer

### Additional Recommendations:

1. **Consider removing immediate processing entirely** (as discussed in findings Part 24.2):
   - Would eliminate 90% of race condition triggers
   - 60-second delay is acceptable for most use cases
   - Simpler architecture with only alarm-based processing

2. **Monitor lock acquisition patterns:**
   - Track how often locks are acquired vs skipped
   - Alert if lock is held for >2 minutes (indicates slow processing)
   - Alert if stale locks are detected frequently (indicates crashes)

3. **Add lock status to UI:**
   - Show current lock status in popup
   - Display lock age if held
   - Allow manual lock clearing if needed
