# Scrape Queue Investigation - Part 3: Environment & Scheduler Deep Dive

## Context

This extension runs primarily on **Chromium on Raspberry Pi**, which has significant constraints:
- Limited RAM (1-4GB typically)
- Slower ARM CPU
- SD card storage (slower I/O, limited write cycles)
- More aggressive service worker termination due to resource pressure
- Potentially unstable network connectivity

Additionally, the **scheduling system** and **multi-device architecture** were not fully investigated.

**APPEND your findings to:** `C:\Users\russe\automated_scraper\scrape_findings.md`

---

## Part 13: Raspberry Pi / Chromium Constraints

### Question 13.1: Service Worker Lifecycle on Pi

On resource-constrained devices, Chromium terminates service workers more aggressively.

**Investigate:**
1. How often does the service worker get terminated on Pi? (Check for `onSuspend` or restart patterns)
2. Is there a keep-alive mechanism? (I saw `[SW] Stopping keep-alive alarm` in logs)
3. How does the keep-alive work? Is it tied to active scraping only?
4. What's the keep-alive interval and could it be insufficient on Pi?

**Code to examine:**
- Search for `keep-alive`, `onSuspend`, `onInstalled` handlers
- Check `CONFIG` for any timeout/interval settings

### Question 13.2: Storage I/O Performance

The proposed lock mechanism does multiple storage operations:
```javascript
await getFromStorage([LOCK_KEY]);  // Read 1
await saveToStorage({ [LOCK_KEY]: newLock });  // Write 1
await getFromStorage([LOCK_KEY]);  // Read 2 (verification)
```

On SD card storage, this could be slow (50-100ms per operation).

**Investigate:**
1. How long do storage operations typically take? (Add timing logs if needed)
2. Could the verification read happen before the write is persisted?
3. Is there any batching of storage operations?
4. Should we add a small delay between write and verification read?

### Question 13.3: Memory Pressure Handling

When the Pi is under memory pressure:
- Chrome may terminate the service worker
- In-flight async operations may be lost
- Storage writes may not complete

**Investigate:**
1. What happens to `processQueue()` if service worker terminates mid-execution?
2. Are there any `try/finally` blocks that might not execute?
3. Should there be a "heartbeat" timestamp in the lock to detect crashed processes?
4. Is there any cleanup logic when service worker restarts?

---

## Part 14: Scheduler Architecture

### Question 14.1: Pending Schedule Queue

The logs show:
```
[SW] 🔄 Processing pending schedule: Jon Bartick (was queued at 2026-01-21T22:48:51.364Z)
[SCHEDULE] Removed ws_jon_bartick from pending queue (0 remaining)
```

**Investigate:**
1. Where is the pending schedule queue stored? (Storage? Memory?)
2. How are schedules added to the pending queue?
3. What triggers processing of pending schedules?
4. Can multiple schedules be pending simultaneously?
5. What's the maximum queue depth?

### Question 14.2: Schedule State Machine

Schedules appear to have states: pending → running → completed

**Investigate:**
1. Document all possible schedule states
2. What triggers state transitions?
3. Is there a state diagram or can you create one?
4. What happens if a schedule gets stuck in "running" state?
5. Is there a timeout for stuck schedules?

### Question 14.3: Schedule Execution Handoff

When Michael Terrana's scrape completed, Jon Bartick's started immediately:
```
[SW] Manual scrape complete: 3 profiles from 9 searches
[SCHEDULE] Updated execution 1b185061-73de-4843-9db0-411fa245310d: completed
...
[SW] 🔄 Processing pending schedule: Jon Bartick
```

**Investigate:**
1. What triggers the handoff to the next pending schedule?
2. Is there a delay/cooldown between scrapes?
3. Could the handoff happen before the previous scrape's queue is fully processed?
4. Is there any cleanup that should complete before the next scrape starts?

### Question 14.4: Bi-Weekly Scheduling Logic

The system runs scrapes every 2 weeks per recruiter.

**Investigate:**
1. How is the "next run" date calculated? (`next: 2026-02-04T22:52:00.000Z` in logs)
2. What happens if the Pi is off during a scheduled time?
3. Is there "catch up" logic for missed schedules?
4. How far in the future does the scheduler look?

---

## Part 15: Multi-Device Architecture

### Question 15.1: Device ID and Claiming

The logs show:
```
[DEVICE] Using existing device ID: win-bt27
[SW] ✅ Device win-bt27 claimed schedule: Jon Bartick
```

**Investigate:**
1. How is the device ID generated and stored?
2. What does "claiming" a schedule mean?
3. Can multiple devices run the same schedule?
4. What prevents two devices from claiming the same schedule?
5. Is there a race condition in schedule claiming?

### Question 15.2: Distributed Locking

If multiple devices (e.g., Pi + desktop) could run the extension:

**Investigate:**
1. Is there any coordination between devices?
2. Could two devices scrape the same recruiter simultaneously?
3. Is the lock mechanism device-local or shared?
4. Should there be a backend-level lock for schedules?

### Question 15.3: Device Failure Handling

If the Pi crashes or loses network mid-scrape:

**Investigate:**
1. How does the system detect a failed device?
2. Can another device pick up a failed schedule?
3. Is there a timeout after which a "claimed" schedule is released?
4. What happens to partial data from a failed scrape?

---

## Part 16: Network Resilience

### Question 16.1: Network Failure During Scraping

Pi network can be unreliable (WiFi, Ethernet issues).

**Investigate:**
1. What happens if network fails during LinkedIn scraping?
2. What happens if network fails during Sheets/BigQuery sync?
3. Is there retry logic with exponential backoff?
4. How many retries before giving up?
5. Is partial progress saved?

### Question 16.2: LinkedIn Rate Limiting

LinkedIn aggressively rate-limits scraping.

**Investigate:**
1. How does the extension detect rate limiting?
2. What's the response when rate limited?
3. Is there backoff logic?
4. Are there different delays for different scenarios?
5. How is this logged/monitored?

### Question 16.3: Google API Failures

The extension uses Google Sheets API and Apps Script.

**Investigate:**
1. What happens if Sheets API returns 429 (rate limit)?
2. What happens if Sheets API returns 503 (service unavailable)?
3. Is there retry logic for Google API calls?
4. How are API errors logged?

---

## Part 17: Queue Processing Under Load

### Question 17.1: Large Batch Processing

Some searches return 100+ profiles (e.g., "Investment Advisor" returned 105).

**Investigate:**
1. Are large batches processed in chunks or all at once?
2. What's the memory footprint of processing 100+ profiles?
3. Could large batches cause OOM on Pi?
4. Should there be batch size limits?

### Question 17.2: Queue Depth Management

If scraping is faster than syncing, queue could grow.

**Investigate:**
1. Is there a maximum queue depth?
2. What happens if queue gets too large?
3. Is there any backpressure mechanism?
4. Could we pause scraping if queue is too deep?

### Question 17.3: Concurrent Search + Sync

While search N is running, queue from search N-1 is syncing.

**Investigate:**
1. Is this intentional or accidental concurrency?
2. Does this cause resource contention on Pi?
3. Should syncing complete before next search starts?
4. Or is the overlap beneficial for throughput?

---

## Part 18: Alarm/Timer Configuration

### Question 18.1: Current Alarm Configuration

Document all alarms and their intervals:

**Investigate:**
1. List all `chrome.alarms` used
2. What's each alarm's interval?
3. What does each alarm trigger?
4. Are intervals configurable?

### Question 18.2: Optimal Intervals for Pi

The current 60-second queue processing interval may be suboptimal.

**Investigate:**
1. Could intervals be longer on Pi to reduce resource usage?
2. Should intervals be dynamic based on activity?
3. Is there any benefit to processing queue more frequently?
4. What's the tradeoff between latency and resource usage?

### Question 18.3: Alarm Reliability

Chrome alarms can be delayed or missed.

**Investigate:**
1. Are alarms ever missed? How is this handled?
2. Is there any "catch up" logic for missed alarms?
3. What's the minimum reliable alarm interval on Pi?

---

## Part 19: Error Recovery

### Question 19.1: Execution History

The logs show execution tracking:
```
[SCHEDULE] Started execution ed2013be-c97c-4182-afd2-4d9c89460440 for Jon Bartick
[SCHEDULE] Updated execution ed2013be-c97c-4182-afd2-4d9c89460440: progress
```

**Investigate:**
1. Where is execution history stored?
2. What states can an execution be in?
3. How long is execution history retained?
4. Can we query for failed/incomplete executions?

### Question 19.2: Automatic Recovery

If a scrape fails partway through:

**Investigate:**
1. Is there automatic retry logic?
2. Does it resume from where it failed or restart?
3. How many automatic retries?
4. What triggers a retry vs. marking as failed?

### Question 19.3: Manual Recovery

If automatic recovery fails:

**Investigate:**
1. How can a user manually retry a failed scrape?
2. Is there UI for viewing failed executions?
3. Can partial results be manually processed?
4. Is there a "force retry" option?

---

## Part 20: Recommendations for Pi Environment

Based on your findings, provide recommendations for:

### 20.1 Configuration Tuning

- Recommended alarm intervals for Pi
- Batch size limits
- Timeout values
- Memory thresholds

### 20.2 Monitoring for Pi

- Key metrics to track
- Alerts for Pi-specific issues (memory, storage, network)
- How to detect service worker crashes

### 20.3 Resilience Improvements

- Specific changes to improve reliability on Pi
- Graceful degradation strategies
- Recovery mechanisms

---

## Summary of Additional Investigation Tasks

| # | Task | Priority | Rationale |
|---|------|----------|-----------|
| 13.1 | Service worker lifecycle on Pi | CRITICAL | Affects lock reliability |
| 13.2 | Storage I/O performance | HIGH | Affects lock mechanism |
| 13.3 | Memory pressure handling | HIGH | Pi-specific concern |
| 14.1 | Pending schedule queue | HIGH | Could cause cascade issues |
| 14.2 | Schedule state machine | MEDIUM | Understanding system |
| 14.3 | Schedule execution handoff | HIGH | Related to queue race |
| 14.4 | Bi-weekly scheduling logic | MEDIUM | Missed schedules |
| 15.1 | Device claiming | HIGH | Potential race condition |
| 15.2 | Distributed locking | MEDIUM | Multi-device safety |
| 15.3 | Device failure handling | HIGH | Recovery scenarios |
| 16.1 | Network failure handling | HIGH | Pi network unreliable |
| 16.2 | LinkedIn rate limiting | HIGH | Core functionality |
| 16.3 | Google API failures | HIGH | Data integrity |
| 17.1 | Large batch processing | MEDIUM | Memory concerns |
| 17.2 | Queue depth management | MEDIUM | Backpressure |
| 17.3 | Concurrent search + sync | MEDIUM | Resource contention |
| 18.1 | Alarm configuration | MEDIUM | Documentation |
| 18.2 | Optimal intervals for Pi | MEDIUM | Performance tuning |
| 19.1 | Execution history | LOW | Recovery support |
| 19.2 | Automatic recovery | HIGH | Reliability |
| 19.3 | Manual recovery | LOW | User support |

---

## Append Findings Format

Add a new section to `C:\Users\russe\automated_scraper\scrape_findings.md`:

```markdown
## Part 13-20: Environment & Scheduler Deep Dive Findings

### Part 13: Raspberry Pi / Chromium Constraints
[Your findings here]

### Part 14: Scheduler Architecture
[Your findings here]

... etc
```

Include:
- Code snippets with file paths and line numbers
- Configuration values found
- Potential issues identified
- Specific recommendations for Pi environment
