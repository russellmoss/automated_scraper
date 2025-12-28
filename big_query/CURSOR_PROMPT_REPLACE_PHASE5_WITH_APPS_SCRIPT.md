# Cursor.ai Prompt: Replace Phase 5 with Apps Script Web App

## Instructions for Cursor

Copy and paste this entire prompt into Cursor.ai chat while you have the implementation guide open.

---

## PROMPT START

I'm working on this file: `C:\Users\russe\automated_scraper\big_query\SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md`

We need to **completely replace Phase 5 (Cloud Function)** with an **Apps Script Web App** alternative. This is because the user doesn't have Cloud Functions deployment permissions, but can deploy Apps Script web apps.

The Apps Script will provide the exact same functionality as the Cloud Function:
- Receive HTTP POST requests from the Chrome Extension
- Write to BigQuery tables (advisors, connections, connection_observations, scrape_runs)
- Return JSON responses

## CHANGES REQUIRED

### PART 1: Update Executive Summary

Find the Executive Summary section and update line for Phase 5:

**Change:**
```
6. **Cloud Function (Phase 5)** - Data sync from Chrome Extension
```

**To:**
```
6. **Apps Script Web App (Phase 5)** - Data sync from Chrome Extension (no Cloud Functions permissions needed)
```

Also add to the "New in v4.4" or create "New in v4.5" section:
```
**New in v4.5:**
- Replaced Cloud Function with Apps Script Web App (no GCP admin permissions required)
- Same functionality, zero permission barriers
```

---

### PART 2: Update Configuration Constants

Find the Configuration Constants section and update:

**Change:**
```
CLOUD_FUNCTION_URL  = https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync
ALERT_FUNCTION_URL  = https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-alerts
```

**To:**
```
# Apps Script Web App URL (will be set after deployment in Phase 5)
APPS_SCRIPT_WEB_APP_URL = YOUR_APPS_SCRIPT_WEB_APP_URL_HERE

# Legacy Cloud Function URLs (not used - kept for reference)
# CLOUD_FUNCTION_URL  = https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync
# ALERT_FUNCTION_URL  = https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-alerts
```

---

### PART 3: Update Architecture Diagram

Find the architecture diagram and update the Cloud Function box:

**Change:**
```
│  │   Chrome     │────▶│         Cloud Function               │                  │
│  │  Extension   │     │   (savvy-pirate-sync)                │                  │
```

**To:**
```
│  │   Chrome     │────▶│      Apps Script Web App             │                  │
│  │  Extension   │     │   (savvy-pirate-sync)                │                  │
│  │  (Scraping)  │     │   ⚡ No GCP permissions needed       │                  │
```

---

### PART 4: Replace Entire Phase 5

Find `# PHASE 5: Cloud Function` and **replace the entire Phase 5 section** (from the Phase 5 header until Phase 6 begins) with the following:

---

# PHASE 5: Apps Script Web App (Data Sync Endpoint)

## Overview

This phase creates a Google Apps Script Web App that receives data from the Chrome Extension and writes to BigQuery. This replaces Cloud Functions and requires **zero GCP admin permissions**.

**Why Apps Script instead of Cloud Functions?**
- ✅ You can deploy it yourself (no `roles/cloudfunctions.developer` needed)
- ✅ Built-in BigQuery integration via Advanced Services
- ✅ Same functionality as Cloud Functions
- ✅ Free tier is generous (plenty for this use case)

**Trade-offs:**
- Slightly slower (~500ms vs ~100ms cold start)
- 6-minute execution limit (plenty for syncing profiles)

---

## Step 5.1: Create Apps Script Project

### 🤖 CURSOR PROMPT 5.1

```
Create a new Google Apps Script project to serve as the data sync endpoint for the Chrome Extension.
```

### 📝 INSTRUCTIONS 5.1.1: Create the Project

1. Go to [Google Apps Script](https://script.google.com/)
2. Click **New Project**
3. Name it: `Savvy Pirate BigQuery Sync`
4. Delete the default `Code.gs` content

### 📝 INSTRUCTIONS 5.1.2: Enable BigQuery Advanced Service

1. In the Apps Script editor, click **Services** (+ icon on left sidebar)
2. Scroll down and find **BigQuery API**
3. Click **Add**
4. This enables `BigQuery` as a global object in your script

---

## Step 5.2: Add the Sync Code

### 🤖 CURSOR PROMPT 5.2

```
Add the main sync code to the Apps Script project. This handles all actions from the Chrome Extension.
```

### 📝 CODE SNIPPET 5.2.1: Main Code (Code.gs)

Copy this entire code into your `Code.gs` file:

```javascript
/**
 * Savvy Pirate BigQuery Sync - Apps Script Web App
 * 
 * This replaces the Cloud Function and provides the same functionality.
 * Receives HTTP POST requests from the Chrome Extension and writes to BigQuery.
 * 
 * Version: 1.0.0
 * Compatible with: Implementation Guide v4.5+
 */

// ============================================================
// CONFIGURATION
// ============================================================

const PROJECT_ID = 'savvy-gtm-analytics';
const DATASET_ID = 'savvy_pirate';

// ============================================================
// WEB APP ENTRY POINTS
// ============================================================

/**
 * Handle GET requests (for testing connectivity)
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: 'Savvy Pirate BigQuery Sync is running',
      project: PROJECT_ID,
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST requests (main entry point for Chrome Extension)
 */
function doPost(e) {
  try {
    // Parse the incoming JSON
    const payload = JSON.parse(e.postData.contents);
    const { action, data } = payload;
    
    console.log(`[SYNC] Received action: ${action}`);
    
    // Route to appropriate handler
    let result;
    switch (action) {
      case 'test_connection':
        result = testConnection();
        break;
      case 'sync_profiles':
        result = syncProfiles(data);
        break;
      case 'get_or_create_recruiter':
        result = getOrCreateRecruiter(data);
        break;
      case 'create_scrape_run':
        result = createScrapeRun(data);
        break;
      case 'complete_scrape_run':
        result = completeScrapeRun(data);
        break;
      case 'record_observation':
        result = recordObservation(data);
        break;
      case 'record_observations_batch':
        result = recordObservationsBatch(data);
        break;
      case 'sync_recruiters':
        result = syncRecruitersFromSheets(data);
        break;
      default:
        result = { success: false, error: `Unknown action: ${action}` };
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('[SYNC] Error:', error);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message || error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// TEST CONNECTION
// ============================================================

function testConnection() {
  try {
    // Try a simple BigQuery query to verify connection
    const query = 'SELECT 1 as test';
    BigQuery.Jobs.query({ query: query, useLegacySql: false }, PROJECT_ID);
    
    return {
      success: true,
      message: 'Connected to BigQuery',
      project: PROJECT_ID,
      dataset: DATASET_ID,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: `BigQuery connection failed: ${error.message}`
    };
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Generate a UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Normalize LinkedIn URL to standard format
 */
function normalizeLinkedInUrl(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? `https://www.linkedin.com/in/${match[1].toLowerCase()}` : url;
}

/**
 * Extract LinkedIn ID (slug) from URL
 */
function extractLinkedInId(url) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Run a BigQuery query and return results
 */
function runQuery(sql, useLegacySql = false) {
  const request = {
    query: sql,
    useLegacySql: useLegacySql
  };
  
  const queryResults = BigQuery.Jobs.query(request, PROJECT_ID);
  
  if (queryResults.rows) {
    return queryResults.rows.map(row => {
      const obj = {};
      queryResults.schema.fields.forEach((field, i) => {
        obj[field.name] = row.f[i].v;
      });
      return obj;
    });
  }
  
  return [];
}

/**
 * Insert rows into a BigQuery table
 */
function insertRows(tableId, rows) {
  const insertRequest = {
    rows: rows.map(row => ({ json: row }))
  };
  
  try {
    BigQuery.Tabledata.insertAll(insertRequest, PROJECT_ID, DATASET_ID, tableId);
    return { success: true, inserted: rows.length };
  } catch (error) {
    console.error(`[INSERT] Error inserting into ${tableId}:`, error);
    throw error;
  }
}

/**
 * Run a DML query (UPDATE, DELETE)
 */
function runDML(sql) {
  const request = {
    query: sql,
    useLegacySql: false
  };
  
  const job = BigQuery.Jobs.query(request, PROJECT_ID);
  return job;
}

// ============================================================
// SYNC PROFILES
// ============================================================

function syncProfiles(data) {
  const { profiles, recruiterId, recruiterName, searchType, scrapeRunId } = data;
  
  if (!profiles || !Array.isArray(profiles) || !recruiterId) {
    return { success: false, error: 'profiles array and recruiterId required' };
  }
  
  const today = new Date().toISOString().split('T')[0];
  let synced = 0;
  let errors = 0;
  
  for (const profile of profiles) {
    try {
      const linkedinUrl = normalizeLinkedInUrl(profile.linkedinUrl || profile.linkedin_url);
      const linkedinId = extractLinkedInId(profile.linkedinUrl || profile.linkedin_url);
      
      if (!linkedinUrl || !profile.name) continue;
      
      // Check if advisor exists
      const existingQuery = `
        SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.advisors\` 
        WHERE linkedin_url = '${linkedinUrl}' 
        LIMIT 1
      `;
      const existing = runQuery(existingQuery);
      
      let advisorId;
      
      if (existing.length > 0) {
        advisorId = existing[0].id;
        // Update last seen
        const updateSql = `
          UPDATE \`${PROJECT_ID}.${DATASET_ID}.advisors\` 
          SET last_seen_at = CURRENT_TIMESTAMP(), 
              times_seen = times_seen + 1,
              current_title = ${profile.title ? `'${profile.title.replace(/'/g, "''")}'` : 'current_title'},
              current_location = ${profile.location ? `'${profile.location.replace(/'/g, "''")}'` : 'current_location'},
              updated_at = CURRENT_TIMESTAMP()
          WHERE id = '${advisorId}'
        `;
        runDML(updateSql);
      } else {
        // Create new advisor
        advisorId = generateUUID();
        const now = new Date().toISOString();
        insertRows('advisors', [{
          id: advisorId,
          linkedin_url: linkedinUrl,
          linkedin_id: linkedinId,
          name: profile.name,
          current_title: profile.title || null,
          current_location: profile.location || null,
          first_seen_at: now,
          last_seen_at: now,
          times_seen: 1,
          created_at: now,
          updated_at: now
        }]);
      }
      
      // Check/update connection
      const connQuery = `
        SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.connections\` 
        WHERE advisor_id = '${advisorId}' AND recruiter_id = '${recruiterId}' 
        LIMIT 1
      `;
      const existingConn = runQuery(connQuery);
      
      if (existingConn.length > 0) {
        const updateConnSql = `
          UPDATE \`${PROJECT_ID}.${DATASET_ID}.connections\`
          SET last_seen_date = '${today}'
          WHERE advisor_id = '${advisorId}' AND recruiter_id = '${recruiterId}'
        `;
        runDML(updateConnSql);
      } else {
        insertRows('connections', [{
          id: generateUUID(),
          advisor_id: advisorId,
          recruiter_id: recruiterId,
          first_seen_date: today,
          last_seen_date: today,
          search_type: searchType || null,
          scrape_run_id: scrapeRunId || null,
          created_at: new Date().toISOString()
        }]);
      }
      
      synced++;
    } catch (err) {
      console.error('[SYNC] Profile sync error:', err);
      errors++;
    }
  }
  
  return { success: true, synced, errors, total: profiles.length };
}

// ============================================================
// GET OR CREATE RECRUITER
// ============================================================

function getOrCreateRecruiter(data) {
  const { name, frequency, company, title, sheetUrl } = data;
  
  if (!name) {
    return { success: false, error: 'name required' };
  }
  
  const trimmedName = name.trim().replace(/'/g, "''");
  
  const existingQuery = `
    SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` 
    WHERE name = '${trimmedName}' 
    LIMIT 1
  `;
  const existing = runQuery(existingQuery);
  
  if (existing.length > 0) {
    return { success: true, recruiterId: existing[0].id, created: false };
  }
  
  const recruiterId = generateUUID();
  const sheetId = sheetUrl ? (sheetUrl.match(/\/d\/([^/]+)/) || [])[1] : null;
  const now = new Date().toISOString();
  
  insertRows('recruiters', [{
    id: recruiterId,
    name: name.trim(),
    linkedin_url: null,
    company: company || null,
    title: title || null,
    frequency: frequency || '1st_3rd_week',
    output_sheet_url: sheetUrl || null,
    output_sheet_id: sheetId || null,
    is_active: true,
    created_at: now,
    updated_at: now
  }]);
  
  return { success: true, recruiterId, created: true };
}

// ============================================================
// CREATE SCRAPE RUN
// ============================================================

function createScrapeRun(data) {
  const { recruiterId, recruiterName, totalSearches } = data;
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayOfMonth = now.getDate();
  const weekOfMonth = Math.ceil(dayOfMonth / 7);
  
  // Calculate Monday of current week
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const scrapeWeek = monday.toISOString().split('T')[0];
  
  const scrapeRunId = generateUUID();
  
  insertRows('scrape_runs', [{
    id: scrapeRunId,
    recruiter_id: recruiterId,
    recruiter_name: recruiterName || null,
    started_at: now.toISOString(),
    completed_at: null,
    status: 'running',
    profiles_scraped: 0,
    new_connections_found: 0,
    searches_completed: 0,
    total_searches: totalSearches || 9,
    error_message: null,
    scrape_week: scrapeWeek,
    week_of_month: weekOfMonth,
    created_at: now.toISOString()
  }]);
  
  return { success: true, scrapeRunId };
}

// ============================================================
// COMPLETE SCRAPE RUN
// ============================================================

function completeScrapeRun(data) {
  const { scrapeRunId, profilesScraped, newConnections, searchesCompleted, status, error } = data;
  
  const updateSql = `
    UPDATE \`${PROJECT_ID}.${DATASET_ID}.scrape_runs\`
    SET completed_at = CURRENT_TIMESTAMP(),
        status = '${status || 'completed'}',
        profiles_scraped = ${profilesScraped || 0},
        new_connections_found = ${newConnections || 0},
        searches_completed = ${searchesCompleted || 0},
        error_message = ${error ? `'${error.replace(/'/g, "''")}'` : 'NULL'}
    WHERE id = '${scrapeRunId}'
  `;
  runDML(updateSql);
  
  return { success: true };
}

// ============================================================
// RECORD OBSERVATION (Point-in-Time Storage)
// ============================================================

function recordObservation(data) {
  const { 
    scrape_run_id, 
    recruiter_id, 
    advisor_id, 
    search_id,
    advisor_name,
    advisor_title,
    advisor_location,
    advisor_linkedin_url,
    search_job_title
  } = data;
  
  const observationId = `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  insertRows('connection_observations', [{
    id: observationId,
    scrape_run_id: scrape_run_id || null,
    recruiter_id: recruiter_id,
    advisor_id: advisor_id,
    search_id: search_id || null,
    observed_at: new Date().toISOString(),
    advisor_name: advisor_name || null,
    advisor_title: advisor_title || null,
    advisor_location: advisor_location || null,
    advisor_linkedin_url: advisor_linkedin_url || null,
    search_job_title: search_job_title || null,
    created_at: new Date().toISOString()
  }]);
  
  return { 
    success: true, 
    observation_id: observationId,
    message: 'Observation recorded'
  };
}

// ============================================================
// RECORD OBSERVATIONS BATCH
// ============================================================

function recordObservationsBatch(data) {
  const { scrape_run_id, recruiter_id, search_id, search_job_title, profiles } = data;
  
  if (!profiles || profiles.length === 0) {
    return { success: true, recorded: 0, message: 'No profiles to record' };
  }
  
  console.log(`[OBSERVATION] Recording ${profiles.length} observations for recruiter ${recruiter_id}`);
  
  const now = new Date().toISOString();
  const rows = profiles.map((profile, idx) => ({
    id: `obs_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
    scrape_run_id: scrape_run_id || null,
    recruiter_id: recruiter_id,
    advisor_id: profile.advisor_id || `adv_${Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, profile.linkedin_url || profile.name).map(b => (b + 128).toString(16).padStart(2, '0')).join('').substring(0, 32)}`,
    search_id: search_id || null,
    observed_at: now,
    advisor_name: profile.name || null,
    advisor_title: profile.title || null,
    advisor_location: profile.location || null,
    advisor_linkedin_url: profile.linkedin_url || null,
    search_job_title: search_job_title || null,
    created_at: now
  }));
  
  try {
    insertRows('connection_observations', rows);
    console.log(`[OBSERVATION] Successfully recorded ${rows.length} observations`);
    
    return { 
      success: true, 
      recorded: rows.length,
      message: `Recorded ${rows.length} observations`
    };
  } catch (error) {
    console.error('[OBSERVATION] Batch error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// SYNC RECRUITERS FROM SHEETS (Optional)
// ============================================================

function syncRecruitersFromSheets(data) {
  // This can be called to sync recruiters from Command & Control sheet
  // Implementation depends on your specific sheet structure
  return { 
    success: true, 
    message: 'Recruiter sync via Apps Script not yet implemented - use BigQuery scheduled query instead'
  };
}
```

---

## Step 5.3: Deploy as Web App

### 🤖 CURSOR PROMPT 5.3

```
Deploy the Apps Script as a web app that can receive HTTP requests from the Chrome Extension.
```

### 📝 INSTRUCTIONS 5.3.1: Deploy the Web App

1. In the Apps Script editor, click **Deploy** → **New deployment**
2. Click the gear icon ⚙️ next to "Select type" and choose **Web app**
3. Configure:
   - **Description:** `Savvy Pirate BigQuery Sync v1.0`
   - **Execute as:** `Me (your-email@savvywealth.com)`
   - **Who has access:** `Anyone`
4. Click **Deploy**
5. **IMPORTANT:** Copy the **Web app URL** - you'll need this!

The URL will look like:
```
https://script.google.com/macros/s/AKfycbw...xyz/exec
```

### 📝 INSTRUCTIONS 5.3.2: Save Your Web App URL

Update the Configuration Constants section at the top of this document:

```
APPS_SCRIPT_WEB_APP_URL = https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

### ⚠️ IMPORTANT: Authorization

The first time you deploy, Google will ask you to authorize the script:
1. Click **Authorize access**
2. Choose your Google account
3. Click **Advanced** → **Go to Savvy Pirate BigQuery Sync (unsafe)**
4. Click **Allow**

This grants the script permission to access BigQuery on your behalf.

---

## Step 5.4: Test the Web App

### 🤖 CURSOR PROMPT 5.4

```
Test the deployed Apps Script web app to verify it can connect to BigQuery.
```

### 📝 INSTRUCTIONS 5.4.1: Test via Browser (GET)

Open your web app URL in a browser:
```
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Savvy Pirate BigQuery Sync is running",
  "project": "savvy-gtm-analytics",
  "timestamp": "2024-12-28T..."
}
```

### 📝 INSTRUCTIONS 5.4.2: Test via PowerShell (POST)

```powershell
$url = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
$body = @{
    action = "test_connection"
    data = @{}
} | ConvertTo-Json

Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Connected to BigQuery",
  "project": "savvy-gtm-analytics",
  "dataset": "savvy_pirate"
}
```

### 📝 INSTRUCTIONS 5.4.3: Test via curl (Git Bash or WSL)

```bash
curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{"action": "test_connection", "data": {}}'
```

### ✅ VERIFICATION 5.4

The test is successful if:
- [ ] GET request returns JSON with `"success": true`
- [ ] POST request returns JSON with `"message": "Connected to BigQuery"`
- [ ] No authorization errors appear

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Browser shows "Script function not found" error
- [ ] POST request returns `"success": false`
- [ ] Authorization popup keeps appearing

### ❌ ERROR RECOVERY 5.4

| Error | Cause | Fix |
|-------|-------|-----|
| "Script function not found: doGet" | Code not saved | Save the script (Ctrl+S) and redeploy |
| "Exception: BigQuery API not enabled" | BigQuery service not added | Add BigQuery in Services panel |
| "Authorization required" | Not authorized | Click the URL, authorize when prompted |
| "You do not have permission" | Wrong access setting | Redeploy with "Anyone" access |
| "Exceeded maximum execution time" | Query too slow | Check BigQuery for issues |

---

## Step 5.5: Update Chrome Extension Configuration

### 🤖 CURSOR PROMPT 5.5

```
Configure the Chrome Extension to use the Apps Script Web App URL instead of Cloud Functions.
```

### 📝 INSTRUCTIONS 5.5.1: Configure via Extension Console

Open the service worker console (chrome://extensions → Savvy Pirate → "service worker"):

```javascript
// Paste this in service worker console to configure:
chrome.storage.local.set({
    bigquery_config: {
        cloudFunctionUrl: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
        configured_at: new Date().toISOString(),
        type: 'apps_script'  // Identifies this as Apps Script (not Cloud Function)
    }
}, () => console.log('✅ BigQuery config saved with Apps Script URL!'));
```

### 📝 INSTRUCTIONS 5.5.2: Verify Configuration

```javascript
// Verify the config was saved:
chrome.storage.local.get(['bigquery_config'], (data) => {
    console.log('BigQuery config:', data.bigquery_config);
    if (data.bigquery_config?.cloudFunctionUrl?.includes('script.google.com')) {
        console.log('✅ Apps Script URL configured correctly');
    } else {
        console.log('❌ URL does not look like Apps Script');
    }
});
```

### ✅ VERIFICATION 5.5

```javascript
// Test the connection from Chrome Extension:
const config = await chrome.storage.local.get(['bigquery_config']);
const url = config.bigquery_config?.cloudFunctionUrl;

if (url) {
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test_connection', data: {} })
    })
    .then(r => r.json())
    .then(d => console.log(d.success ? '✅ Apps Script connected!' : '❌ Failed:', d))
    .catch(e => console.log('❌ Error:', e.message));
} else {
    console.log('❌ No URL configured');
}
```

---

## Step 5.6: Test Full Sync Flow

### 🤖 CURSOR PROMPT 5.6

```
Test the complete sync flow by sending test profile data through the Apps Script.
```

### 📝 INSTRUCTIONS 5.6.1: Test Profile Sync

In the service worker console or via PowerShell:

```javascript
// Test creating a recruiter
const url = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';

fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        action: 'get_or_create_recruiter',
        data: {
            name: 'Test Recruiter (Apps Script)',
            frequency: '1st_3rd_week',
            company: 'Test Company'
        }
    })
})
.then(r => r.json())
.then(d => console.log('Recruiter result:', d));
```

### 📝 INSTRUCTIONS 5.6.2: Verify in BigQuery

Run this query in BigQuery to confirm the test recruiter was created:

```sql
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
WHERE name LIKE '%Test%Apps Script%'
ORDER BY created_at DESC
LIMIT 5;
```

### 📝 INSTRUCTIONS 5.6.3: Clean Up Test Data

```sql
-- Delete test recruiter
DELETE FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
WHERE name LIKE '%Test%Apps Script%';
```

### ✅ VERIFICATION 5.6

Phase 5 is complete when:
- [ ] Apps Script deployed successfully
- [ ] GET request returns success
- [ ] POST test_connection returns success
- [ ] Chrome Extension configured with Apps Script URL
- [ ] Test recruiter creation works
- [ ] Test data visible in BigQuery

---

## 📝 Quick Reference: Apps Script vs Cloud Functions

| Feature | Cloud Functions | Apps Script Web App |
|---------|-----------------|---------------------|
| **Permissions needed** | `cloudfunctions.developer` | None (your Google account) |
| **Cold start latency** | ~100ms | ~500ms |
| **Execution limit** | 9 minutes | 6 minutes |
| **BigQuery access** | Via client library | Via Advanced Service |
| **URL format** | `*.cloudfunctions.net/*` | `script.google.com/macros/s/*/exec` |
| **Authentication** | IAM or allow-unauth | Anyone with URL |

---

## 📝 Troubleshooting Apps Script

### Common Issues

| Issue | Solution |
|-------|----------|
| "Script function not found" | Ensure `doGet` and `doPost` functions exist |
| "BigQuery is not defined" | Add BigQuery in Services panel |
| "Permission denied" | Re-authorize the script |
| "Exceeded execution time" | Optimize queries or batch smaller |
| Changes not reflected | Create a **new deployment** (don't edit existing) |

### Creating a New Deployment After Code Changes

When you update the code:
1. Click **Deploy** → **Manage deployments**
2. Click the pencil icon ✏️ on your deployment
3. Change version to **New version**
4. Click **Deploy**

Or create a completely new deployment (URL will change).

---

**Phase 5 Complete!** Your Apps Script Web App is now ready to receive data from the Chrome Extension.

---

### PART 5: Update Phase 6 References

In Phase 6 (Chrome Extension Integration), find and replace any references to Cloud Functions:

**Find:**
```
https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync
```

**Replace with:**
```
YOUR_APPS_SCRIPT_WEB_APP_URL (from Phase 5)
```

Also update any comments or descriptions that mention "Cloud Function" to say "Apps Script Web App".

---

### PART 6: Update Verification Script

Find the "Cloud Function Verification Commands" section and update:

**Change:**
```bash
# Verify savvy-pirate-sync is deployed and accessible
curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync \
```

**To:**
```bash
# Verify Apps Script Web App is deployed and accessible
curl -X POST "YOUR_APPS_SCRIPT_WEB_APP_URL" \
  -H "Content-Type: application/json" \
  -d '{"action": "test_connection", "data": {}}'

# Expected response: {"success":true,"message":"Connected to BigQuery",...}
```

---

### PART 7: Update Implementation Checklist

Find the "Phase 5" checklist section and update:

**Change:**
```markdown
## Phase 5: Cloud Function
- [ ] savvy-pirate-sync deployed
- [ ] Test connection successful
- [ ] Chrome Extension configured with URL
```

**To:**
```markdown
## Phase 5: Apps Script Web App
- [ ] Apps Script project created
- [ ] BigQuery Advanced Service enabled
- [ ] Code.gs contains sync functions
- [ ] Web app deployed with "Anyone" access
- [ ] Web app URL saved to config
- [ ] GET request returns success JSON
- [ ] POST test_connection returns success
- [ ] Chrome Extension configured with Apps Script URL
- [ ] Test profile sync works
```

---

### PART 8: Update Version Number

Update document version:

**Change:**
```
**Version:** 4.4
```

**To:**
```
**Version:** 4.5 (Apps Script Edition - No GCP Admin Required)
```

---

## PROMPT END

---

## Summary of Changes

| Section | Change |
|---------|--------|
| Executive Summary | Phase 5 now says "Apps Script Web App" |
| Configuration Constants | Cloud Function URL → Apps Script URL |
| Architecture Diagram | Updated to show Apps Script |
| **Phase 5** | **Completely replaced** with Apps Script deployment |
| Phase 6 | URL references updated |
| Verification Script | Updated for Apps Script |
| Checklist | Updated for Apps Script steps |
| Version | 4.4 → 4.5 |

## What You Get

```
Chrome Extension
      │
      │ HTTP POST
      ▼
Apps Script Web App ──────────► BigQuery
(script.google.com)             (savvy_pirate dataset)
      │
      │ No GCP permissions needed!
      │ Deploy it yourself in 5 minutes
      ▼
Same functionality as Cloud Functions
```
