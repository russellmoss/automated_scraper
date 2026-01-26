# Scrape Queue Investigation Guide

## Issue Summary

The Chrome extension's scraping system appears to have a **race condition** causing:
1. **Duplicate processing** of queue items (same rows synced twice to Sheets and BigQuery)
2. **Non-sequential execution** - searches appear to "flip around" instead of completing one search fully before moving to the next
3. **Queue tick interference** - the periodic queue processor fires during active syncs

---

## Investigation Tasks

Please investigate the codebase and document your findings in `scrape_findings.md` at the root of the project directory.

---

## Part 1: Queue Processing Race Condition

### Question 1.1
In `sync_queue.js`, examine the queue processing logic around lines 113-285:
- How is an item marked as "in progress" or "completed"?
- Is there a lock mechanism to prevent the same item from being processed twice?
- What happens if `Queue process tick` fires while an item is mid-sync?

### Question 1.2
Look at these log patterns that appear consecutively:
```
sync_queue.js:141 [QUEUE] ✅ Synced 3 rows to Sheets
sync_queue.js:285 [QUEUE] Queue processing complete: 1 synced, 0 failed, 0 pending
sync_queue.js:128 [QUEUE] Processing 1 queued items...  <-- WHY IS THIS FIRING AGAIN?
```
Find where this duplicate trigger originates. Is the queue item being re-added or not removed properly?

### Question 1.3
Search for all places that call `sync_queue` processing functions. Document:
- What triggers `[QUEUE] Processing X queued items...`?
- Are there multiple callers that could overlap?
- Is there any debouncing or mutex protection?

---

## Part 2: Service Worker Tick Interference

### Question 2.1
In `service_worker.js`, find the tick/alarm handlers around lines 343-380:
```
service_worker.js:380 [SW] Schedule check tick
service_worker.js:343 [SW] Queue process tick
```
- What interval do these fire on?
- Do they check if a scrape is already in progress before triggering queue processing?

### Question 2.2
Examine the "Skipping" logic:
```
scheduler.js:427 [SCHEDULE] Skipping Michael Terrana - currently running
```
- This skip works for the scheduler, but does the queue processor have equivalent protection?
- Find the equivalent guard for the sync queue and verify it's working.

### Question 2.3
Look at line 365:
```
service_worker.js:365 [SW] ⏸️ Skipping sync - scrape in progress
```
- What flag is checked here?
- Is this flag being set/cleared at the right times?
- Could there be a timing window where the flag is false but processing is still happening?

---

## Part 3: Search Sequence Execution

### Question 3.1
In `service_worker.js`, trace the search execution flow (lines 1213-1399):
- How does the system know to wait for search N to complete before starting search N+1?
- What mechanism enforces the delays between searches (e.g., "Waiting 101s before starting search 3/9")?
- Is this delay-based or completion-based?

### Question 3.2
Find where `processManualScrape` or the auto-run equivalent manages the search queue:
- Is there a single loop iterating through searches?
- Or are searches dispatched independently and could overlap?

### Question 3.3
The logs show this pattern repeatedly:
```
[SW] ✅ Search "Financial Consultant" completed: 3 profiles from 1 pages
[SW] ⏸️ Search 2/9 complete. Waiting 101s before starting search 3/9: "Financial Planner"
```
Yet queue processing happens many times during that wait. Verify:
- Should queue processing be paused during search transitions?
- Is there cleanup that should happen before the next search starts?

---

## Part 4: BigQuery Double-Sync

### Question 4.1
In `bigquery_sync.js`, examine lines 129-190:
- The same `advisorIds` array appears twice in succession in logs
- Is `syncProfiles` being called multiple times for the same batch?
- What triggers `[BIGQUERY] Syncing X profiles for [Name]...`?

### Question 4.2
Trace the call chain:
```
sync_queue.js:162 → [QUEUE] 🔄 Syncing X profiles to BigQuery
bigquery_sync.js:129 → [BIGQUERY] Syncing X profiles
bigquery_sync.js:163 → [BIGQUERY] 📊 Sync result
```
Find if there's any path where this chain executes twice for the same queue item.

### Question 4.3
Check the observation recording:
```
bigquery_sync.js:337 [BIGQUERY] Observations recorded: {success: true, recorded: 3}
```
- Are observations being recorded twice per batch?
- This could cause duplicate records in the database.

---

## Part 5: State Management

### Question 5.1
Find all global/module-level state variables related to:
- Current scrape status (running/idle)
- Current search index
- Queue items pending/processing
- Active sync operations

### Question 5.2
Check for proper async/await usage:
- Are there any fire-and-forget async calls that should be awaited?
- Could the tick handler be firing before a previous tick fully completes?

### Question 5.3
Look for any `Promise.all` or parallel processing that should be sequential:
- Should syncing to Sheets and BigQuery be sequential or parallel?
- If parallel, is there proper coordination?

---

## Part 6: Specific Code Locations to Examine

Please examine these specific areas and document what you find:

| File | Lines (approx) | What to look for |
|------|----------------|------------------|
| `sync_queue.js` | 113-130 | Queue item creation and ID assignment |
| `sync_queue.js` | 128-150 | Processing loop and completion logic |
| `sync_queue.js` | 150-190 | BigQuery sync trigger |
| `sync_queue.js` | 285 | Queue completion handler |
| `service_worker.js` | 343-380 | Tick handlers and guards |
| `service_worker.js` | 1274-1399 | Search completion and transition |
| `bigquery_sync.js` | 129-190 | Profile sync logic |
| `scheduler.js` | 427 | Skip logic for running scrapes |

---

## Expected Output

Create `scrape_findings.md` in the project root with:

1. **Root Cause Analysis** - What's causing the duplicate processing?
2. **Code References** - Specific files, functions, and line numbers
3. **Race Condition Diagram** - Show the timing issue if applicable
4. **Recommended Fixes** - Specific code changes to resolve each issue
5. **Testing Strategy** - How to verify the fixes work

---

## Additional Context

From the logs, the system architecture appears to be:
1. **Service Worker** - Orchestrates scraping, manages alarms/ticks
2. **Scheduler** - Manages scheduled runs, tracks execution state
3. **Sync Queue** - Buffers scraped data, syncs to Sheets
4. **BigQuery Sync** - Secondary sync to BigQuery/Supabase
5. **Content Script** - Actually scrapes LinkedIn pages

The issue manifests as the same data being processed multiple times, suggesting either:
- The queue isn't properly deduplicating
- The tick handler isn't checking for in-progress operations
- Items aren't being removed from the queue after processing
- Multiple code paths are triggering the same sync operation
