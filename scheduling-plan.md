# Scheduling Enhancement Plan: Biweekly (Odd/Even Week-of-Month) Runs

This document describes how to implement **biweekly scheduling** for sources, supporting:

- **Weekly** (current behavior)
- **Biweekly (Odd weeks)** = “1st & 3rd weeks of the month”
- **Biweekly (Even weeks)** = “2nd & 4th weeks of the month”

The implementation is designed to fit cleanly into the current scheduling architecture:

- **Scheduling data + algorithms** live in `background/scheduler.js`
- **Schedule execution + overlap queueing** live in `background/service_worker.js`
- **Schedule UI** lives in `popup/popup.html` and `popup/popup.js`
- Schedules are stored in `chrome.storage.local` under `STORAGE_KEYS.SCHEDULES` (`utils/constants.js`)

---

## Current Architecture (What Exists Today)

### Where schedules live

- **Storage key**: `STORAGE_KEYS.SCHEDULES` (`utils/constants.js`)
- **Schedule CRUD**: `getSchedules()`, `setSchedule()`, `deleteSchedule()` in `background/scheduler.js`

### How “due schedules” are detected

- `background/service_worker.js` runs `startScheduleChecker()` (alarm every minute)
- Each tick it calls:
  - `checkSchedules(false, runningSourceName)` to find schedules due **right now**
  - If something is already scraping, the service worker queues due schedules via `addPendingSchedule(schedule)`
  - Otherwise it triggers due schedules via `executeScheduledRun(schedule)`

### Timezone behavior

All “due now” checks use **Eastern Time** via `getEasternTime()` in `background/scheduler.js`:

```js
new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
```

### Current schedule fields (effective shape)

`setSchedule()` currently creates schedules with fields like:

- `id`, `sourceName`, `dayOfWeek`, `hour`, `minute`, `enabled`
- `testEnabled`, `testSearchUrl`, `testSearchTitle`, `testMaxPages` (test mode)
- `lastRun`, `nextRun`, `createdAt`, `updatedAt`, `lastExecutionId`

### Current next-run logic (weekly only)

`calculateNextRun(schedule)` in `background/scheduler.js`:

- Picks the next matching `dayOfWeek` and time
- If the scheduled time already passed on that day, it pushes to next week (adds 7 days)

---

## Desired Behavior (New Feature)

Add two optional fields to the schedule model:

```js
{
  // existing
  dayOfWeek: number, // 0-6
  hour: number,      // 0-23
  minute: number,    // 0-59

  // new
  frequency: 'weekly' | 'biweekly',      // default: 'weekly'
  weekPattern: 'odd' | 'even' | null     // required when frequency='biweekly'
}
```

### Week-of-month definition (as discussed)

Week bucket is computed from day-of-month:

- **Week 1**: days 1–7 → **odd**
- **Week 2**: days 8–14 → **even**
- **Week 3**: days 15–21 → **odd**
- **Week 4**: days 22–28 → **even**
- **Week 5**: days 29–31 → **treat as odd** (recommended; see edge cases below)

Examples:

- “1st and 3rd Wednesday”:
  - `dayOfWeek: 3` (Wed)
  - `frequency: 'biweekly'`
  - `weekPattern: 'odd'`
- “2nd and 4th Wednesday”:
  - `dayOfWeek: 3`
  - `frequency: 'biweekly'`
  - `weekPattern: 'even'`

---

## Implementation Steps (Recommended Order)

### Step 1 — Define / document the schedule schema and defaults

**Goal**: Make this backward compatible without migrating stored data.

#### Decisions

- **Default `frequency`** to `'weekly'` whenever missing.
- **Only require `weekPattern`** when `frequency === 'biweekly'`.
- Treat “week 5” as **odd** (so odd schedules still run in long months).

#### Where to encode defaults

- In `background/scheduler.js` (canonical):
  - Normalize schedule objects as they’re saved and/or read.
- In `popup/popup.js` (UI):
  - Default new schedule modal values to `weekly` and hide pattern unless needed.

---

### Step 2 — Add week-of-month helpers in `background/scheduler.js`

**Goal**: Centralize week bucket logic and keep it timezone-correct.

Add small helper(s) near the time utilities:

```js
function getWeekOfMonthByDayBucket(date) {
  const day = date.getDate(); // 1..31
  return Math.floor((day - 1) / 7) + 1; // 1..5
}

function getOddEvenWeekPattern(date) {
  const week = getWeekOfMonthByDayBucket(date); // 1..5
  return (week % 2 === 1) ? 'odd' : 'even';     // week 5 => odd
}
```

**Important**: Always call these with the Eastern Time date object (i.e., `getEasternTime()` output).

---

### Step 3 — Update `checkSchedules()` to respect frequency + weekPattern

**Goal**: Prevent schedules from triggering on “wrong” weeks.

Today, `checkSchedules()`:

- Requires `schedule.dayOfWeek === currentDay`
- Requires time within the -5/+10 minute window
- Enforces cooldown (`23h`, or `15m` in test mode)
- Skips disabled schedules, skips pending duplicates, skips the currently running source

#### Change

Right after the day-of-week match (and before cooldown), add:

- Normalize:
  - `const frequency = schedule.frequency || 'weekly'`
- If `frequency === 'biweekly'`:
  - `const pattern = schedule.weekPattern`
  - If missing/invalid → either:
    - Skip it and log a warning (safest), or
    - Treat as weekly (lenient)
  - Compute `const currentPattern = getOddEvenWeekPattern(now)`
  - If `pattern !== currentPattern` → skip

#### Pending schedules behavior

Do **not** filter pending schedules by weekPattern/day/time.

Reason: Pending schedules are only created when they were genuinely due but overlapped. They should run ASAP after overlap clears (current behavior).

---

### Step 4 — Update `calculateNextRun()` to compute the next valid biweekly occurrence

**Goal**: Keep the `nextRun` display accurate in the popup, and keep `getNextScheduledRun()` accurate.

#### Notes on current usage

- `setSchedule()` sets `nextRun` on create/update
- `markScheduleRun()` recalculates `nextRun` after a run completes

#### Recommended algorithm (simple + reliable)

For weekly: keep existing algorithm.

For biweekly:

- Start from Eastern “now” (`getEasternTime()`).
- Search forward for the next date that satisfies:
  - correct `dayOfWeek`
  - correct week pattern bucket (odd/even)
  - scheduled time is in the future (or if same day, must be after now)

Implementation approach (day-by-day search) is perfectly fine given your scale:

```js
function calculateNextRunBiweekly(schedule, nowET) {
  const frequency = schedule.frequency || 'weekly';
  const pattern = schedule.weekPattern;

  // Start candidate at today at scheduled time
  let candidate = new Date(nowET);
  candidate.setHours(schedule.hour, schedule.minute, 0, 0);

  // If today's scheduled time has passed, start from tomorrow
  if (candidate <= nowET) {
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);
  }

  // Search forward up to e.g. 62 days (covers month boundary + safety)
  for (let i = 0; i < 62; i++) {
    if (candidate.getDay() === schedule.dayOfWeek) {
      const weekPatternNow = getOddEvenWeekPattern(candidate);
      if (weekPatternNow === pattern) {
        return candidate.toISOString();
      }
    }
    candidate.setDate(candidate.getDate() + 1);
  }

  // Fallback: never return null; revert to weekly calculation
  return calculateNextRunWeekly(schedule, nowET);
}
```

This keeps the code easy to reason about and avoids tricky month math.

#### Backward compatibility

If `frequency` is missing, assume weekly (no behavior change).

---

### Step 5 — Update `validateSchedule()` to validate new fields

**Goal**: prevent saving malformed schedules.

`background/scheduler.js` already exports `validateSchedule(schedule)` but it’s not currently enforced in `background/service_worker.js`.

#### Validation rules to add

- If `frequency` exists, it must be `'weekly'` or `'biweekly'`
- If `frequency === 'biweekly'`:
  - `weekPattern` must be `'odd'` or `'even'`
- If `frequency !== 'biweekly'`:
  - allow `weekPattern` to be missing/null/undefined

#### Also enforce validation at the boundary (recommended)

In `background/service_worker.js` `MESSAGE_ACTIONS.SET_SCHEDULE` handler, do:

- `const { valid, error } = validateSchedule(schedule)`
- If invalid: return `{ success: false, error }`
- Else call `setSchedule(schedule)`

This ensures that even if UI changes regress, storage stays safe.

---

### Step 6 — Add UI fields in `popup/popup.html` (schedule modal)

**Goal**: allow choosing Weekly vs Biweekly + Odd/Even pattern.

Use **UI Option A** (single dropdown) but label it clearly so the meaning is obvious to users.

Add this exact select to the schedule modal body (near Day/Time):

```html
<select id="schedule-frequency-select">
  <option value="weekly">Every week</option>
  <option value="biweekly-odd">1st & 3rd week of month</option>
  <option value="biweekly-even">2nd & 4th week of month</option>
</select>
```

Mapping rules:

- `weekly` → `frequency='weekly'`, `weekPattern=null`
- `biweekly-odd` → `frequency='biweekly'`, `weekPattern='odd'`
- `biweekly-even` → `frequency='biweekly'`, `weekPattern='even'`

---

### Step 7 — Wire UI fields into `popup/popup.js`

**Goal**: Persist the new fields through `SET_SCHEDULE` and display them.

#### Add DOM caching

In `cacheElements()` add:

- `elements.scheduleFrequencySelect = document.getElementById('schedule-frequency-select')`
- (optional) `elements.scheduleWeekPatternSelect = ...`

#### Populate on modal open/edit

In `openScheduleModal(scheduleId)`:

- When creating new schedules: default to weekly
- When editing: read `schedule.frequency` / `schedule.weekPattern` and populate

#### Save the fields

In `saveSchedule()`:

- Compute frequency/pattern based on selection (use this exact mapping)
- Include them in `scheduleData` before sending `SET_SCHEDULE`

```js
const val = elements.scheduleFrequencySelect.value;
const frequency = val === 'weekly' ? 'weekly' : 'biweekly';
const weekPattern =
  val === 'biweekly-odd' ? 'odd' :
  val === 'biweekly-even' ? 'even' : null;
```

#### Render schedule list text

In `renderScheduleList()` (currently shows “Wed at 2:00 PM”):

- Append frequency detail:
  - weekly: “Weekly”
  - biweekly odd: “1st & 3rd weeks”
  - biweekly even: “2nd & 4th weeks”

This is purely display; `checkSchedules()` is the enforcement.

---

### Step 8 — Update schedule description helpers (optional but recommended)

`background/scheduler.js` has `getScheduleDescription(schedule)` which currently returns e.g. “Monday at 2:30 AM”.

Update it to include the new frequency:

- Weekly: “Monday at 2:30 AM (Weekly)”
- Biweekly odd: “Wednesday at 2:30 AM (1st & 3rd)”
- Biweekly even: “Wednesday at 2:30 AM (2nd & 4th)”

Then optionally use it from the popup when rendering schedule items.

---

### Step 9 — Manual Testing Plan (works with your current extension workflow)

Because schedules are evaluated every minute and use ET, focus on deterministic tests.

#### Test matrix

Pick a weekday near “now” and create three schedules for a test source:

- Weekly
- Biweekly odd
- Biweekly even

#### How to validate “due now” logic quickly

Use the existing “Test mode (fast overlap testing)” schedule fields to make runs short.

Suggested steps:

- Set schedule to run a few minutes ahead of the current ET time
- Confirm that:
  - Weekly triggers when day/time window matches
  - Biweekly triggers only on matching odd/even bucket week
- Confirm overlap queue behavior:
  - Start a manual scrape so a schedule must queue
  - Wait for due window
  - Verify it is added to `pendingSchedules`
  - Stop manual scrape; verify pending runs

#### Debug commands (already documented in README)

In service worker console:

```js
chrome.runtime.sendMessage({action: 'GET_SCHEDULES'}, console.log);
chrome.runtime.sendMessage({action: 'GET_QUEUE_STATUS'}, console.log);
```

#### Validate `nextRun` display

In the popup:

- Verify “Next:” line updates and reflects the correct future week occurrence for biweekly schedules.

---

## Edge Cases + Decisions

### Week 5 behavior

Months with 29–31 days create a “week 5” bucket (days 29–31).

Recommended rule:

- Treat week 5 as **odd**
  - Odd schedules still run (you get a “bonus” 5th-week run when it exists)
  - Even schedules do not run in week 5

If you prefer to **skip week 5 entirely**, modify `getOddEvenWeekPattern()` to return `null` for week 5 and skip triggering when `null`.

### Month boundaries

Because the rule is based on day-of-month buckets, the pattern naturally resets every month. The day-by-day search strategy for `calculateNextRun()` handles month transitions safely.

### Backward compatibility

Existing schedules stored in `chrome.storage.local` won’t have `frequency`/`weekPattern`.

- With defaults (frequency=weekly), behavior remains unchanged.

---

## Files to Modify (Implementation Checklist)

- **`background/scheduler.js`**
  - Add week-of-month helpers
  - Update `checkSchedules()` to enforce biweekly pattern
  - Update `calculateNextRun()` to compute next biweekly occurrence
  - Update `validateSchedule()` to validate new fields
  - (Optional) Update `getScheduleDescription()`

- **`background/service_worker.js`**
  - Enforce `validateSchedule()` inside `MESSAGE_ACTIONS.SET_SCHEDULE` handler (recommended)

- **`popup/popup.html`**
  - Add schedule frequency selection UI in the schedule modal

- **`popup/popup.js`**
  - Cache new DOM fields
  - Populate fields when editing schedules
  - Include fields in `SET_SCHEDULE` payload
  - Update schedule rendering to display frequency/pattern

- **`utils/constants.js`**
  - Optional: add enums/constants for schedule frequencies/patterns (not strictly required)

---

## Rollout Notes

- This change is low-risk because it mostly affects:
  - the decision gate in `checkSchedules()`
  - the `nextRun` calculation used for display and sorting
- The overlap/pending queue system doesn’t need structural changes and should continue working as-is.


