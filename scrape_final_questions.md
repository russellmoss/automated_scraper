# Scrape Queue Investigation - Final Questions

## Part 21: Content Script & LinkedIn Scraping Mechanics

These are the final questions to complete the investigation. These focus on the **content script** side which hasn't been fully documented.

**APPEND your findings to:** `C:\Users\russe\automated_scraper\scrape_findings.md`

---

### Question 21.1: Content Script Entry Point

**Investigate:**
1. What file is the main content script? (`content/content.js`?)
2. What triggers the content script to start scraping?
3. What message does it receive from the service worker to begin?
4. Does it scrape automatically on page load or wait for a command?

---

### Question 21.2: Profile Extraction Logic

**Investigate:**
1. What CSS selectors does it use to find profile cards?
2. What data fields does it extract from each profile?
   - Name
   - Title/Headline
   - Company
   - Location
   - Profile URL
   - LinkedIn ID
3. How does it handle "LinkedIn Member" (restricted profiles)?
4. Does it wait for the page to fully load before scraping?

---

### Question 21.3: Pagination Flow

**Investigate:**
1. How does the content script handle pagination?
2. Does it click "Next" button or modify the URL?
3. How does it know when it's on the last page?
4. How long does it wait after clicking "Next" for the new page to load?
5. Is there a maximum number of pages it will scrape?

---

### Question 21.4: Data Sending to Service Worker

**Investigate:**
1. When does the content script send `DATA_SCRAPED` message?
   - After each page?
   - After each profile?
   - After all pages complete?
2. What data is included in the `DATA_SCRAPED` message?
3. When does it send `SCRAPING_COMPLETE` message?
4. Is there any chance `SCRAPING_COMPLETE` is sent before all `DATA_SCRAPED` messages?

---

### Question 21.5: Error Handling in Content Script

**Investigate:**
1. What happens if a profile card doesn't have expected elements?
2. What happens if the "Next" button doesn't exist?
3. What happens if LinkedIn shows a rate limit page?
4. What happens if LinkedIn shows CAPTCHA?
5. How are errors communicated back to the service worker?

---

### Question 21.6: Timing and Delays

**Investigate:**
1. Is there a delay between scraping each profile?
2. Is there a delay after page load before scraping starts?
3. Are these delays configurable?
4. What's the total time to scrape a page with 10 profiles?

---

## Part 22: Immediate Fix Validation

Before implementing the full fix, let's validate the simplest possible fix works.

### Question 22.1: Quick Lock Test

Add this temporary code to `sync_queue.js` at the top of `processQueue()`:

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
        // ... existing code ...
    } finally {
        // Release lock
        await chrome.storage.local.set({ [LOCK_KEY]: { isLocked: false } });
    }
}
```

**Test:**
1. Run a scrape
2. Watch console for "LOCK TEST: Already processing, skipping" messages
3. If you see these messages, the lock is working
4. Check if duplicates stop appearing

**Document:**
- How many "skipped" messages appear during a typical scrape?
- Do duplicates in Sheets/BigQuery stop?

---

### Question 22.2: Alarm Disable Test

Temporarily increase the queue process alarm interval to 10 minutes:

```javascript
// In CONFIG
QUEUE_PROCESS_INTERVAL_MINUTES: 10.0,  // Was 1.0
```

**Test:**
1. Run a scrape
2. The alarm should not fire during a typical scrape run
3. Check if duplicates stop appearing

**Document:**
- Do duplicates stop when alarm is effectively disabled?
- This would confirm the alarm is the primary trigger of the race condition

---

## Part 23: Architecture Summary

After completing all investigations, create a final architecture diagram showing:

1. **Components:**
   - Service Worker
   - Content Script
   - Sync Queue
   - BigQuery Sync
   - Scheduler
   - Storage

2. **Data Flow:**
   - Search URL → Content Script → Scraped Data → Queue → Sheets/BigQuery

3. **Message Flow:**
   - All messages between components

4. **Race Condition Points:**
   - Mark where race conditions occur
   - Mark where locks should be added

---

## Append Format

Add to `scrape_findings.md`:

```markdown
## Part 21-23: Content Script & Final Validation Findings

### Part 21: Content Script & LinkedIn Scraping Mechanics
[Your findings here]

### Part 22: Immediate Fix Validation
[Test results here]

### Part 23: Architecture Summary
[Diagram and summary here]
```
