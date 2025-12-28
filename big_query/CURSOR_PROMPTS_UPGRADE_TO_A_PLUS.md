# 🏴‍☠️ Cursor.ai Prompts: Upgrade Implementation Guide to A+

## Overview

Execute these prompts **in order** in Cursor.ai to transform `SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md` from a B (81/100) to an A+ (95+/100).

**Target File:** `C:\Users\russe\automated_scraper\big_query\SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md`

**Pre-requisite:** Open the file in Cursor before running these prompts.

---

# 📋 PROMPT SEQUENCE

---

## PROMPT 1: Add Phase 0 - Environment Setup (CRITICAL)

```
I need you to add a new PHASE 0 to this document BEFORE Phase 1. This phase handles 
environment setup that the current document assumes is already done.

INSERT the following new section immediately after the "## 🎯 Pre-Implementation Checklist" 
section and BEFORE "## 📂 Dataset Structure":

---

# PHASE 0: Environment & MCP Configuration

## ⚠️ CRITICAL: Complete This Phase Before Any Other Steps

This phase ensures your environment is properly configured for agentic execution.
Skipping this phase will cause failures in Phase 1.

## Step 0.1: Verify Cursor.ai MCP BigQuery Connection

### 🤖 CURSOR PROMPT 0.1

"""
Before we begin, I need to verify my MCP (Model Context Protocol) connection to BigQuery.

Please help me confirm:
1. Do I have access to BigQuery MCP tools? (list any tools containing "bigquery", "bq", or "sql")
2. Can I connect to project: savvy-gtm-analytics?

If MCP is not configured, I'll need help setting it up.
"""

### 📝 Expected MCP Tools Available

If MCP BigQuery is configured, you should see tools like:
- `mcp_bigquery_query` or `bigquery_run_query`
- `mcp_bigquery_list_tables` or `bigquery_get_schema`
- `mcp_bigquery_get_table_info`

### ❌ IF MCP NOT AVAILABLE

If Cursor doesn't have BigQuery MCP access, you have two options:

**Option A: Configure MCP BigQuery Server**

1. Install the MCP BigQuery server:
   ```bash
   npm install -g @anthropic/mcp-server-bigquery
   ```

2. Add to your Cursor MCP config (`~/.cursor/mcp.json` or Settings → MCP):
   ```json
   {
     "mcpServers": {
       "bigquery": {
         "command": "mcp-server-bigquery",
         "args": ["--project", "savvy-gtm-analytics"],
         "env": {
           "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/your/service-account-key.json"
         }
       }
     }
   }
   ```

3. Restart Cursor

**Option B: Use BigQuery Console Fallback**

If MCP setup is too complex, you can:
1. Copy each SQL snippet from this document
2. Paste into BigQuery Console (https://console.cloud.google.com/bigquery)
3. Execute manually
4. Report results back to Cursor

### ✅ VERIFICATION 0.1

Run this test query via MCP or BigQuery Console:

```sql
SELECT 1 as test, CURRENT_TIMESTAMP() as timestamp;
```

Expected: Returns one row with test=1 and current timestamp.

---

## Step 0.2: Verify GCP Authentication

### 🤖 CURSOR PROMPT 0.2

"""
Verify I have proper GCP authentication by:
1. Checking if gcloud CLI is installed
2. Verifying active account
3. Confirming project is set correctly
"""

### 📝 CODE SNIPPET 0.2.1: Check GCloud Status

```bash
# Check gcloud installation
gcloud --version

# Check active account
gcloud auth list

# Check current project
gcloud config get-value project

# If project is wrong, set it:
gcloud config set project savvy-gtm-analytics
```

### 📝 CODE SNIPPET 0.2.2: Authenticate if Needed

```bash
# For user account (interactive):
gcloud auth login
gcloud auth application-default login

# Set project:
gcloud config set project savvy-gtm-analytics
```

### ✅ VERIFICATION 0.2

```bash
# This should return your project info:
gcloud projects describe savvy-gtm-analytics
```

---

## Step 0.3: Verify BigQuery Permissions

### 🤖 CURSOR PROMPT 0.3

"""
Test that I can actually create and query BigQuery resources by running
a simple CREATE/DROP test in the target project.
"""

### 📝 CODE SNIPPET 0.3.1: Permission Test

```sql
-- Test 1: Can we create a temporary table?
CREATE OR REPLACE TABLE `savvy-gtm-analytics.savvy_pirate._permission_test` (
  id STRING,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- Test 2: Can we insert data?
INSERT INTO `savvy-gtm-analytics.savvy_pirate._permission_test` (id)
VALUES ('test_' || CAST(CURRENT_TIMESTAMP() AS STRING));

-- Test 3: Can we read it back?
SELECT * FROM `savvy-gtm-analytics.savvy_pirate._permission_test`;

-- Test 4: Clean up
DROP TABLE `savvy-gtm-analytics.savvy_pirate._permission_test`;
```

### ❌ IF PERMISSION ERRORS

| Error | Cause | Fix |
|-------|-------|-----|
| "Access Denied: Dataset savvy_pirate" | Dataset doesn't exist yet | This is OK - Phase 1 creates it |
| "Access Denied: Project savvy-gtm-analytics" | No project access | Ask project owner to grant BigQuery Admin role |
| "User does not have permission" | Missing IAM role | Need roles/bigquery.dataEditor and roles/bigquery.jobUser |

### ✅ VERIFICATION 0.3

If all 4 test queries succeeded, you're ready to proceed to Phase 1.

---

## Step 0.4: Document Your Environment (For Debugging)

### 🤖 CURSOR PROMPT 0.4

"""
Create a quick environment snapshot so we can debug issues later.
Record the output of these commands.
"""

### 📝 CODE SNIPPET 0.4.1: Environment Snapshot

```bash
echo "=== ENVIRONMENT SNAPSHOT ==="
echo "Date: $(date)"
echo ""
echo "=== GCloud ===" 
gcloud --version | head -1
gcloud config get-value account
gcloud config get-value project
echo ""
echo "=== Node ===" 
node --version
npm --version
echo ""
echo "=== BigQuery Test ===" 
bq query --use_legacy_sql=false "SELECT 'Connection OK' as status"
```

Save this output somewhere - if any later step fails, this helps diagnose why.

---

### ✅ PHASE 0 COMPLETE CHECKLIST

Before proceeding to Phase 1, confirm:

- [ ] MCP BigQuery connection works OR you have BigQuery Console access
- [ ] GCloud CLI is authenticated to correct project
- [ ] You have BigQuery create/insert/delete permissions
- [ ] Environment snapshot saved for debugging

**If any checkbox is unchecked, DO NOT PROCEED. Fix the issue first.**

---

"""

After inserting this, the document should now have PHASE 0 before PHASE 1.
```

---

## PROMPT 2: Add Error Recovery Blocks to Phase 1

```
I need you to add error recovery blocks after EVERY verification step in Phase 1.

Find each "### ✅ VERIFICATION" section in PHASE 1 and add an error recovery block 
immediately after it.

Here's the pattern to follow. Add this AFTER "### ✅ VERIFICATION 1.1":

---

### ❌ ERROR RECOVERY 1.1

If table creation failed:

| Error Message | Cause | Recovery Action |
|--------------|-------|-----------------|
| "Dataset savvy_pirate does not exist" | Step 1.1.1 failed | Re-run CREATE SCHEMA statement |
| "Already exists: Table" | Table was created before | This is OK - proceed to next step |
| "Access Denied" | Insufficient permissions | Go back to Phase 0, Step 0.3 |
| "Syntax error" | Typo in SQL | Check for missing backticks or commas |

**Rollback Commands (if needed):**
```sql
-- Drop all Phase 1 tables to start fresh:
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.scrape_runs`;
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.connections`;
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.advisors`;
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.searches`;
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.recruiters`;
DROP SCHEMA IF EXISTS `savvy-gtm-analytics.savvy_pirate`;
```

**Then re-run Phase 1 from Step 1.1.1**

---

Add similar ERROR RECOVERY blocks after:
- VERIFICATION 1.2 (analysis tables)
- VERIFICATION 1.3 (helper functions)
- VERIFICATION 1.4 (views)
- VERIFICATION 1.5 (seed data)

For each, include:
1. Common error messages and their causes
2. Specific rollback/cleanup SQL
3. Instructions on how to retry

The format should match the example above.
```

---

## PROMPT 3: Make Step 2.1 a Blocking Human Gate (CRITICAL)

```
Phase 2 Step 2.1 explores the Salesforce schema, but then Step 2.2 uses hard-coded
column names that may be WRONG. This causes silent failures.

Find "## Step 2.1: Explore Salesforce Data Structure" and completely replace
Steps 2.1 and 2.2 with this improved version that requires human confirmation:

---

## Step 2.1: Explore Salesforce Data Structure

### 🤖 CURSOR PROMPT 2.1

"""
Use MCP to explore the Salesforce Lead and Opportunity tables in BigQuery.
I need to discover the ACTUAL column names for:
- Name / Full Name
- LinkedIn URL (likely a custom field ending in __c)
- Status / Stage
- Owner
- Disposition / Closed Lost Reason

Run these queries and report the results.
"""

### 📝 CODE SNIPPET 2.1.1: Discover Lead Schema

```sql
-- Get ALL columns from Lead table
SELECT 
  column_name,
  data_type,
  CASE 
    WHEN LOWER(column_name) LIKE '%linkedin%' THEN '🔗 LINKEDIN CANDIDATE'
    WHEN LOWER(column_name) LIKE '%name%' THEN '👤 NAME CANDIDATE'
    WHEN LOWER(column_name) LIKE '%status%' THEN '📊 STATUS CANDIDATE'
    WHEN LOWER(column_name) LIKE '%owner%' THEN '👔 OWNER CANDIDATE'
    WHEN LOWER(column_name) LIKE '%dispos%' OR LOWER(column_name) LIKE '%closed%' OR LOWER(column_name) LIKE '%lost%' THEN '❌ DISPOSITION CANDIDATE'
    ELSE ''
  END AS likely_match
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'Lead'
ORDER BY 
  CASE WHEN likely_match != '' THEN 0 ELSE 1 END,
  ordinal_position;
```

### 📝 CODE SNIPPET 2.1.2: Discover Opportunity Schema

```sql
-- Get ALL columns from Opportunity table
SELECT 
  column_name,
  data_type,
  CASE 
    WHEN LOWER(column_name) LIKE '%linkedin%' THEN '🔗 LINKEDIN CANDIDATE'
    WHEN LOWER(column_name) LIKE '%name%' THEN '👤 NAME CANDIDATE'
    WHEN LOWER(column_name) LIKE '%stage%' THEN '📊 STAGE CANDIDATE'
    WHEN LOWER(column_name) LIKE '%owner%' THEN '👔 OWNER CANDIDATE'
    WHEN LOWER(column_name) LIKE '%closed%' OR LOWER(column_name) LIKE '%lost%' THEN '❌ CLOSED LOST CANDIDATE'
    ELSE ''
  END AS likely_match
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'Opportunity'
ORDER BY 
  CASE WHEN likely_match != '' THEN 0 ELSE 1 END,
  ordinal_position;
```

### 📝 CODE SNIPPET 2.1.3: Sample Data to Verify Column Contents

```sql
-- Sample Lead data (check what's actually in LinkedIn column)
SELECT 
  Id,
  Name,
  -- Add your discovered LinkedIn column here
  Status
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE 1=1
  -- AND LinkedIn_Column IS NOT NULL  -- Uncomment after finding column name
LIMIT 10;
```

---

## 🛑 STOP: Human Confirmation Required

### ⚠️ DO NOT PROCEED TO STEP 2.2 UNTIL YOU COMPLETE THIS FORM

Based on the schema exploration above, fill in the ACTUAL column names from YOUR Salesforce data:

**LEAD TABLE MAPPING:**
```
LinkedIn URL Column:     _________________________ (e.g., LinkedIn_Profile_URL__c)
Name Column:            _________________________ (e.g., Name or FirstName + LastName)
Status Column:          _________________________ (e.g., Status)
Owner ID Column:        _________________________ (e.g., OwnerId)
Disposition Column:     _________________________ (e.g., Disposition__c or NULL if none)
Closed Lost Reason:     _________________________ (e.g., Closed_Lost_Reason__c or NULL)
Last Activity Date:     _________________________ (e.g., LastActivityDate)
```

**OPPORTUNITY TABLE MAPPING:**
```
LinkedIn URL Column:     _________________________ (e.g., LinkedIn_Profile_URL__c or NULL)
Name Column:            _________________________ (e.g., Name)
Stage Column:           _________________________ (e.g., StageName)
Owner ID Column:        _________________________ (e.g., OwnerId)
Closed Lost Reason:     _________________________ (e.g., Closed_Lost_Reason__c or NULL)
Amount Column:          _________________________ (e.g., Amount)
Close Date Column:      _________________________ (e.g., CloseDate)
```

**USER CONFIRMATION:**
- [ ] I have verified the Lead column names above are correct
- [ ] I have verified the Opportunity column names above are correct
- [ ] I understand that incorrect column names will cause CRM matching to fail silently

**PROCEED TO STEP 2.2 ONLY AFTER CONFIRMING THE ABOVE**

---

## Step 2.2: Create CRM Matching View (Using YOUR Column Names)

### 🤖 CURSOR PROMPT 2.2

"""
Now create the CRM matching view using the CONFIRMED column names from Step 2.1.

IMPORTANT: Replace the placeholder column names in this SQL with the actual 
column names confirmed by the user above. DO NOT use the placeholders as-is.
"""

### 📝 CODE SNIPPET 2.2.1: CRM Matching View (TEMPLATE - CUSTOMIZE FIRST)

```sql
-- ================================================================
-- ⚠️ BEFORE RUNNING: Replace ALL placeholders with actual column names!
-- ================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_pirate.v_crm_matches` AS

WITH normalized_advisors AS (
  SELECT 
    id AS advisor_id,
    name AS advisor_name,
    linkedin_url AS advisor_linkedin_url,
    `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`(linkedin_url) AS norm_linkedin_id,
    `savvy-gtm-analytics.savvy_pirate.normalize_name`(name) AS norm_name,
    current_title,
    current_location,
    first_seen_at
  FROM `savvy-gtm-analytics.savvy_pirate.advisors`
),

normalized_leads AS (
  SELECT 
    Id AS lead_id,
    -- ⚠️ REPLACE with actual Name column (or CONCAT(FirstName, ' ', LastName))
    {{LEAD_NAME_COLUMN}} AS lead_name,
    -- ⚠️ REPLACE with actual LinkedIn URL column (or NULL if none)
    {{LEAD_LINKEDIN_COLUMN}} AS lead_linkedin_url,
    `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`({{LEAD_LINKEDIN_COLUMN}}) AS norm_linkedin_id,
    `savvy-gtm-analytics.savvy_pirate.normalize_name`({{LEAD_NAME_COLUMN}}) AS norm_name,
    -- ⚠️ REPLACE with actual Status column
    {{LEAD_STATUS_COLUMN}} AS lead_status,
    {{LEAD_OWNER_COLUMN}} AS lead_owner_id,
    -- ⚠️ REPLACE with actual Disposition column (or NULL)
    {{LEAD_DISPOSITION_COLUMN}} AS disposition,
    -- ⚠️ REPLACE with actual Closed Lost Reason column (or NULL)
    {{LEAD_CLOSED_LOST_COLUMN}} AS closed_lost_reason,
    {{LEAD_LAST_ACTIVITY_COLUMN}} AS last_activity_date
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
),

-- ... rest of view continues ...
-- (Keep the existing JOIN logic from the original document)
```

### ✅ VERIFICATION 2.2

After replacing placeholders, test the view:

```sql
-- Should return 0 rows (no advisors yet) but NO errors
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.v_crm_matches` LIMIT 5;
```

### ❌ ERROR RECOVERY 2.2

| Error | Cause | Fix |
|-------|-------|-----|
| "Unrecognized name: LinkedIn_Profile_URL__c" | Column doesn't exist | Go back to Step 2.1, find correct column name |
| "Cannot access field X on a value with type" | Wrong data type | Check if column needs CAST() |
| "NULL" in all linkedin_url results | Leads don't have LinkedIn data | CRM matching will use name-only matching |

---

"""

This ensures the user MUST confirm their actual Salesforce column names before the CRM
matching view is created.
```

---

## PROMPT 4: Add Chrome Extension File Context

```
The Chrome Extension integration in Phase 6 lacks context about the existing codebase.
Find "# PHASE 6: Chrome Extension Integration" and add this context section 
BEFORE "## Step 6.1":

---

## Chrome Extension Codebase Context

Before modifying the Chrome Extension, here's the relevant file structure:

```
automated_scraper/
├── manifest.json              # Extension manifest (Manifest V3)
├── background/
│   ├── service_worker.js      # Main orchestration hub - ADD BigQuery import here
│   ├── auth.js                # OAuth token management
│   ├── sheets_api.js          # Google Sheets API wrapper
│   ├── sync_queue.js          # Local queue with retry logic
│   ├── scheduler.js           # Schedule management and execution history
│   ├── notifications.js       # Zapier webhook notifications
│   └── bigquery_sync.js       # 🆕 NEW FILE - We will create this
├── content/
│   └── content.js             # LinkedIn DOM scraping
├── popup/
│   ├── popup.html             
│   ├── popup.css              
│   └── popup.js               
└── utils/
    └── constants.js           # Shared constants
```

### Key Integration Points

1. **bigquery_sync.js** - New file we'll create in `background/`
2. **service_worker.js** - We'll add import and call to BigQuery sync
3. **manifest.json** - We'll add host permission for Cloud Functions

### Existing Code Pattern

The extension uses this pattern for syncing data (from `service_worker.js`):

```javascript
// After scraping completes, profiles are synced to Google Sheets:
async function handleFinishedProfiles(profiles, sourceName, searchType) {
    // ... existing Sheets sync logic ...
    
    // ← BigQuery sync will be added HERE (after Sheets sync)
}
```

### Service Worker Import Pattern

The service worker uses ES modules. New imports go at the top:

```javascript
// Existing imports in service_worker.js:
import { getAuthToken, ensureFreshToken } from './auth.js';
import { appendToSheet, getOrCreateTab } from './sheets_api.js';
import { addToQueue, processQueue } from './sync_queue.js';
import { checkSchedules, updateExecutionRecord } from './scheduler.js';
import { notifyWebhook } from './notifications.js';

// ← New import will be added here
```

---

Now the agent has context about WHERE to add the new code.
```

---

## PROMPT 5: Add Configuration Management for Cloud Function URL

```
The Cloud Function URL is hard-coded in bigquery_sync.js, which will cause issues.
Find CODE SNIPPET 6.1.1 (BigQuery Sync Module) and modify it to use a configuration
pattern instead of hard-coded URL.

Replace the beginning of the bigquery_sync.js code with:

---

```javascript
// background/bigquery_sync.js
// Syncs scraped data to BigQuery via Cloud Function

const BQ_LOG = '[BIGQUERY]';

// ============================================================
// CONFIGURATION - Loaded from Chrome Storage
// ============================================================

// Default URL (will be overridden by stored config)
let CLOUD_FUNCTION_URL = null;

/**
 * Initialize BigQuery sync configuration
 * Call this once during service worker startup
 */
export async function initBigQueryConfig() {
    try {
        const stored = await chrome.storage.local.get(['bigquery_config']);
        if (stored.bigquery_config?.cloudFunctionUrl) {
            CLOUD_FUNCTION_URL = stored.bigquery_config.cloudFunctionUrl;
            console.log(`${BQ_LOG} ✅ Config loaded: ${CLOUD_FUNCTION_URL}`);
            return true;
        } else {
            console.warn(`${BQ_LOG} ⚠️ No Cloud Function URL configured`);
            return false;
        }
    } catch (e) {
        console.error(`${BQ_LOG} Failed to load config:`, e);
        return false;
    }
}

/**
 * Save BigQuery configuration
 * @param {Object} config - { cloudFunctionUrl: string }
 */
export async function saveBigQueryConfig(config) {
    await chrome.storage.local.set({ 
        bigquery_config: {
            cloudFunctionUrl: config.cloudFunctionUrl,
            configured_at: new Date().toISOString()
        }
    });
    CLOUD_FUNCTION_URL = config.cloudFunctionUrl;
    console.log(`${BQ_LOG} ✅ Config saved`);
}

/**
 * Check if BigQuery sync is configured
 */
export function isConfigured() {
    return !!CLOUD_FUNCTION_URL;
}

/**
 * Get current configuration
 */
export function getConfig() {
    return {
        cloudFunctionUrl: CLOUD_FUNCTION_URL,
        isConfigured: isConfigured()
    };
}

// ============================================================
// REST OF THE MODULE (unchanged)
// ============================================================

async function callCloudFunction(action, data) {
    if (!CLOUD_FUNCTION_URL) {
        throw new Error('BigQuery Cloud Function URL not configured');
    }
    
    const response = await fetch(CLOUD_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data })
    });
    
    if (!response.ok) {
        throw new Error(`Cloud Function error: ${response.status}`);
    }
    
    return response.json();
}

// ... rest of the existing code ...
```

---

Also add this setup step AFTER Phase 5 Cloud Function deployment:

---

## Step 5.2: Configure Chrome Extension with Cloud Function URL

After deploying the Cloud Function, you need to configure the Chrome Extension
to know where to send data.

### 📝 CODE SNIPPET 5.2.1: Get Your Cloud Function URL

After deployment, your URL will be:
```
https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync
```

### 📝 CODE SNIPPET 5.2.2: Configure via Extension Console

Open the service worker console (chrome://extensions → Savvy Pirate → "service worker"):

```javascript
// Paste this in service worker console to configure:
chrome.storage.local.set({
    bigquery_config: {
        cloudFunctionUrl: 'https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync',
        configured_at: new Date().toISOString()
    }
}, () => console.log('BigQuery config saved!'));
```

### 📝 CODE SNIPPET 5.2.3: Verify Configuration

```javascript
// Verify the config was saved:
chrome.storage.local.get(['bigquery_config'], (data) => {
    console.log('BigQuery config:', data.bigquery_config);
});
```

### ✅ VERIFICATION 5.2

The extension should now know where to send data. Test with:

```javascript
// In service worker console:
// (Assuming bigquery_sync.js is loaded)
const { testConnection } = await import('./bigquery_sync.js');
const result = await testConnection();
console.log('Connection test:', result);
```

---
```

---

## PROMPT 6: Add Deterministic IDs for Seed Data

```
The seed data uses GENERATE_UUID() which creates random IDs. This causes issues
if the insert needs to be re-run because you can't reference the recruiter IDs
reliably.

Find "### 📝 CODE SNIPPET 1.5.1: Insert Recruiters" and replace it with a version
that uses deterministic IDs based on the recruiter name:

---

### 📝 CODE SNIPPET 1.5.1: Insert Recruiters (Deterministic IDs)

Using deterministic IDs based on recruiter names allows:
- Re-running without creating duplicates
- Predictable recruiter_id references in searches table
- Easier debugging and data verification

```sql
-- Insert recruiters with deterministic IDs
-- ID format: rec_{md5_hash_of_lowercase_name}
INSERT INTO `savvy-gtm-analytics.savvy_pirate.recruiters` 
(id, name, company, title, frequency, output_sheet_url, is_active, created_at, updated_at)
VALUES
-- Group 1: 1st & 3rd week (16 recruiters)
(CONCAT('rec_', TO_HEX(MD5(LOWER('Louis Diamond')))), 'Louis Diamond', 'Diamond Consultants', 'CEO', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/19kTNLaDim8abDqNPclT2BLz7flSgkVL0Pl-oM828y74', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Jeff Nash')))), 'Jeff Nash', 'Bridgemark Strategies', 'CEO & Co-Founder', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1zN33DnhWAiB4owxnDn_bjYpGcw-O23aZlGQkPtu5U2I', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Jesse Papike')))), 'Jesse Papike', 'Cross-Search', 'President & Managing Partner', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1M1ligL-6Kqp4jYi46fsEbWtUx3ibM8rdxRyeMBCIpxM', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Patrick Kelly')))), 'Patrick Kelly', 'Willis Consulting', 'President', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1gzhH8o_VYjnD2bsIbW9oj9Qsl7bxmmJgNzJi6xU5Vjc', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Jon Bartick')))), 'Jon Bartick', 'StevenDouglas', 'Director, Wealth Management Search', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1-HaVM-QBaUv2aGQa9lS4-F3pX1BYwSdohHE9oY5eLyE', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Matt DuToit')))), 'Matt DuToit', 'WealthRight', 'Founder', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1534k10S3JqBP8MDCjDNUecnNC-PvxLgQFI6x7DBVeLQ', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Thor Gould')))), 'Thor Gould', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1kTRFnXJhjBV2_YLIShl0alPNFvspHzl3ucrIZkG2Jhw', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Sam Briganti')))), 'Sam Briganti', 'Successful OnBoarding', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1IPauSbctqtT_IDZq7SMXFt4jE_JTTFd-4qLuQFTaaO4', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Taylor Newman')))), 'Taylor Newman', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1X6GMt_tsdoO2bc2Az28VI6z8umOyJuUM5s2gfvHgQY8', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Kate Little')))), 'Kate Little', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1VmVeloKbzYQgTvZC9hjyaGlLzzp-Zd_vnhHjgjYJRcU', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Mina Consarino')))), 'Mina Consarino', 'Independent / Firm Unconfirmed', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1XsBb3L65EW3i2p8s4rGC7If9fogObuMddkNKTVjhX5Q', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Kaitlin Wickenheiser')))), 'Kaitlin Wickenheiser', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1wz2WniaLSYnO9nPzAwmJKVeRpbFzreTb2VOKCTKbFNo', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Kaely Ferguson')))), 'Kaely Ferguson', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1JLpNWXWpaY3GgbF-t8XBoEiw3tKGA8OEMCcMeoc50Ww', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Julianna King')))), 'Julianna King', 'Windward Recruiting', 'Director of Operations | Recruitment', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1ETjX9eKGyHESKy9N1orkhbKtKHNrRpc075uhO80tM1w', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Kristy Puckett')))), 'Kristy Puckett', 'RFG Advisory', 'Financial Advisor Advocate', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1bpPb5xbI4mbydCVJQU8AnNNyuClbP74D4f2GN-ss5xo', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Sean Lindenbaum')))), 'Sean Lindenbaum', 'Dynasty Financial Partners', 'Director, Business Development', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1-TE8PXv59pMZ5qBNy3gGVLKggqqmpqBf1oEUnLzK21c', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),

-- Group 2: 2nd & 4th week (13 recruiters)
(CONCAT('rec_', TO_HEX(MD5(LOWER('Michael Terrana')))), 'Michael Terrana', 'Terrana Group', 'President & CEO', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1kQzFIzRj17LJoCBYHqZuJwtDigXSrooUpybLbjyggwg', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Jodie Papike Sladavic')))), 'Jodie Papike Sladavic', 'Cross-Search', 'CEO & Managing Partner', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1CFoZ1khxKr3ZmFAjg5cA3mbkcmEeUmyucOoE4nXQ730', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Taylor Matthews')))), 'Taylor Matthews', 'Farther', 'Co-Founder & CEO', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1Sr6m9opYBMI_3cZCmFV3KhDg8gnRe0hZJ12UuD7usx4', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Stacey Frank')))), 'Stacey Frank', 'Elite Consulting Partners', 'Vice President', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1n1V0UkNepiQjc-uogkFbciMPUhA48U9rV3e-R8aWVtM', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Michael McGahey')))), 'Michael McGahey', 'StevenDouglas', 'Director, Wealth Management Search', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1v1e1Khwx-u8YgvJllqoqhCHrClY7PFWZZGgAZSm5HtY', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Megan Bailey')))), 'Megan Bailey', 'Farther', 'Wealth Management', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Scott Briganti')))), 'Scott Briganti', 'Successful OnBoarding', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1MdeGJtYae-rH9HUwB17AYKG3hcPVXJjpsrbahoZHOCc', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Morgan Cirotto')))), 'Morgan Cirotto', 'Farther', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1ks-IMVWfgjLQlbfGwCIhHmZPjyRdz79MB2cxnimDMUw', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Nicole Owens')))), 'Nicole Owens', 'Farther', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/14mSYDy7CcrDDQKVvpColxReawm7-NDrZJopJO69j62w', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Kylie Leone')))), 'Kylie Leone', 'Farther', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1VcEnfXYLQ56nIvK4EgupTj-LzWvXrz80-Db8WKle1sw', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Rachel Schuyler')))), 'Rachel Schuyler', 'Farther', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1IX8r76KaYwSMCXbpmCJnf0TuuoCIhChAs6DqM5TKkHU', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Frank LaRosa')))), 'Frank LaRosa', 'Elite Consulting Partners', 'CEO of Elite Consulting Partners', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1QIPvgiNwrb4ukQSD744DOHtO9kdyZchikwoR_HB5wpc', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(CONCAT('rec_', TO_HEX(MD5(LOWER('Simon Hoyle')))), 'Simon Hoyle', 'RIAChoice', 'Hybrid Advisor Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1ZKJ78cJPAqh7b7jLvo-8eUjGb7D69i1LkTH_qTp4hFA', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP());
```

**Why Deterministic IDs?**
- `rec_` prefix makes it clear this is a recruiter ID
- MD5 hash of lowercase name ensures same person = same ID
- Re-running INSERT won't create duplicates (will fail on duplicate key instead)
- Searches can reliably reference recruiter_id

---

Also update "### 📝 CODE SNIPPET 1.5.2: Generate Searches from Recruiters" to handle 
potential duplicate key errors gracefully:

---

### 📝 CODE SNIPPET 1.5.2: Generate Searches from Recruiters (Idempotent)

```sql
-- Generate searches for each recruiter
-- Uses MERGE to avoid duplicate errors on re-run
MERGE INTO `savvy-gtm-analytics.savvy_pirate.searches` AS target
USING (
  WITH job_titles AS (
    SELECT title FROM UNNEST([
      'Financial Advisor',
      'Financial Consultant', 
      'Financial Planner',
      'Investment Advisor',
      'Partner',
      'Portfolio Manager',
      'Principal',
      'Wealth Advisor',
      'Wealth Manager'
    ]) AS title
  ),
  new_searches AS (
    SELECT 
      CONCAT('srch_', TO_HEX(MD5(CONCAT(LOWER(r.name), '_', LOWER(jt.title))))) AS id,
      r.id AS recruiter_id,
      r.name AS recruiter_name,
      jt.title AS target_job_title,
      CONCAT(
        'https://www.linkedin.com/search/results/people/?connectionOf=[%22',
        r.id, '%22]&titleFreeText=%22', 
        REPLACE(jt.title, ' ', '%20'),
        '%22&origin=FACETED_SEARCH'
      ) AS linkedin_search_url
    FROM `savvy-gtm-analytics.savvy_pirate.recruiters` r
    CROSS JOIN job_titles jt
  )
  SELECT * FROM new_searches
) AS source
ON target.id = source.id
WHEN NOT MATCHED THEN
  INSERT (id, recruiter_id, recruiter_name, target_job_title, linkedin_search_url, is_active, created_at)
  VALUES (source.id, source.recruiter_id, source.recruiter_name, source.target_job_title, source.linkedin_search_url, TRUE, CURRENT_TIMESTAMP());
```

This uses MERGE instead of INSERT, making it safe to re-run without duplicates.

---
```

---

## PROMPT 7: Add Job Change Detection Feature

```
Add a new feature to track when advisors change jobs (title/company changes).
This is a strong signal that someone is actively in transition.

Add this section AFTER the "advisor_movement_alerts" table creation in Step 1.2:

---

### 📝 CODE SNIPPET 1.2.5: Job Change Tracking Table

```sql
-- ================================================================
-- TABLE: advisor_job_changes
-- Tracks when advisors change titles or companies (transition signal)
-- ================================================================
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.advisor_job_changes` (
  id STRING NOT NULL,
  advisor_id STRING NOT NULL,
  
  -- What changed
  change_type STRING NOT NULL,  -- 'title_change', 'company_change', 'both'
  
  -- Before
  previous_title STRING,
  previous_company STRING,  -- Extracted from title if available
  previous_location STRING,
  
  -- After
  new_title STRING,
  new_company STRING,
  new_location STRING,
  
  -- When
  detected_date DATE NOT NULL,
  previous_seen_date DATE,
  
  -- Analysis
  is_likely_job_change BOOL,  -- True if company changed
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

---

Also add this to the Monday Analysis Script (in Step 3.1) AFTER the movement alerts section:

---

```sql
-- ================================================================
-- STEP 5: Detect Job Changes
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.advisor_job_changes`
(id, advisor_id, change_type, previous_title, new_title, previous_location, 
 new_location, detected_date, previous_seen_date, is_likely_job_change, created_at)

WITH advisor_history AS (
  SELECT 
    a.id AS advisor_id,
    a.current_title AS new_title,
    a.current_location AS new_location,
    LAG(a.current_title) OVER (PARTITION BY a.id ORDER BY a.updated_at) AS previous_title,
    LAG(a.current_location) OVER (PARTITION BY a.id ORDER BY a.updated_at) AS previous_location,
    LAG(a.last_seen_at) OVER (PARTITION BY a.id ORDER BY a.updated_at) AS previous_seen_at,
    a.updated_at
  FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
  WHERE a.times_seen > 1  -- Must have been seen at least twice
),
changes AS (
  SELECT 
    *,
    CASE
      WHEN previous_title IS NOT NULL AND new_title != previous_title THEN TRUE
      ELSE FALSE
    END AS title_changed,
    -- Extract company from title (common pattern: "Title at Company")
    REGEXP_EXTRACT(new_title, r' at (.+)$') AS new_company,
    REGEXP_EXTRACT(previous_title, r' at (.+)$') AS previous_company
  FROM advisor_history
  WHERE previous_title IS NOT NULL
    AND new_title IS NOT NULL
    AND new_title != previous_title
    AND DATE(updated_at) = analysis_date
)
SELECT
  GENERATE_UUID() AS id,
  advisor_id,
  CASE
    WHEN new_company != previous_company AND new_company IS NOT NULL THEN 'both'
    WHEN new_title != previous_title THEN 'title_change'
    ELSE 'title_change'
  END AS change_type,
  previous_title,
  new_title,
  previous_location,
  new_location,
  analysis_date AS detected_date,
  DATE(previous_seen_at) AS previous_seen_date,
  CASE WHEN new_company != previous_company THEN TRUE ELSE FALSE END AS is_likely_job_change,
  CURRENT_TIMESTAMP() AS created_at
FROM changes;
```

---

And add an export query for job changes (in Step 4.1):

---

### 📝 CODE SNIPPET 4.1.5: Export Job Changes

```sql
-- ================================================================
-- EXPORT: Advisor Job Changes (Strong Transition Signal)
-- ================================================================

SELECT
  a.name AS `Advisor Name`,
  jc.previous_title AS `Previous Title`,
  jc.new_title AS `New Title`,
  jc.previous_location AS `Previous Location`,
  jc.new_location AS `New Location`,
  CASE WHEN jc.is_likely_job_change THEN 'Yes' ELSE 'Maybe' END AS `Likely Job Change`,
  a.linkedin_url AS `LinkedIn URL`,
  CAST(jc.detected_date AS STRING) AS `Detected Date`
  
FROM `savvy-gtm-analytics.savvy_pirate.advisor_job_changes` jc
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON jc.advisor_id = a.id
WHERE jc.detected_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY jc.is_likely_job_change DESC, a.name;
```

---
```

---

## PROMPT 8: Add Slack/Email Alert Integration (Phase 8)

```
Add a new Phase 8 for real-time alerting. Add this entire section at the end of the
document, BEFORE the "# 📋 Weekly Operations Runbook" section:

---

# PHASE 8: Real-Time Alerting (Optional)

## Overview

This phase adds proactive notifications so you don't have to wait until Monday
to learn about high-priority advisors.

**Alert Triggers:**
- "On the Move" advisor with 3+ recruiter appearances (severity = high/critical)
- CRM match with closed-lost lead/opportunity
- Advisor job change detected

## Step 8.1: Create Slack Webhook

### Prerequisites
1. Slack workspace admin access
2. Permission to create Incoming Webhooks

### 📝 Setup Instructions

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name: "Savvy Pirate Alerts"
4. Select your workspace
5. Go to "Incoming Webhooks" → Enable
6. Click "Add New Webhook to Workspace"
7. Select channel (e.g., #sales-alerts)
8. Copy the webhook URL (looks like: `https://hooks.slack.com/services/T.../B.../xxx`)

### ✅ Save Your Webhook URL

```
SLACK_WEBHOOK_URL: ________________________________
```

---

## Step 8.2: Create Alert Cloud Function

### 🤖 CURSOR PROMPT 8.2

"""
Create a Cloud Function that sends alerts to Slack when high-priority 
advisors are detected in BigQuery.
"""

### 📝 CODE SNIPPET 8.2.1: Alert Function (index.js)

Create a new folder: `cloud-functions/savvy-pirate-alerts/`

```javascript
// cloud-functions/savvy-pirate-alerts/index.js
const { BigQuery } = require('@google-cloud/bigquery');
const fetch = require('node-fetch');

const bigquery = new BigQuery();
const PROJECT_ID = 'savvy-gtm-analytics';
const DATASET_ID = 'savvy_pirate';

// ⚠️ REPLACE with your actual Slack webhook URL
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

exports.sendAlerts = async (req, res) => {
    try {
        // Get high-priority alerts from today
        const [movementAlerts] = await bigquery.query({
            query: `
                SELECT 
                    advisor_name,
                    linkedin_url,
                    recruiter_count,
                    severity,
                    ARRAY_TO_STRING(recruiter_names, ', ') as recruiters,
                    why_flagged
                FROM \`${PROJECT_ID}.${DATASET_ID}.advisor_movement_alerts\`
                WHERE analysis_date = CURRENT_DATE()
                  AND severity IN ('high', 'critical')
                  AND created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
            `
        });

        const [crmAlerts] = await bigquery.query({
            query: `
                SELECT 
                    advisor_name,
                    advisor_linkedin_url,
                    match_type,
                    lead_name,
                    lead_owner_name,
                    opportunity_name,
                    opportunity_owner_name,
                    alert_priority
                FROM \`${PROJECT_ID}.${DATASET_ID}.crm_match_results\`
                WHERE analysis_date = CURRENT_DATE()
                  AND alert_priority = 'high'
                  AND created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
            `
        });

        // Send to Slack
        const alerts = [];

        for (const alert of movementAlerts) {
            alerts.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `🚨 *ON THE MOVE*: <${alert.linkedin_url}|${alert.advisor_name}>\n` +
                          `• Severity: ${alert.severity.toUpperCase()}\n` +
                          `• Recruiters (${alert.recruiter_count}): ${alert.recruiters}\n` +
                          `• ${alert.why_flagged}`
                }
            });
        }

        for (const alert of crmAlerts) {
            const owner = alert.lead_owner_name || alert.opportunity_owner_name || 'Unknown';
            const record = alert.lead_name || alert.opportunity_name;
            alerts.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `🔥 *CRM RE-ENGAGE*: <${alert.advisor_linkedin_url}|${alert.advisor_name}>\n` +
                          `• Matched: ${alert.match_type} - ${record}\n` +
                          `• Owner: ${owner}\n` +
                          `• Priority: HIGH`
                }
            });
        }

        if (alerts.length > 0) {
            await fetch(SLACK_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blocks: [
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: `🏴‍☠️ Savvy Pirate Alerts (${alerts.length})`
                            }
                        },
                        ...alerts
                    ]
                })
            });
            
            res.json({ success: true, alertsSent: alerts.length });
        } else {
            res.json({ success: true, alertsSent: 0, message: 'No high-priority alerts' });
        }

    } catch (error) {
        console.error('Alert error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
```

### 📝 CODE SNIPPET 8.2.2: Package.json

```json
{
  "name": "savvy-pirate-alerts",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "@google-cloud/bigquery": "^7.3.0",
    "node-fetch": "^2.7.0"
  }
}
```

### 📝 CODE SNIPPET 8.2.3: Deploy Alert Function

```bash
cd cloud-functions/savvy-pirate-alerts

gcloud functions deploy savvy-pirate-alerts \
  --runtime nodejs18 \
  --trigger-http \
  --allow-unauthenticated \
  --region us-central1 \
  --project savvy-gtm-analytics \
  --set-env-vars SLACK_WEBHOOK_URL="YOUR_SLACK_WEBHOOK_URL"
```

---

## Step 8.3: Schedule Alert Function

### 📝 CODE SNIPPET 8.3.1: Create Cloud Scheduler Job

```bash
# Run alerts every Monday at 6:30 AM ET (after analysis completes)
gcloud scheduler jobs create http savvy-pirate-monday-alerts \
  --schedule="30 6 * * 1" \
  --time-zone="America/New_York" \
  --uri="https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-alerts" \
  --http-method=POST \
  --location=us-central1
```

### ✅ VERIFICATION 8.3

```bash
# Test the alert function manually
curl -X POST https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-alerts

# Check Slack channel for test message
```

---
```

---

## PROMPT 9: Update Success Metrics and Add Final Checklist

```
Find the "# 📊 Success Metrics" section near the end and replace it with an 
expanded version that includes all the new features:

---

# 📊 Success Metrics

After running for 4+ weeks, you should see:

| Metric | Expected Range | How to Check |
|--------|---------------|--------------|
| Advisors discovered per week | 50-200 | `SELECT COUNT(*) FROM advisors WHERE first_seen_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)` |
| "On the move" alerts per month | 10-30 | `SELECT COUNT(*) FROM advisor_movement_alerts WHERE analysis_date > DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)` |
| CRM matches per analysis | 5-20% of new advisors | Check `crm_match_results` vs `new_advisor_reports` counts |
| Scrape success rate | >95% | `SELECT COUNTIF(status='completed')/COUNT(*) FROM scrape_runs` |
| Job changes detected per month | 5-15 | `SELECT COUNT(*) FROM advisor_job_changes WHERE detected_date > DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)` |
| Slack alerts sent per week | 2-10 | Check Cloud Function logs |

---

# ✅ Implementation Complete Checklist

Before going to production, verify all components:

## Phase 0: Environment
- [ ] MCP BigQuery connection works
- [ ] GCloud CLI authenticated
- [ ] BigQuery permissions verified

## Phase 1: Infrastructure
- [ ] All 10 tables created
- [ ] All 4 functions created
- [ ] All 2 views created
- [ ] 29 recruiters seeded
- [ ] 261 searches seeded

## Phase 2: CRM Matching
- [ ] Salesforce column names confirmed by human
- [ ] v_crm_matches view created with correct columns
- [ ] Test query returns no errors

## Phase 3: Scheduled Analysis
- [ ] Monday analysis scheduled query created
- [ ] Timezone set to America/New_York
- [ ] Test run executed successfully

## Phase 4: Export Queries
- [ ] New Advisors export query saved
- [ ] On The Move export query saved
- [ ] CRM Matches export query saved
- [ ] Job Changes export query saved (new)

## Phase 5: Cloud Function
- [ ] savvy-pirate-sync deployed
- [ ] Test connection successful
- [ ] Chrome Extension configured with URL

## Phase 6: Chrome Extension
- [ ] bigquery_sync.js added to background/
- [ ] service_worker.js imports BigQuery sync
- [ ] manifest.json has Cloud Functions permission
- [ ] Test scrape syncs to BigQuery

## Phase 7: Verification
- [ ] End-to-end test passed
- [ ] All table counts verified

## Phase 8: Alerting (Optional)
- [ ] Slack webhook created
- [ ] savvy-pirate-alerts function deployed
- [ ] Cloud Scheduler job created
- [ ] Test alert received in Slack

---

**Document Version:** 4.0 (A+ Edition)  
**Last Updated:** December 2024  
**Maintainer:** Savvy Pirate Team

---
```

---

## PROMPT 10: Final Review and Formatting

```
Do a final review of the entire document and ensure:

1. All phase numbers are sequential (0, 1, 2, 3, 4, 5, 6, 7, 8)
2. All step numbers within phases are sequential (1.1, 1.2, 1.3, etc.)
3. All verification steps have corresponding error recovery blocks
4. All code snippets have proper syntax highlighting (sql, javascript, bash)
5. The table of contents in the Executive Summary reflects all phases
6. No orphaned references to old step numbers

Update the Executive Summary to reflect the new structure:

---

## 📋 Executive Summary

This document provides agentic prompts for Cursor.ai to build a complete LinkedIn 
scraping intelligence system that:

1. **Environment Setup (Phase 0)** - MCP configuration, GCP auth, permissions
2. **BigQuery Infrastructure (Phase 1)** - Schema, tables, functions, seed data
3. **CRM Matching (Phase 2)** - Salesforce integration with human-confirmed columns
4. **Scheduled Analysis (Phase 3)** - Monday automated analysis queries
5. **Export Queries (Phase 4)** - CSV exports for sales team
6. **Cloud Function (Phase 5)** - Data sync from Chrome Extension
7. **Chrome Extension (Phase 6)** - BigQuery integration with existing extension
8. **End-to-End Testing (Phase 7)** - Complete system verification
9. **Real-Time Alerting (Phase 8)** - Slack notifications for high-priority leads

**New in v4.0:**
- Phase 0 environment setup (was missing)
- Error recovery blocks for every step
- Human confirmation gate for Salesforce columns
- Job change detection feature
- Slack alerting integration
- Deterministic IDs for seed data
- Configuration management for Cloud Function URL

---
```

---

# 📋 EXECUTION CHECKLIST

Run these prompts in order:

| # | Prompt | Purpose | Est. Time |
|---|--------|---------|-----------|
| 1 | Add Phase 0 | Environment setup | 2 min |
| 2 | Add Error Recovery | Resilience | 3 min |
| 3 | Make Step 2.1 Blocking | Human gate for CRM | 3 min |
| 4 | Add Extension Context | Integration clarity | 1 min |
| 5 | Config Management | Remove hard-coded URL | 2 min |
| 6 | Deterministic IDs | Idempotent seed data | 2 min |
| 7 | Job Change Detection | New feature | 2 min |
| 8 | Slack Alerting | Phase 8 | 3 min |
| 9 | Update Metrics | Final checklist | 1 min |
| 10 | Final Review | Polish | 2 min |

**Total estimated time: ~20 minutes**

After all prompts are executed, the document should score **A+ (95+/100)** on both:
- Feature completeness
- Agentic executability

---

# 🎯 Post-Upgrade Verification

After running all prompts, verify the document by searching for:

1. `PHASE 0` - Should exist
2. `ERROR RECOVERY` - Should appear 10+ times
3. `Human Confirmation Required` - Should appear in Phase 2
4. `Chrome Extension Codebase Context` - Should exist
5. `initBigQueryConfig` - Should exist in bigquery_sync.js
6. `TO_HEX(MD5` - Should exist in recruiter INSERT
7. `advisor_job_changes` - Should exist as new table
8. `PHASE 8` - Should exist with Slack alerting
9. `Implementation Complete Checklist` - Should exist at end

If all 9 searches return results, the upgrade was successful! 🎉
