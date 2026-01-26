# Scrape Queue Investigation - Final Questions (Refined)

## Context

The LinkedIn scraping itself works correctly. The content script properly extracts profiles from the DOM. The issue is **entirely in the queue processing race condition** causing duplicates.

**APPEND your findings to:** `C:\Users\russe\automated_scraper\scrape_findings.md`

---

## Part 21: Data Flow Verification

Since scraping works, let's verify the data flow from content script to queue.

### Question 21.1: DATA_SCRAPED Message Timing

**Investigate:**
1. When exactly does the content script send `DATA_SCRAPED`?
   - After each page of results?
   - After all pages complete?
   - After each batch of profiles?
2. How many profiles are typically in one `DATA_SCRAPED` message?
3. For a search with 100 profiles across 10 pages, how many `DATA_SCRAPED` messages are sent?

**Why this matters:** If `DATA_SCRAPED` is sent per-page, and each triggers `processQueue()`, that's 10+ calls potentially racing with the 60-second alarm.

### Question 21.2: SCRAPING_COMPLETE vs DATA_SCRAPED Order

**Investigate:**
1. Is `SCRAPING_COMPLETE` always sent AFTER all `DATA_SCRAPED` messages?
2. Or could there be a race where completion fires before final data?
3. What's the sequence for a multi-page search?

**Expected sequence:**
```
Page 1 → DATA_SCRAPED (10 profiles)
Page 2 → DATA_SCRAPED (10 profiles)
...
Page 10 → DATA_SCRAPED (10 profiles)
SCRAPING_COMPLETE
```

**Document if actual sequence differs.**

---

## Part 22: Immediate Fix Validation

### Question 22.1: Simple Lock Test

Add this code to `sync_queue.js` to test if a simple lock fixes the issue:

**At the top of the file:**
```javascript
const QUEUE_LOCK_KEY = 'queueProcessingLock';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
```

**Replace the start of `processQueue()` with:**
```javascript
export async function processQueue() {
    // === LOCK ACQUISITION ===
    const { [QUEUE_LOCK_KEY]: existingLock } = await chrome.storage.local.get([QUEUE_LOCK_KEY]);
    const now = Date.now();
    
    // Check if lock is held and not stale
    if (existingLock?.isLocked && (now - existingLock.timestamp) < LOCK_TIMEOUT_MS) {
        console.log(`${LOG} ⏸️ Queue processing already in progress (lock age: ${((now - existingLock.timestamp) / 1000).toFixed(0)}s), skipping`);
        return { synced: 0, failed: 0, pending: 0, skipped: true };
    }
    
    // Acquire lock
    await chrome.storage.local.set({ 
        [QUEUE_LOCK_KEY]: { isLocked: true, timestamp: now } 
    });
    console.log(`${LOG} 🔒 Lock acquired`);
    
    try {
        // ... existing processQueue code ...
```

**At the end of `processQueue()`, wrap in try/finally:**
```javascript
    } finally {
        // === LOCK RELEASE ===
        await chrome.storage.local.set({ 
            [QUEUE_LOCK_KEY]: { isLocked: false, timestamp: 0 } 
        });
        console.log(`${LOG} 🔓 Lock released`);
    }
}
```

**Test procedure:**
1. Run a full scrape (all 9 searches for one recruiter)
2. Watch console for:
   - `🔒 Lock acquired` messages
   - `⏸️ Queue processing already in progress, skipping` messages
   - `🔓 Lock released` messages
3. Count how many "skipping" messages appear
4. Check Sheets/BigQuery for duplicates

**Document:**
- Number of "skipping" messages during scrape
- Did duplicates stop?
- Any errors or issues?

### Question 22.2: Verify No Data Loss

After implementing the lock test:

**Investigate:**
1. Are any queue items being lost/dropped?
2. Compare total profiles scraped vs total profiles in Sheets
3. Is the "pending" count going to 0 at the end?

**Run this in console to check queue state:**
```javascript
chrome.storage.local.get(['syncQueue', 'failedRows'], (data) => {
    console.log('Queue depth:', data.syncQueue?.length || 0);
    console.log('Failed items:', data.failedRows?.length || 0);
});
```

---

## Part 23: Race Condition Timing Analysis

### Question 23.1: How Often Does the Race Occur?

With the lock test in place, count the "skipping" messages:

**Document for a typical scrape run:**
- Total `DATA_SCRAPED` messages received: ___
- Total `processQueue()` calls from alarm: ___
- Total "skipping" messages: ___
- Percentage of calls that were duplicates: ___

This tells us how bad the race condition actually is.

### Question 23.2: Alarm vs Immediate Call Breakdown

**Investigate:**
Add logging to distinguish the two callers:

In the alarm handler (`service_worker.js`):
```javascript
case ALARM_NAMES.QUEUE_PROCESS:
    console.log(`${LOG} Queue process tick [ALARM TRIGGER]`);
```

In the DATA_SCRAPED handler:
```javascript
console.log(`${LOG} Processing queue [DATA_SCRAPED TRIGGER]`);
processQueue().catch(...);
```

**Document:**
- How many calls come from alarm?
- How many calls come from DATA_SCRAPED?
- Which one is more likely to cause duplicates?

---

## Part 24: Service Worker Message Handler Review

### Question 24.1: DATA_SCRAPED Handler Flow

**Location:** `service_worker.js`, around line 1780

**Investigate the exact flow:**
```javascript
case MESSAGE_ACTIONS.DATA_SCRAPED:
    // What happens here?
    // 1. Is addToQueue() awaited?
    // 2. Is processQueue() awaited or fire-and-forget?
    // 3. What's the response sent back to content script?
```

**Document:**
- Is `addToQueue()` properly awaited before calling `processQueue()`?
- Is `processQueue()` fire-and-forget (`.catch()` only) or awaited?
- Could the response be sent before queue is processed?

### Question 24.2: Should Immediate Processing Be Removed?

Currently, `processQueue()` is called immediately after `DATA_SCRAPED`.

**Question:** Is immediate processing necessary, or would alarm-only processing be sufficient?

**Pros of removing immediate call:**
- Eliminates one source of race condition
- Simpler code
- Alarm handles processing every 60 seconds anyway

**Cons of removing immediate call:**
- 0-60 second delay before data syncs
- Might feel less responsive

**Recommendation:** Consider removing the immediate `processQueue()` call from DATA_SCRAPED handler entirely. The alarm will pick up items within 60 seconds, and the lock will prevent races if we keep both.

---

## Part 25: Final Architecture Confirmation

### Question 25.1: Create Sequence Diagram

Create a sequence diagram showing the CURRENT (buggy) flow:

```
Content Script    Service Worker    Sync Queue    Storage
      |                 |               |            |
      |--DATA_SCRAPED-->|               |            |
      |                 |--addToQueue-->|            |
      |                 |               |--save----->|
      |                 |--processQueue()----------->| (CALL 1)
      |                 |               |            |
      |        [60s alarm fires]        |            |
      |                 |--processQueue()----------->| (CALL 2 - RACE!)
      |                 |               |            |
```

### Question 25.2: Create Fixed Sequence Diagram

Create a sequence diagram showing the FIXED flow with lock:

```
Content Script    Service Worker    Sync Queue    Storage
      |                 |               |            |
      |--DATA_SCRAPED-->|               |            |
      |                 |--addToQueue-->|            |
      |                 |               |--save----->|
      |                 |--processQueue()            |
      |                 |               |--getLock-->|
      |                 |               |<--granted--|
      |                 |               |--process-->|
      |        [60s alarm fires]        |            |
      |                 |--processQueue()            |
      |                 |               |--getLock-->|
      |                 |               |<--DENIED---| (lock held)
      |                 |               |            |
      |                 |               |--release-->|
```

---

## Summary Checklist

After completing this investigation, confirm:

- [ ] Lock test implemented and working
- [ ] Duplicates stopped appearing
- [ ] No data loss from lock
- [ ] Race condition frequency documented
- [ ] Alarm vs immediate call breakdown documented
- [ ] Decision made on removing immediate processing
- [ ] Architecture diagrams created

---

## Append Format

Add to `scrape_findings.md`:

```markdown
## Part 21-25: Final Investigation & Fix Validation

### Part 21: Data Flow Verification
[Findings about DATA_SCRAPED timing]

### Part 22: Lock Test Results
[Test results - did duplicates stop?]

### Part 23: Race Condition Timing
[How often does the race occur?]

### Part 24: Message Handler Review
[Findings about DATA_SCRAPED handler]

### Part 25: Architecture Diagrams
[Sequence diagrams]
```
