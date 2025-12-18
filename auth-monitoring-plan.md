# Auth Monitoring & Alerting Implementation Plan

This document describes how to implement **authentication monitoring** for Savvy Pirate, detecting and alerting when:

- **LinkedIn signs out** — session expired or logged out
- **LinkedIn flags the account** — security checkpoint, CAPTCHA, or bot detection
- **Google OAuth expires** — Sheets API authentication fails

The implementation integrates with the existing Zapier webhook notification system so Russell receives immediate alerts via Slack/email/SMS when manual intervention is needed on the Pi.

---

## Current Architecture (What Exists Today)

### Notification System

- **File**: `background/notifications.js`
- **Webhook storage**: `STORAGE_KEYS.WEBHOOK_URL` in `chrome.storage.local`
- **Send function**: `sendNotification(type, data)` — posts JSON to Zapier
- **Existing types**: `schedule_started`, `schedule_completed`, `schedule_failed`, `scrape_complete`, `scrape_failed`, `new_connections`, `error`, `test`
- **Categories**: `'error'` or `'status'` — for Zapier filtering

### Scraping Flow

1. Schedule triggers or manual scrape starts
2. Service worker gets/creates dedicated scrape tab
3. Tab navigates to LinkedIn search URL
4. Content script extracts profiles
5. Data queued and synced to Google Sheets

### Where Auth Failures Can Occur

| Failure Point | Location | Current Behavior |
|---------------|----------|------------------|
| LinkedIn signed out | After navigation, before scrape | Scrape fails silently or returns 0 profiles |
| LinkedIn security checkpoint | After navigation | Scrape fails, no specific detection |
| Google OAuth expired / revoked | Sheets API calls (`background/sheets_api.js`) | `fetchWithRetry()` detects 401 once, removes cached token, retries once; if still failing, `apiCall()` throws (status + response text) |

---

## Desired Behavior (New Feature)

### Detection Points

```
┌─────────────────────────────────────────────────────────────────┐
│                      SCHEDULED SCRAPE STARTS                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Navigate to LinkedIn search URL                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. CHECK: LinkedIn Auth Status                                  │
│     - Signed out? → ALERT + ABORT                                │
│     - Security checkpoint? → ALERT + ABORT                       │
│     - OK? → Continue                                             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Scrape profiles                                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Sync to Google Sheets                                        │
│     - 401 error? → ALERT (Google OAuth expired)                  │
│     - OK? → Continue                                             │
└─────────────────────────────────────────────────────────────────┘
```

### New Notification Types

| Type | Category | Trigger | Message |
|------|----------|---------|---------|
| `auth_linkedin_signout` | error | LinkedIn login page detected | 🔐 LinkedIn signed out - manual login required |
| `auth_linkedin_checkpoint` | error | Security checkpoint/CAPTCHA detected | ⚠️ LinkedIn security challenge - check Pi immediately |
| `auth_google_expired` | error | Sheets API returns 401 | 🔑 Google auth expired - re-authenticate on Pi |

### Behavior on Auth Failure

1. **Send webhook notification immediately**
2. **Abort current scrape** (don't waste time on pages that won't work)
3. **Mark execution as failed** with auth-specific error
4. **Don't retry automatically** (manual intervention required)

---

## Implementation Steps (Recommended Order)

### Step 1 — Add LinkedIn Auth Check Function to Content Script

**File**: `content/content.js`

**Goal**: Create a function that inspects the current page and determines LinkedIn auth status.

Important constraint: `content/content.js` is a **single IIFE** (“no ES modules, no imports”). Add the function **inside the IIFE scope**, near the top (after CONFIG/SELECTORS/helpers is fine).

```javascript
// ============================================================
// LINKEDIN AUTH STATUS CHECK (Validated via console testing)
// ============================================================

/**
 * Check if an element is actually visible on the page
 * Important: LinkedIn (and many sites) may include hidden bot-protection elements; ignore hidden elements
 * @param {Element} el - DOM element to check
 * @returns {boolean} - True if element is visible
 */
function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           el.offsetParent !== null;
}

/**
 * Check LinkedIn authentication status on current page
 * Called before scraping to detect sign-out or security challenges
 * 
 * Validation checklist (run these in the Pi browser console before shipping):
 * - Logged-in feed page: should return 'ok'
 * - Logged-in search page: should return 'ok'
 * - Logged-out/login page: should return 'signed_out'
 * 
 * @returns {{status: 'ok'|'signed_out'|'checkpoint', message: string, url: string}}
 */
function checkLinkedInAuthStatus() {
    const url = window.location.href;
    
    // ---- CHECK 1: URL-based detection ----
    
    // Redirected to login page
    if (url.includes('/login') || 
        url.includes('/uas/login') || 
        url.includes('/authwall') ||
        url.includes('linkedin.com/m/login')) {
        return { 
            status: 'signed_out', 
            message: 'Redirected to LinkedIn login page',
            url: url 
        };
    }
    
    // Security checkpoint (bot detection, verification required)
    if (url.includes('/checkpoint/') || 
        url.includes('/challenge/') ||
        url.includes('/security/') ||
        url.includes('/uas/consumer-email-challenge')) {
        return { 
            status: 'checkpoint', 
            message: 'LinkedIn security checkpoint detected',
            url: url 
        };
    }
    
    // ---- CHECK 2: DOM-based detection (with visibility checks) ----
    
    // Login form present on page
    const loginFormSelectors = [
        'form.login__form',
        '[data-id="sign-in-form"]',
        'form[action*="login-submit"]',
        '.login-form',
        '#login-form',
        'form[action*="uas/login"]'
    ];
    
    for (const selector of loginFormSelectors) {
        const element = document.querySelector(selector);
        if (element && isElementVisible(element)) {
            return { 
                status: 'signed_out', 
                message: `Login form detected on page (${selector})`,
                url: url 
            };
        }
    }
    
    // CAPTCHA detection note:
    // Do NOT use `.grecaptcha-badge` as a checkpoint signal — on many sites it can be present/visible
    // even when fully authenticated. Instead, rely on checkpoint/challenge URLs and explicit
    // visible CAPTCHA / challenge containers below.
    
    // Other CAPTCHA selectors (less common, still check visibility)
    const captchaSelectors = [
        '.captcha',
        '#captcha',
        '[data-captcha]'
    ];
    
    for (const selector of captchaSelectors) {
        const element = document.querySelector(selector);
        if (element && isElementVisible(element)) {
            return { 
                status: 'checkpoint', 
                message: `CAPTCHA challenge detected (${selector})`,
                url: url 
            };
        }
    }
    
    // Security verification elements
    const securitySelectors = [
        '[class*="security-verification"]',
        '[data-test="security-challenge"]',
        '.checkpoint-challenge',
        '#email-pin-challenge',
        '.challenge-dialog'
    ];
    
    for (const selector of securitySelectors) {
        const element = document.querySelector(selector);
        if (element && isElementVisible(element)) {
            return { 
                status: 'checkpoint', 
                message: `Security verification detected (${selector})`,
                url: url 
            };
        }
    }
    
    // All checks passed
    return { status: 'ok', message: 'Authenticated', url: url };
}
```

---

### Step 2 — Add Message Handler for Auth Check in Content Script

**File**: `content/content.js`

**Goal**: Allow service worker to request auth status check via messaging.

Your `content/content.js` already has a `chrome.runtime.onMessage.addListener` with a `switch (message.action)` handling `START_SCRAPING`, `STOP_SCRAPING`, and `PING`.

Add one new case to that existing switch:

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        // ... existing cases ...

        case 'CHECK_LINKEDIN_AUTH': {
            const authStatus = checkLinkedInAuthStatus();
            sendResponse(authStatus);
            return true;
        }
    }
});
```

Optional (recommended): add `CHECK_LINKEDIN_AUTH: 'CHECK_LINKEDIN_AUTH'` to `MESSAGE_ACTIONS` in `utils/constants.js`, so the service worker can send it via `MESSAGE_ACTIONS.CHECK_LINKEDIN_AUTH` (content script still matches the same string value).

---

### Step 3 — Add New Notification Types in notifications.js

**File**: `background/notifications.js`

**Goal**: Add message templates and convenience methods for auth alerts.

#### 3a. Update generateMessage() function

Add new message types to the messages object:

```javascript
function generateMessage(type, data) {
    const messages = {
        // ... existing types ...
        'schedule_started': `🚀 Scheduled scrape started for ${data.sourceName}`,
        'schedule_completed': `✅ Scheduled scrape completed for ${data.sourceName}: ${data.profilesScraped || 0} profiles scraped`,
        'schedule_failed': `❌ Scheduled scrape FAILED for ${data.sourceName}: ${data.error || 'Unknown error'}`,
        'scrape_complete': `📊 Scrape complete: ${data.profilesScraped || 0} profiles from ${data.sourceName}`,
        'scrape_failed': `❌ Scrape failed for "${data.personName}" in search "${data.searchName}": ${data.failureType || 'Unknown'} - ${data.error || 'Unknown error'}`,
        'new_connections': `🆕 Found ${data.newConnections || 0} new connections for ${data.sourceName}`,
        'error': `🚨 ERROR: ${data.error || 'Unknown error'}`,
        'test': '🧪 Test notification from Savvy Pirate - webhook is working!',
        
        // NEW: Auth alert types
        'auth_linkedin_signout': `🔐 LINKEDIN SIGNED OUT - Manual login required on Pi. ${data.details || ''}`,
        'auth_linkedin_checkpoint': `⚠️ LINKEDIN SECURITY CHALLENGE - Manual intervention required on Pi. ${data.details || ''}`,
        'auth_google_expired': `🔑 GOOGLE AUTH EXPIRED - Re-authentication required on Pi. ${data.details || ''}`
    };
    
    return messages[type] || `Notification: ${type}`;
}
```

#### 3b. Update error types array for category detection

In `sendNotification()`, update the errorTypes array:

```javascript
const errorTypes = [
    'schedule_failed', 
    'scrape_failed', 
    'error',
    // NEW: Auth errors
    'auth_linkedin_signout',
    'auth_linkedin_checkpoint',
    'auth_google_expired'
];
```

#### 3c. Add convenience methods for auth notifications

Add these new export functions at the bottom of the file:

```javascript
// ============================================================
// AUTH ALERT CONVENIENCE METHODS
// ============================================================

/**
 * Notify when LinkedIn session is signed out
 * @param {string} details - Additional context (URL, detection method)
 * @param {string} sourceName - Source that was being scraped (if applicable)
 */
export async function notifyLinkedInSignedOut(details, sourceName = null) {
    return sendNotification('auth_linkedin_signout', {
        sourceName: sourceName || 'N/A',
        details: details,
        requiresAction: 'Log into LinkedIn on Pi browser',
        timestamp: new Date().toISOString()
    });
}

/**
 * Notify when LinkedIn security checkpoint/CAPTCHA is detected
 * @param {string} details - Additional context (URL, challenge type)
 * @param {string} sourceName - Source that was being scraped (if applicable)
 */
export async function notifyLinkedInCheckpoint(details, sourceName = null) {
    return sendNotification('auth_linkedin_checkpoint', {
        sourceName: sourceName || 'N/A',
        details: details,
        requiresAction: 'Complete security challenge on Pi browser',
        timestamp: new Date().toISOString()
    });
}

/**
 * Notify when Google OAuth token expires
 * @param {string} error - Error message from API
 * @param {string} sourceName - Source that was being scraped (if applicable)
 */
export async function notifyGoogleAuthExpired(error, sourceName = null) {
    return sendNotification('auth_google_expired', {
        sourceName: sourceName || 'N/A',
        details: error,
        requiresAction: 'Re-authenticate Google account on Pi browser',
        timestamp: new Date().toISOString()
    });
}
```

---

### Step 4 — Create Auth Check Utility Function in Service Worker

**File**: `background/service_worker.js`

**Goal**: Create a reusable function that checks LinkedIn auth before scraping.

Add this near the other utility functions (after imports, before main logic):

```javascript
// ============================================================
// AUTH CHECK UTILITIES
// ============================================================
// NOTE: background/service_worker.js is an ES module.
// Do NOT add imports mid-file.
// Instead, update the existing top-level import from './notifications.js'
// to include: notifyLinkedInSignedOut, notifyLinkedInCheckpoint, notifyGoogleAuthExpired.

/**
 * Check LinkedIn auth status before scraping
 * Sends notification and returns false if auth issue detected
 * @param {number} tabId - Tab ID to check
 * @param {string} sourceName - Source being scraped (for notification context)
 * @returns {Promise<{ok: boolean, status: string, message: string}>}
 */
async function checkLinkedInAuthBeforeScrape(tabId, sourceName) {
    console.log(`${LOG} Checking LinkedIn auth status for tab ${tabId}...`);
    
    try {
        // Give page a moment to fully load/redirect
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Request auth check from content script
        const authStatus = await chrome.tabs.sendMessage(tabId, { 
            action: 'CHECK_LINKEDIN_AUTH' 
        });
        
        console.log(`${LOG} Auth check result:`, authStatus);
        
        if (authStatus.status === 'signed_out') {
            console.error(`${LOG} ❌ LinkedIn signed out detected!`);
            await notifyLinkedInSignedOut(authStatus.message, sourceName);
            return { ok: false, status: 'signed_out', message: authStatus.message };
        }
        
        if (authStatus.status === 'checkpoint') {
            console.error(`${LOG} ⚠️ LinkedIn security checkpoint detected!`);
            await notifyLinkedInCheckpoint(authStatus.message, sourceName);
            return { ok: false, status: 'checkpoint', message: authStatus.message };
        }
        
        console.log(`${LOG} ✅ LinkedIn auth OK`);
        return { ok: true, status: 'ok', message: 'Authenticated' };
        
    } catch (error) {
        // Content script might not be loaded yet or tab might have navigated away
        console.warn(`${LOG} Auth check failed (content script not responding):`, error.message);
        
        // Check if we can at least see the tab URL
        try {
            const tab = await chrome.tabs.get(tabId);
            const url = tab.url || '';
            
            // URL-based fallback detection
            if (url.includes('/login') || url.includes('/authwall') || url.includes('/uas/login')) {
                console.error(`${LOG} ❌ LinkedIn signed out detected (URL fallback)!`);
                await notifyLinkedInSignedOut(`Redirected to: ${url}`, sourceName);
                return { ok: false, status: 'signed_out', message: `Redirected to login: ${url}` };
            }
            
            if (url.includes('/checkpoint/') || url.includes('/challenge/')) {
                console.error(`${LOG} ⚠️ LinkedIn checkpoint detected (URL fallback)!`);
                await notifyLinkedInCheckpoint(`Challenge URL: ${url}`, sourceName);
                return { ok: false, status: 'checkpoint', message: `Security challenge: ${url}` };
            }
        } catch (tabError) {
            console.warn(`${LOG} Could not get tab info:`, tabError.message);
        }
        
        // If we can't determine, assume OK and let scrape attempt proceed
        // (it will fail naturally if there's an issue)
        return { ok: true, status: 'unknown', message: 'Could not verify auth, proceeding anyway' };
    }
}
```

---

### Step 5 — Integrate Auth Check into ALL scrape flows (Auto-run + Manual + Scheduled)

**File**: `background/service_worker.js`

**Goal**: Call auth check **after navigating to LinkedIn** (and after the existing “wait for injection” delay), but **before** `START_SCRAPING`.

There are three places you navigate to `search.url` and then call `START_SCRAPING`:

- **Auto-run**: `processAutoRunQueue()` (currently waits ~6000ms after navigation)
- **Manual scrape**: `processManualScrape()` (currently waits ~5000ms after navigation)
- **Scheduled scrape**: `executeScheduledRun(schedule)` (also navigates then waits before `START_SCRAPING`)

In each location you’ll see this pattern:

```javascript
await chrome.tabs.update(tab.id, { url: search.url });
await new Promise(resolve => setTimeout(resolve, 5000)); // or 6000 for auto-run
```

Insert the auth check **right after the delay**, and **before** `chrome.tabs.sendMessage(... START_SCRAPING ...)`:

```javascript
// Navigate to search URL
await chrome.tabs.update(tab.id, { url: search.url });
await new Promise(resolve => setTimeout(resolve, 5000));

// NEW: Check LinkedIn auth status before scraping
// Use the source name relevant to the current flow:
// - scheduled: schedule.sourceName
// - manual: state.sourceName
// - auto-run: source (loop variable)
const authCheck = await checkLinkedInAuthBeforeScrape(tab.id, sourceName);
if (!authCheck.ok) {
    console.error(`${LOG} Auth check failed, aborting scheduled run`);
    
    // Update execution record with auth failure
    await updateExecutionRecord(execution.id, {
        status: 'failed',
        error: `Auth failure: ${authCheck.message}`,
        completedAt: new Date().toISOString()
    });
    
    // Notify schedule failed (in addition to auth-specific notification already sent)
    await notifyScheduleFailed(schedule.sourceName, `Authentication issue: ${authCheck.message}`);
    
    return; // Abort the scheduled run
}

// Continue with scraping...
```

---

### Step 6 — Integrate Auth Check into Manual Scrape Flow

**File**: `background/service_worker.js`

**Goal**: Same auth check for manual scrapes.

Find `processManualScrape()` and add the same check after navigation:

```javascript
// Navigate to search URL
await chrome.tabs.update(tab.id, { url: currentSearch.url });
await new Promise(resolve => setTimeout(resolve, 5000));

// NEW: Check LinkedIn auth status
const authCheck = await checkLinkedInAuthBeforeScrape(tab.id, sourceName);
if (!authCheck.ok) {
    console.error(`${LOG} Auth check failed, stopping manual scrape`);
    
    // Update state
    state.isRunning = false;
    state.isAborted = false;
    await saveToStorage({ manualScrapeState: state });
    
    // Update execution record if exists
    if (state.executionId) {
        await updateExecutionRecord(state.executionId, {
            status: 'failed',
            error: `Auth failure: ${authCheck.message}`,
            completedAt: new Date().toISOString()
        });
    }

    // If a scrape was deferred due to overlap, unblock that queue after stopping manual mode
    await processPendingSchedules();
    
    return; // Stop manual scrape
}

// Continue with scraping...
```

---

### Step 7 — Add Google OAuth Expiration Detection

**File**: `background/sheets_api.js`

**Goal**: Detect 401 responses and send notification.

Your code already has centralized request logic:

- `fetchWithRetry(url, options, retryCount = 0)` refreshes the token and retries once on 401.
- `apiCall(endpoint, options)` throws if the final response is not ok.

Make this agentic-ready by adding detection in **one** centralized place (recommended: `apiCall()`), and **do not use dynamic imports**.

#### 7a. Add a top-level import (agentic-safe)

At the top of `background/sheets_api.js`, add:

```javascript
import { notifyGoogleAuthExpired } from './notifications.js';
```

#### 7b. Notify when `getAuthToken(...)` fails

In `apiCall()`, wrap `getAuthToken(true)` in try/catch. If it throws, call `notifyGoogleAuthExpired(...)` and then rethrow.

#### 7c. Notify when 401 persists after refresh

After `const response = await fetchWithRetry(...)`, add:

- If `response.status === 401`, this means we already tried refresh once and still got 401 → fire `auth_google_expired` and throw a clear error.

**Agentic note**: `sheets_api.js` doesn’t know the current `sourceName`, so send `sourceName: 'N/A'` and include details like endpoint + truncated error body.

---

### Step 8 — Add Auth Check on Extension Startup (Optional but Recommended)

**File**: `background/service_worker.js`

**Goal**: Proactively check auth status when extension starts or wakes up.

This catches auth issues before they cause a failed scheduled scrape.

```javascript
// ============================================================
// STARTUP AUTH CHECK (Optional)
// ============================================================

/**
 * Perform startup auth checks
 * Called when service worker starts
 */
async function performStartupAuthChecks() {
    console.log(`${LOG} Performing startup auth checks...`);
    
    // Check Google OAuth
    try {
        // Use non-interactive token fetch to avoid popping auth UI unexpectedly.
        // If this fails, it usually means the user must re-auth.
        const token = await getAuthToken(false);
        if (!token) {
            console.warn(`${LOG} No Google auth token available`);
            await notifyGoogleAuthExpired('No auth token available on startup', null);
        } else {
            console.log(`${LOG} ✅ Google OAuth token present`);
        }
    } catch (error) {
        console.error(`${LOG} Google auth check failed:`, error.message);
        await notifyGoogleAuthExpired(error.message, null);
    }
    
    // Note: Can't easily check LinkedIn without navigating there,
    // so we rely on pre-scrape checks for that
}

// Agentic placement: service_worker.js already has an async initialization IIFE.
// Call performStartupAuthChecks() from that IIFE so it runs whenever the service worker starts.
// (You can keep onStartup/onInstalled listeners too, but the IIFE call is the reliable baseline.)
```

---

### Step 9 — Prevent Notification Spam (Rate Limiting)

**File**: `background/notifications.js`

**Goal**: Don't send repeated auth alerts if the issue persists across multiple scrape attempts.

Important constraint: MV3 service workers can restart, so **in-memory cooldown resets** and can spam. Use `chrome.storage.local` for cooldown persistence.

Implement a persisted cooldown map (recommended storage location: `STORAGE_KEYS.NOTIFICATION_SETTINGS`), for example:

- `notificationSettings.authLastSent`: `{ [type]: isoTimestampString }`

```javascript
// ============================================================
// AUTH NOTIFICATION RATE LIMITING
// ============================================================

const AUTH_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

async function getAuthLastSentMap() {
    const stored = await getFromStorage([STORAGE_KEYS.NOTIFICATION_SETTINGS]);
    const settings = stored[STORAGE_KEYS.NOTIFICATION_SETTINGS] || {};
    return settings.authLastSent || {};
}

async function setAuthLastSent(type, isoTimestamp) {
    const stored = await getFromStorage([STORAGE_KEYS.NOTIFICATION_SETTINGS]);
    const settings = stored[STORAGE_KEYS.NOTIFICATION_SETTINGS] || {};
    const authLastSent = settings.authLastSent || {};
    authLastSent[type] = isoTimestamp;
    await saveToStorage({
        [STORAGE_KEYS.NOTIFICATION_SETTINGS]: {
            ...settings,
            authLastSent
        }
    });
}

async function shouldSendAuthNotification(type) {
    const lastMap = await getAuthLastSentMap();
    const lastIso = lastMap[type];
    if (!lastIso) return true;

    const lastMs = Date.parse(lastIso);
    if (!Number.isFinite(lastMs)) return true;

    const now = Date.now();
    if (now - lastMs < AUTH_NOTIFICATION_COOLDOWN_MS) {
        console.log(`${LOG} Skipping ${type} notification (cooldown active)`);
        return false;
    }
    return true;
}
```

Update the convenience methods to use rate limiting:

```javascript
export async function notifyLinkedInSignedOut(details, sourceName = null) {
    if (!(await shouldSendAuthNotification('auth_linkedin_signout'))) {
        return false; // Skip, already notified recently
    }
    
    const result = await sendNotification('auth_linkedin_signout', {
        sourceName: sourceName || 'N/A',
        details: details,
        requiresAction: 'Log into LinkedIn on Pi browser',
        timestamp: new Date().toISOString()
    });
    
    if (result) {
        await setAuthLastSent('auth_linkedin_signout', new Date().toISOString());
    }
    
    return result;
}

// Apply same pattern to other auth notification functions...
```

---

## Files to Modify (Implementation Checklist)

### `content/content.js`
- [ ] Add `checkLinkedInAuthStatus()` function
- [ ] Add message handler for `CHECK_LINKEDIN_AUTH` action

### `background/notifications.js`
- [ ] Add new message types to `generateMessage()`
- [ ] Update `errorTypes` array in `sendNotification()`
- [ ] Add `notifyLinkedInSignedOut()` convenience method
- [ ] Add `notifyLinkedInCheckpoint()` convenience method
- [ ] Add `notifyGoogleAuthExpired()` convenience method
- [ ] Add rate limiting for auth notifications (optional)

### `background/service_worker.js`
- [ ] Import new notification functions
- [ ] Add `checkLinkedInAuthBeforeScrape()` utility function
- [ ] Integrate auth check into `processAutoRunQueue()` after navigation+delay and before `START_SCRAPING`
- [ ] Integrate auth check into `executeScheduledRun()` after navigation
- [ ] Integrate auth check into `processManualScrape()` after navigation
- [ ] Add startup auth check (optional)

### `background/sheets_api.js`
- [ ] Add detection in `apiCall()` for “401 persists after token refresh retry”
- [ ] Call `notifyGoogleAuthExpired()` when `getAuthToken(...)` fails (revoked / user interaction required)
- [ ] Call `notifyGoogleAuthExpired()` when response is still 401 after retry

---

## Testing Plan

### Test 1: LinkedIn Sign-Out Detection

**Setup**: Log out of LinkedIn in the Pi's Chromium browser

**Steps**:
1. Trigger a manual scrape or wait for scheduled scrape
2. Extension navigates to LinkedIn search URL
3. LinkedIn redirects to login page

**Expected**:
- Console shows: `[SW] ❌ LinkedIn signed out detected!`
- Zapier webhook receives `auth_linkedin_signout` notification
- Scrape aborts (doesn't attempt to scrape login page)
- Execution record shows failed status with auth error

### Test 2: LinkedIn Checkpoint Detection

**Note**: This is harder to trigger intentionally. You can simulate by:
- Navigating to a URL containing `/checkpoint/` manually
- Or modifying the content script temporarily to detect a specific element

**Expected**:
- Console shows: `[SW] ⚠️ LinkedIn security checkpoint detected!`
- Zapier webhook receives `auth_linkedin_checkpoint` notification
- Scrape aborts

### Test 3: Google OAuth Expiration

**Setup**: Revoke the extension's Google access or wait for token to expire

**Steps**:
1. Start a scrape that successfully extracts profiles
2. When syncing to Sheets, API returns 401

**Expected**:
- Console shows: `[SHEETS] ❌ Google OAuth expired`
- Zapier webhook receives `auth_google_expired` notification

### Test 4: Rate Limiting

**Steps**:
1. Trigger LinkedIn sign-out detection
2. Wait for notification
3. Immediately trigger another scrape attempt (without fixing the issue)

**Expected**:
- First attempt sends notification
- Second attempt (within 30 min) skips notification, logs cooldown message

### Test 5: Normal Operation (No False Positives)

**Steps**:
1. Ensure logged into LinkedIn and Google
2. Run several scheduled and manual scrapes

**Expected**:
- No auth notifications sent
- Scrapes complete normally
- Console shows: `[SW] ✅ LinkedIn auth OK`

---

## Edge Cases & Considerations

### Content Script Not Loaded

If the content script hasn't injected yet when we check auth, the message will fail. The fallback in `checkLinkedInAuthBeforeScrape()` handles this by:
1. Catching the error
2. Checking tab URL directly (URL-based fallback detection)
3. If URL looks OK, proceeding anyway

### Page Load Timing

The 2-second delay after navigation gives the page time to:
- Redirect to login (if signed out)
- Redirect to checkpoint (if flagged)
- Load content script

This may need tuning based on Pi performance.

### False Positives

Suggested console validation (run on the Pi before shipping):
- Logged-in feed page: should return `ok`
- Logged-in search page: should return `ok`
- Logged-out/login page: should return `signed_out`

**Key fix applied**: Do **not** treat `.grecaptcha-badge` as a checkpoint signal (it’s not a reliable indicator). Instead use multiple signals (URL redirects + visible login form + visible CAPTCHA/challenge containers) to avoid false positives.

Possible remaining edge cases:
- Slow network causing partial page load
- LinkedIn A/B testing different layouts

Mitigation:
- Multiple detection methods (URL + DOM)
- Visibility checks prevent false positives from hidden elements
- "Unknown" status proceeds with caution
- Rate limiting prevents spam if detection is flaky

### Notification Failures

If Zapier webhook fails, the auth issue still exists but you won't know. Consider:
- Adding a fallback notification method (e.g., write to a Google Sheet)
- Having the Pi send a daily "health check" webhook so silence = problem

---

## Zapier Configuration

### Recommended Zap Setup

**Trigger**: Webhook (Catch Hook)

**Filter**: Only continue if `type` contains `auth_`

**Actions**:
1. **Slack Message** (immediate alert channel)
   - Message: `{{data.message}}`
   - Include `{{data.requiresAction}}` and `{{timestamp}}`

2. **Email** (backup)
   - Subject: `🚨 Savvy Pirate Auth Alert: {{type}}`
   - Body: Include all data fields

3. **SMS via Kixie** (optional, for critical alerts)
   - Only for `auth_linkedin_checkpoint` (potential account issue)

---

## Summary

This implementation adds three layers of auth monitoring:

1. **LinkedIn session** — checked before every scrape via content script
2. **LinkedIn security** — same check, different detection (checkpoints, CAPTCHA)
3. **Google OAuth** — checked on Sheets API 401 responses

All alerts flow through the existing Zapier webhook system with new notification types, rate limiting to prevent spam, and graceful fallbacks when detection is uncertain.

**Detection logic status**: ⚠️ Validate selectors/URLs in your current LinkedIn UI on the Pi browser before shipping

**Estimated implementation time**: 2-3 hours

**Risk level**: Low — adds checks without modifying core scraping logic

**Ready for agentic execution**: YES
