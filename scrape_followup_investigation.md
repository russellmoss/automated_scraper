# Scrape Queue Investigation - Follow-Up Questions

## Context

The initial investigation identified the race condition in `processQueue()` correctly. However, there are **critical gaps** in the proposed fixes and some unexplained behavior in the logs that need further investigation.

**Document your findings by APPENDING to:** `C:\Users\russe\automated_scraper\scrape_findings.md`

---

## Part 7: Service Worker Persistence Issues

### Question 7.1: Variable-Based Lock Won't Survive Restarts

The proposed Fix 1 uses a module-level variable:
```javascript
let isProcessingQueue = false;
```

**Problem:** Service workers are **ephemeral** - they can be terminated and restarted at any time by Chrome. When the service worker restarts, `isProcessingQueue` will be reset to `false`, even if processing was in progress.

**Investigate:**
1. Where does the service worker get terminated? (Check for `chrome.runtime.onSuspend` handlers)
2. How frequently does Chrome terminate idle service workers?
3. Does the extension use `chrome.alarms` to keep the service worker alive? (I see `keep-alive alarm` in logs)
4. What happens to in-flight `processQueue()` calls when the service worker terminates?

**Recommendation Check:**
- Should the lock be stored in `chrome.storage.local` instead of a variable?
- If using storage, how do we handle stale locks from crashed processing?

### Question 7.2: Storage-Based Lock Race Condition

Fix 2 proposes using `chrome.storage.local`:
```javascript
const { queueProcessing } = await getFromStorage(['queueProcessing']);
if (queueProcessing?.isProcessing) { return; }
await saveToStorage({ queueProcessing: { isProcessing: true } });
```

**Problem:** There's still a race condition between `getFromStorage` and `saveToStorage`:
```
T0: Process A reads queueProcessing → false
T1: Process B reads queueProcessing → false  
T2: Process A writes queueProcessing → true
T3: Process B writes queueProcessing → true  ← Both think they have the lock!
```

**Investigate:**
1. Is `chrome.storage.local.set()` atomic?
2. Does the extension have access to `navigator.locks` (Web Locks API)?
3. Can we use `chrome.storage.session` for locking (MV3 only)?
4. What pattern does the codebase use elsewhere for mutual exclusion?

---

## Part 8: BigQuery Double-Sync Deep Dive

### Question 8.1: Two Separate Code Paths?

The logs show the BigQuery sync happening twice with identical data. Looking at the call pattern:

```
sync_queue.js:162 [QUEUE] 🔄 Syncing 3 profiles to BigQuery for Michael Terrana...
bigquery_sync.js:183 [BIGQUERY] ✅ Sync complete: 3 synced, 0 errors
sync_queue.js:176 [QUEUE] ✅ BigQuery sync: 3 synced, 0 errors for Michael Terrana

[Then again:]
sync_queue.js:162 [QUEUE] 🔄 Syncing 3 profiles to BigQuery for Michael Terrana...
bigquery_sync.js:183 [BIGQUERY] ✅ Sync complete: 3 synced, 0 errors
```

**Investigate:**
1. In `sync_queue.js`, find the code around line 162 that triggers BigQuery sync
2. Is BigQuery sync called once per queue item, or once per row?
3. Is there a loop that might be iterating twice?
4. Check if `syncProfiles()` in `bigquery_sync.js` is being called from multiple places

### Question 8.2: Observations Also Recorded Twice

The logs show:
```
bigquery_sync.js:337 [BIGQUERY] Observations recorded: {success: true, recorded: 3}
...
bigquery_sync.js:337 [BIGQUERY] Observations recorded: {success: true, recorded: 3}
```

**Investigate:**
1. Is observation recording part of the same code path as profile syncing?
2. Or is it a separate call that could be triggered independently?
3. Trace the full call chain from `sync_queue.js` to `bigquery_sync.js` observation recording

---

## Part 9: Apps Script / Backend Idempotency

### Question 9.1: Current Duplicate Detection

Looking at the BigQuery sync URL:
```
https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec
```

**Investigate:**
1. Does the Apps Script backend check for duplicates before inserting?
2. What's the unique key for advisors? (LinkedIn URL? Profile ID?)
3. What's the unique key for observations? (advisor_id + recruiter_id + date?)
4. If duplicates are sent, are they rejected or inserted as duplicates?

### Question 9.2: Advisor ID Generation

The logs show advisorIds being returned:
```
"advisorIds": [
  "c31488fd-b7bc-4994-be0f-8b8c602ed3c9",
  "3e582f0b-42c0-41f6-abc5-dea8caaa1ad0",
  ...
]
```

**Investigate:**
1. Are these UUIDs generated fresh each time, or looked up from existing records?
2. If the same profile is synced twice, does it get the same advisor ID or a new one?
3. If a new ID is generated, this would create duplicate advisor records!

---

## Part 10: Search Execution Sequencing

### Question 10.1: The "Flipping" Behavior

The user reported searches "flipping around." While the investigation found searches are sequential in a `for` loop, the logs show interleaved activity.

**Investigate:**
1. During the delay between searches (45-90s), what happens to queued data?
2. Is there any async operation that continues after the search is marked "complete"?
3. Could `waitForScrapingCompleteWithHealthCheck()` return before all data is queued?

### Question 10.2: Content Script Coordination

The scraping involves a content script that sends `DATA_SCRAPED` messages.

**Investigate:**
1. How does the service worker know a search is "complete"?
2. Is there a race between `SCRAPING_COMPLETE` message and final `DATA_SCRAPED`?
3. What if the content script sends data after the service worker thinks the search is done?

---

## Part 11: Proposed Fix Validation

### Question 11.1: Fix 1 - In-Memory Lock

**Verify the fix works:**
1. Add the lock as proposed
2. Add console.log when lock is acquired/released
3. Manually trigger `processQueue()` twice via console
4. Confirm second call is skipped

**Edge cases to test:**
- What if processing throws an error? Is the lock released in `finally`?
- What if processing is very slow (>60s)? Will alarm fire show "skipped"?
- What if service worker restarts mid-processing?

### Question 11.2: Fix 2 - Storage-Based Lock

**Verify atomicity:**
1. Test the race condition scenario described in 7.2
2. Consider using a timestamp-based lock with expiration
3. Implement stale lock detection (e.g., lock older than 5 minutes = stale)

**Proposed improvement:**
```javascript
const lockKey = 'queueProcessingLock';
const lockTimeout = 5 * 60 * 1000; // 5 minutes

async function acquireLock() {
    const { [lockKey]: lock } = await getFromStorage([lockKey]);
    const now = Date.now();
    
    // Check for stale lock
    if (lock?.isLocked && (now - lock.timestamp) < lockTimeout) {
        return false; // Lock is held and not stale
    }
    
    // Acquire lock with timestamp
    await saveToStorage({ [lockKey]: { isLocked: true, timestamp: now } });
    
    // Double-check we got the lock (optimistic locking)
    const { [lockKey]: verify } = await getFromStorage([lockKey]);
    return verify?.timestamp === now;
}

async function releaseLock() {
    await saveToStorage({ [lockKey]: { isLocked: false, timestamp: 0 } });
}
```

---

## Part 12: Comprehensive Fix Recommendations

After investigating the above, provide:

### 12.1 Revised Fix Implementation

Update the recommended fixes based on findings:
- Address service worker termination
- Address storage race condition
- Add proper error handling
- Add stale lock detection

### 12.2 Migration Strategy

How to deploy fixes without data loss:
- Should we pause scheduled scrapes?
- How to clean up any duplicate data already created?
- Rollback plan if fixes cause issues?

### 12.3 Monitoring

What logging/monitoring should be added:
- Track lock acquisition/release
- Track duplicate detection (if same item processed twice)
- Track queue depth over time
- Alert on stale locks

---

## Summary of Follow-Up Tasks

| # | Task | Priority | File(s) to Investigate |
|---|------|----------|----------------------|
| 7.1 | Service worker persistence | CRITICAL | service_worker.js |
| 7.2 | Storage lock atomicity | CRITICAL | sync_queue.js, storage.js |
| 8.1 | BigQuery double-call path | HIGH | sync_queue.js, bigquery_sync.js |
| 8.2 | Observation duplicate recording | HIGH | bigquery_sync.js |
| 9.1 | Backend idempotency | MEDIUM | Apps Script code |
| 9.2 | Advisor ID generation | MEDIUM | Apps Script code |
| 10.1 | Search completion timing | MEDIUM | service_worker.js |
| 10.2 | Content script coordination | MEDIUM | content_script.js, service_worker.js |
| 11.1 | Validate in-memory lock | HIGH | Manual testing |
| 11.2 | Validate storage lock | HIGH | Manual testing |
| 12.* | Comprehensive fix plan | CRITICAL | All files |

---

## Append Findings To

**File:** `C:\Users\russe\automated_scraper\scrape_findings.md`

**Format:** Add a new section titled "## Part 7-12: Follow-Up Investigation Findings" and document each answer with:
- Code snippets
- Line numbers
- Specific function names
- Recommended changes
