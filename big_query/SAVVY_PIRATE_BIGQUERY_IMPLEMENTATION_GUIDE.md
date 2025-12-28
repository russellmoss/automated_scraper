# 🏴‍☠️ Savvy Pirate BigQuery Implementation Guide

## Agentic Execution Document for Cursor.ai

**Version:** 4.5 (Apps Script Edition - No GCP Admin Required)  
**Date:** December 2024  
**Purpose:** Complete step-by-step implementation guide for building a robust LinkedIn competitive intelligence system with BigQuery, CRM matching, and advisor movement tracking.

---

## 🚦 IMPLEMENTATION PROGRESS TRACKER

**Last Updated:** December 28, 2024  
**Status:** Phase 7 Complete - System Production Ready ✅

### ✅ Completed Phases

- [x] **Phase 0: Environment & MCP Configuration** - COMPLETE
  - MCP BigQuery connection verified
  - GCP authentication confirmed
  - BigQuery permissions verified
  - Environment snapshot documented

- [x] **Phase 1: BigQuery Infrastructure Setup** - COMPLETE
  - [x] Step 1.1: Dataset and Core Tables (12 tables created)
  - [x] Step 1.2: Analysis Tables (all created)
  - [x] Step 1.3: Helper Functions (5 functions created)
  - [x] Step 1.4: Views (6 views created: v_advisors_on_move, v_crm_match_candidates, v_disappeared_connections, v_scrape_history, v_observations_with_advisors, v_advisors_with_crd)
  - [x] Step 1.5: Seed Initial Data (29 recruiters, 261 searches)
  - [x] Step 1.6: Google Sheets ↔ BigQuery Sync (code updated, not deployed)

- [x] **Phase 2: CRM Matching Infrastructure** - COMPLETE
  - [x] Salesforce column names confirmed
  - [x] v_crm_matches view created
  - [x] FINTRX CRD enrichment view created (v_advisors_with_crd)

- [x] **Phase 3: Scheduled Analysis Queries** - COMPLETE
  - [x] Monday analysis scheduled query created
  - [x] Test run executed successfully

- [x] **Phase 4: CSV Export Queries** - COMPLETE
  - [x] All 7 export queries saved in BigQuery Queries
  - [x] All queries tested and verified working
  - [x] Queries validated with MCP BigQuery

- [x] **Phase 5: Apps Script Web App** - COMPLETE
  - [x] Apps Script project created and deployed
  - [x] BigQuery Advanced Service enabled
  - [x] Web App deployed with "Anyone" access
  - [x] Connection test successful
  - [x] Chrome Extension configured with Apps Script URL
  - [x] Test profile sync verified (10/10 profiles synced, 0 errors)

- [x] **Phase 6: Chrome Extension Integration** - COMPLETE
  - [x] bigquery_sync.js added to background/
  - [x] service_worker.js imports BigQuery sync
  - [x] manifest.json has Apps Script Web App permission
  - [x] End-to-end sync verified (data flowing from extension → BigQuery)

- [x] **Phase 7: Final Verification & Testing** - COMPLETE
  - [x] End-to-end test passed
  - [x] All table counts verified
  - [x] Apps Script Web App verified
  - [x] Chrome Extension sync verified
  - [x] System status: **PRODUCTION READY** ✅

### ⏸️ Optional Phases (Not Required for Core Functionality)

**Phase 8: Real-Time Alerting** - OPTIONAL
- Slack webhook integration for high-priority alerts
- Can be added later if needed

**Phase 9: Looker Studio Dashboard** - OPTIONAL
- Multi-page dashboard for sales team
- Can be added later if needed

### 📊 Verification Status

| Component | Expected | Actual | Status |
|-----------|----------|--------|--------|
| Tables | 12 | 11 | ✅ (12th is created in Phase 2) |
| Functions | 5 | 5 | ✅ |
| Views | 6 | 6 | ✅ (all created) |
| Recruiters | 29 | 29 | ✅ |
| Searches | 261 | 261 | ✅ |

---

## 📋 Executive Summary

This document provides agentic prompts for Cursor.ai to build a complete LinkedIn scraping intelligence system that:

1. **Environment Setup (Phase 0)** - MCP configuration, GCP auth, permissions
2. **BigQuery Infrastructure (Phase 1)** - Schema, tables, functions, seed data
3. **CRM Matching (Phase 2)** - Salesforce integration with human-confirmed columns + FINTRX CRD enrichment
4. **Scheduled Analysis (Phase 3)** - Monday automated analysis queries
5. **Export Queries (Phase 4)** - CSV exports for sales team
6. **Apps Script Web App (Phase 5)** - Data sync from Chrome Extension (no Cloud Functions permissions needed)
7. **Chrome Extension (Phase 6)** - BigQuery integration with existing extension
8. **End-to-End Testing (Phase 7)** - Complete system verification
9. **Real-Time Alerting (Phase 8)** - Slack notifications for high-priority leads
10. **Looker Studio Dashboard (Phase 9)** - Unified visualization for sales team

**New in v4.5:**
- Replaced Cloud Function with Apps Script Web App (no GCP admin permissions required)
- Same functionality, zero permission barriers

**New in v4.4:**
- Point-in-time connection observations (stores every scrape permanently)
- Disappeared connections detection
- Historical scrape reconstruction
- Connection count trend analysis

**Previous versions:**
- v4.3: FINTRX CRD enrichment for registered RIA identification
- v4.0: Phase 0 environment setup, error recovery blocks, human confirmation gate, job change detection, Slack alerting, deterministic IDs, configuration management

---

## 🔧 Configuration Constants

**IMPORTANT:** These constants are used throughout this document. If you need to 
change any value, update it HERE and then find/replace throughout the document.

```
PROJECT_ID          = savvy-gtm-analytics
DATASET_ID          = savvy_pirate
REGION              = northamerica-northeast2  -- Toronto (for FINTRX cross-region views)
TIMEZONE            = America/New_York

# Apps Script Web App URL (deployed in Phase 5)
APPS_SCRIPT_WEB_APP_URL = https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec
APPS_SCRIPT_DEPLOYMENT_ID = AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx

# Legacy Cloud Function URLs (not used - kept for reference)
# CLOUD_FUNCTION_URL  = https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync
# ALERT_FUNCTION_URL  = https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-alerts

RECRUITER_COUNT     = 29
SEARCHES_PER_REC    = 9
TOTAL_SEARCHES      = 261  # Note: 29 × 9 = 261, not 262

COMMAND_CONTROL_SHEET_ID = 1AY2X6U9Hjg7b3hP3qpVM3eyHQ2fLq8pqREVj4NpGDeM
COMMAND_CONTROL_SHEET_NAME = Mapping and Schedules
```

**For Cursor.ai:** When you see these values in SQL or code, they should match exactly.
If there's a mismatch, flag it immediately.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        SAVVY PIRATE ANALYTICS PLATFORM                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐     ┌───────────────────────────────────────┐                  │
│  │   Chrome     │────▶│      Apps Script Web App             │                  │
│  │  Extension   │     │   (savvy-pirate-sync)                │                  │
│  │  (Scraping)  │     │   ⚡ No GCP permissions needed       │                  │
│  │              │     │   Actions:                           │                  │
│  │              │     │   • sync_profiles                    │                  │
│  │              │     │   • record_observations_batch  ←NEW │                  │
│  └──────────────┘     └───────────────┬───────────────────────┘                  │
│         │                             │                                          │
│         │                             ▼                                          │
│         │             ┌───────────────────────────────────────┐                  │
│         │             │          BigQuery Dataset             │                  │
│         │             │     savvy-gtm-analytics.savvy_pirate  │                  │
│         │             │                                       │                  │
│         │             │  ┌─────────────────────────────────┐  │                  │
│         │             │  │ Core Tables:                    │  │                  │
│         │             │  │  • recruiters (29)              │  │                  │
│         │             │  │  • advisors                     │  │                  │
│         │             │  │  • connections                  │  │                  │
│         │             │  │  • connection_observations ←NEW │  │                  │
│         │             │  │  • scrape_runs                  │  │                  │
│         │             │  │  • searches (261)               │  │                  │
│         │             │  └─────────────────────────────────┘  │                  │
│         │             │                                       │                  │
│         │             │  ┌─────────────────────────────────┐  │                  │
│         │             │  │ Analysis Tables:                │  │                  │
│         │             │  │  • weekly_analyses              │  │                  │
│         │             │  │  • new_advisor_reports          │  │                  │
│         │             │  │  • advisor_movement_alerts      │  │                  │
│         │             │  │  • crm_match_results            │  │                  │
│         │             │  └─────────────────────────────────┘  │                  │
│         │             │                                       │                  │
│         ▼             │  ┌─────────────────────────────────┐  │                  │
│  ┌──────────────┐     │  │ Scheduled Queries:              │  │                  │
│  │Google Sheets │     │  │  Monday 6 AM ET → Analysis      │  │                  │
│  │   (backup)   │     │  │  Monday 6:30 AM → CRM Match     │  │                  │
│  └──────────────┘     │  └─────────────────────────────────┘  │                  │
│                       └───────────────────────────────────────┘                  │
│                                       │                                          │
│         ┌─────────────────────────────┼─────────────────────────────┐            │
│         │                             │                             │            │
│         ▼                             ▼                             ▼            │
│  ┌──────────────┐          ┌──────────────────┐          ┌───────────────────┐   │
│  │ SavvyGTMData │          │   CSV Exports    │          │  Salesforce CRM   │   │
│  │    .Lead     │◀────────▶│ • new_advisors   │◀────────▶│  Lead/Opportunity │   │
│  │ .Opportunity │          │ • on_the_move    │          │     Objects       │   │
│  └──────────────┘          │ • crm_matches    │          └───────────────────┘   │
│                            └──────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 🔄 Data Flow & Advisor ID Matching Architecture

### How Advisor ID Matching Works

The system uses a **two-phase approach** to ensure `advisor_id` values are correctly linked between `advisors` and `connection_observations`:

#### Phase 1: During Scrape (Real-Time)

```
Chrome Extension → Apps Script → BigQuery
     │                │              │
     │                │              │
  Scrapes         syncProfiles()   advisors table
  profiles        (creates/updates) (UUID: abc-123...)
     │                │              │
     │                │              │
     │         Returns advisorIds[] │
     │                │              │
     │         recordObservationsBatch()
     │         (uses advisorIds directly)
     │                │              │
     └────────────────┴──────────────┘
              connection_observations
              (advisor_id = abc-123...)
```

**Step-by-step:**
1. Chrome Extension scrapes LinkedIn profiles
2. Calls Apps Script `sync_profiles` action with profile data
3. Apps Script `syncProfiles()`:
   - Normalizes LinkedIn URL to extract `linkedin_id` (slug)
   - Checks if advisor exists in `advisors` table by `linkedin_url`
   - If exists: Updates `last_seen_at`, returns existing `advisor_id` (UUID)
   - If new: Creates advisor with new UUID, returns it
   - Returns array of `advisorIds` (one per profile)
4. Chrome Extension receives `advisorIds` array
5. Calls Apps Script `record_observations_batch` with profiles + `advisorIds`
6. Apps Script `recordObservationsBatch()`:
   - Uses `advisorIds` directly if provided (preferred method)
   - Falls back to lookup by `linkedin_id` if not provided
   - Inserts rows into `connection_observations` with correct UUID `advisor_id`

#### Phase 2: Query-Time Correction (View)

**Problem:** BigQuery streaming tables have a "streaming buffer" that prevents `UPDATE` statements for ~90 minutes after the last insert. If `advisor_id` wasn't set correctly during insert, we can't immediately fix it.

**Solution:** The `v_observations_with_advisors` view performs the join **on-the-fly** during queries:

```sql
-- Instead of querying connection_observations directly:
SELECT * FROM connection_observations WHERE ...  -- ❌ May have hash IDs

-- Use the view:
SELECT * FROM v_observations_with_advisors WHERE ...  -- ✅ Always correct UUIDs
```

**How the view works:**
1. Extracts `linkedin_id` (slug) from `connection_observations.advisor_linkedin_url`
2. Joins to `advisors` table on `advisors.linkedin_id`
3. Returns `COALESCE(advisors.id, connection_observations.advisor_id)` as `advisor_id`
4. This ensures you always get the correct UUID, even if the base table has hash IDs

### When to Use Each Table/View

| Use Case | Use This | Why |
|----------|----------|-----|
| **All analysis queries** | `v_observations_with_advisors` | Always returns correct UUID `advisor_id` |
| **Export queries** | `v_observations_with_advisors` | Ensures data integrity |
| **Dashboard data sources** | `v_observations_with_advisors` | Real-time correctness |
| **Raw data inspection** | `connection_observations` | See what was actually inserted |
| **Debugging** | `connection_observations` | Check for hash IDs or NULLs |
| **Backfilling old data** | `connection_observations` | After streaming buffer flushes (~90 min) |

### Match Status Indicators

The `v_observations_with_advisors` view includes a `match_status` field:

- `✅ Matched via linkedin_id` - Successfully joined to advisors table (most common)
- `✅ Original ID (UUID)` - Base table already had correct UUID
- `⚠️ HASH ID (needs backfill)` - Base table has old hash-based ID (e.g., `adv_abc123...`)
- `⚠️ No advisor_id (needs backfill)` - Base table has NULL `advisor_id`

**After scrapes run, most observations should show `✅ Matched via linkedin_id`.**

### Backfilling Historical Data

If you need to permanently fix `advisor_id` in the base `connection_observations` table:

1. **Wait ~90 minutes** after the last streaming insert (for buffer to flush)
2. Run the backfill script: `big_query/BACKFILL_OBSERVATIONS_ADVISOR_ID.sql`
3. This updates the base table with correct UUIDs

**Note:** The view works immediately without backfilling, so backfilling is optional for correctness but recommended for performance.

---

## 🎯 Pre-Implementation Checklist

Before starting, ensure you have:

- [ ] Google Cloud project ID: `savvy-gtm-analytics`
- [ ] BigQuery access with dataset creation permissions
- [ ] Existing Salesforce data in `SavvyGTMData.Lead` and `SavvyGTMData.Opportunity`
- [ ] Cursor.ai with MCP connection to BigQuery enabled
- [ ] Chrome Extension codebase accessible
- [ ] Cloud Functions deployment permissions

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

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Verification query returns 0 rows when rows are expected
- [ ] Any error message appears in the output
- [ ] Count doesn't match expected value

If any stop condition is triggered:
1. Check the ERROR RECOVERY section above
2. Fix the issue
3. Re-run verification
4. Only proceed when all checks pass

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

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Verification query returns 0 rows when rows are expected
- [ ] Any error message appears in the output
- [ ] Count doesn't match expected value

If any stop condition is triggered:
1. Check the ERROR RECOVERY section above
2. Fix the issue
3. Re-run verification
4. Only proceed when all checks pass

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

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Verification query returns 0 rows when rows are expected
- [ ] Any error message appears in the output
- [ ] Count doesn't match expected value

If any stop condition is triggered:
1. Check the ERROR RECOVERY section above
2. Fix the issue
3. Re-run verification
4. Only proceed when all checks pass

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

- [x] MCP BigQuery connection works OR you have BigQuery Console access ✅ COMPLETE
- [x] GCloud CLI is authenticated to correct project ✅ COMPLETE
- [x] You have BigQuery create/insert/delete permissions ✅ COMPLETE
- [x] Environment snapshot saved for debugging ✅ COMPLETE

**✅ PHASE 0 COMPLETE - All checks passed on December 28, 2024**

---

## 📂 Dataset Structure

```
savvy-gtm-analytics/
├── SavvyGTMData/                    # Existing
│   ├── Lead                          # Salesforce leads
│   └── Opportunity                   # Salesforce opportunities
│
└── savvy_pirate/                     # NEW - We're building this
    ├── recruiters                    # 29 monitored recruiters
    ├── searches                      # 261 LinkedIn search URLs
    ├── advisors                      # All discovered advisors
    ├── connections                   # Advisor ↔ Recruiter junction
    ├── scrape_runs                   # Execution history
    ├── weekly_analyses               # Analysis run logs
    ├── new_advisor_reports           # New advisors per analysis
    ├── advisor_movement_alerts       # Multi-recruiter appearances
    └── crm_match_results             # Matched with Salesforce
```

---

# PHASE 1: BigQuery Infrastructure Setup

## Step 1.1: Create Dataset and Core Tables

### 🤖 CURSOR PROMPT 1.1

```
I need you to create the BigQuery dataset and all core tables for Savvy Pirate.

PROJECT ID: savvy-gtm-analytics
DATASET: savvy_pirate

Using your MCP connection to BigQuery, execute the following SQL statements one by one.
After each statement, verify it succeeded before moving to the next.

CRITICAL: Replace YOUR_PROJECT_ID with savvy-gtm-analytics in all queries.
```

### 📝 CODE SNIPPET 1.1.1: Create Dataset

```sql
-- Execute this first
CREATE SCHEMA IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate`
OPTIONS(
  description = 'LinkedIn recruiter connection intelligence for Savvy Pirate',
  location = 'northamerica-northeast2'  -- Toronto region (for FINTRX cross-region views)
);
```

### 📝 CODE SNIPPET 1.1.2: Create Recruiters Table

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.recruiters` (
  id STRING NOT NULL,
  name STRING NOT NULL,
  linkedin_url STRING,
  company STRING,
  title STRING,
  frequency STRING NOT NULL,  -- '1st_3rd_week' or '2nd_4th_week'
  output_sheet_url STRING,
  output_sheet_id STRING,
  is_active BOOL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### 📝 CODE SNIPPET 1.1.3: Create Searches Table

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.searches` (
  id STRING NOT NULL,
  recruiter_id STRING NOT NULL,
  recruiter_name STRING NOT NULL,
  target_job_title STRING NOT NULL,
  linkedin_search_url STRING NOT NULL,
  is_active BOOL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### 📝 CODE SNIPPET 1.1.4: Create Advisors Table

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.advisors` (
  id STRING NOT NULL,
  linkedin_url STRING NOT NULL,
  linkedin_id STRING,
  name STRING NOT NULL,
  current_title STRING,
  current_location STRING,
  accreditations ARRAY<STRING>,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  times_seen INT64 DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### 📝 CODE SNIPPET 1.1.5: Create Connections Table (Junction)

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.connections` (
  id STRING NOT NULL,
  advisor_id STRING NOT NULL,
  recruiter_id STRING NOT NULL,
  first_seen_date DATE NOT NULL,
  last_seen_date DATE NOT NULL,
  search_type STRING,
  scrape_run_id STRING,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### 📝 CODE SNIPPET 1.1.12: Create Connection Observations Table

```sql
-- ================================================================
-- TABLE 12: connection_observations (Point-in-Time Scrape Storage)
-- Stores every observation from every scrape - APPEND ONLY
-- This allows reconstruction of any past scrape and detection of
-- connections that DISAPPEAR (not just appear)
-- ================================================================

CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.connection_observations` (
  -- Primary identifiers
  id STRING NOT NULL,                           -- Unique observation ID
  scrape_run_id STRING NOT NULL,                -- Links to specific scrape run
  recruiter_id STRING NOT NULL,                 -- Which recruiter's network
  advisor_id STRING NOT NULL,                   -- Which advisor was observed
  search_id STRING,                             -- Which of the 9 job title searches
  
  -- Timestamp
  observed_at TIMESTAMP NOT NULL,               -- When this observation was recorded
  
  -- Snapshot of profile at time of observation (denormalized for history)
  advisor_name STRING,
  advisor_title STRING,
  advisor_location STRING,
  advisor_linkedin_url STRING,
  
  -- Search context
  search_job_title STRING,                      -- e.g., "Financial Advisor"
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  
  -- Keys and indexes
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(observed_at)
CLUSTER BY recruiter_id, advisor_id
OPTIONS (
  description = 'Append-only log of every connection observation. Each scrape adds new rows. Never updated or deleted. Enables point-in-time reconstruction and disappearance detection.',
  labels = [("table_type", "observation_log"), ("retention", "permanent")]
);
```

### 📝 CODE SNIPPET 1.1.6: Create Scrape Runs Table

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.scrape_runs` (
  id STRING NOT NULL,
  recruiter_id STRING,
  recruiter_name STRING,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  status STRING DEFAULT 'running',
  profiles_scraped INT64 DEFAULT 0,
  new_connections_found INT64 DEFAULT 0,
  searches_completed INT64 DEFAULT 0,
  total_searches INT64 DEFAULT 9,
  error_message STRING,
  scrape_week DATE,
  week_of_month INT64,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### ✅ VERIFICATION 1.1

```
Using MCP, run this query to verify all tables were created:

SELECT table_name, creation_time
FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.TABLES`
ORDER BY creation_time;

EXPECTED OUTPUT: 12 tables (recruiters, searches, advisors, connections, connection_observations, scrape_runs, weekly_analyses, new_advisor_reports, advisor_movement_alerts, advisor_job_changes, crm_match_results)
```

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

## Step 1.2: Create Analysis Tables

### 🤖 CURSOR PROMPT 1.2

```
Continue with BigQuery table creation. Now create the analysis-related tables
that store results from weekly analysis runs.
```

### 📝 CODE SNIPPET 1.2.1: Weekly Analyses Table

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.weekly_analyses` (
  id STRING NOT NULL,
  analysis_date DATE NOT NULL,
  frequency_group STRING NOT NULL,
  current_period_start DATE,
  current_period_end DATE,
  previous_period_start DATE,
  previous_period_end DATE,
  total_new_advisors INT64 DEFAULT 0,
  total_advisors_on_move INT64 DEFAULT 0,
  total_crm_matches INT64 DEFAULT 0,
  recruiters_analyzed INT64 DEFAULT 0,
  status STRING DEFAULT 'running',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### 📝 CODE SNIPPET 1.2.2: New Advisor Reports Table

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` (
  id STRING NOT NULL,
  analysis_id STRING NOT NULL,
  analysis_date DATE NOT NULL,
  advisor_id STRING,
  advisor_name STRING,
  linkedin_url STRING,
  title STRING,
  location STRING,
  accreditations ARRAY<STRING>,
  recruiter_id STRING,
  recruiter_name STRING,
  search_type STRING,
  first_seen_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### 📝 CODE SNIPPET 1.2.3: Advisor Movement Alerts Table

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts` (
  id STRING NOT NULL,
  analysis_date DATE NOT NULL,
  advisor_id STRING NOT NULL,
  advisor_name STRING,
  linkedin_url STRING,
  title STRING,
  location STRING,
  accreditations ARRAY<STRING>,
  recruiter_count INT64 NOT NULL,
  severity STRING,
  recruiter_names ARRAY<STRING>,
  timeline_json STRING,
  first_appearance DATE,
  latest_appearance DATE,
  days_between_first_last INT64,
  why_flagged STRING,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

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

### 📝 CODE SNIPPET 1.2.4: CRM Match Results Table (NEW)

```sql
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate.crm_match_results` (
  id STRING NOT NULL,
  analysis_date DATE NOT NULL,
  
  -- Advisor info (from our scraping)
  advisor_id STRING NOT NULL,
  advisor_name STRING,
  advisor_linkedin_url STRING,
  
  -- Match type
  match_type STRING NOT NULL,  -- 'lead', 'opportunity', 'both'
  match_confidence STRING,      -- 'exact_url', 'fuzzy_name', 'partial_url'
  
  -- Lead match info (if applicable)
  lead_id STRING,
  lead_name STRING,
  lead_status STRING,
  lead_owner_name STRING,        -- SGA owner
  lead_disposition STRING,
  lead_closed_lost_reason STRING,
  lead_last_activity_date DATE,
  
  -- Opportunity match info (if applicable)
  opportunity_id STRING,
  opportunity_name STRING,
  opportunity_stage STRING,
  opportunity_owner_name STRING,  -- SGM owner
  opportunity_closed_lost_reason STRING,
  opportunity_amount FLOAT64,
  opportunity_close_date DATE,
  
  -- Movement context
  found_via STRING,              -- 'new_advisor', 'on_the_move', 'both'
  recruiter_names ARRAY<STRING>,
  first_seen_date DATE,
  
  -- Alert info
  alert_priority STRING,         -- 'high', 'medium', 'low'
  suggested_action STRING,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
```

### ✅ VERIFICATION 1.2

```
Run this query to verify all analysis tables:

SELECT table_name, 
       TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), creation_time, MINUTE) as minutes_ago
FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.TABLES`
ORDER BY creation_time DESC;

EXPECTED: 12 tables total
```

### ❌ ERROR RECOVERY 1.2

If analysis table creation failed:

| Error Message | Cause | Recovery Action |
|--------------|-------|-----------------|
| "Table already exists" | Table was created before | This is OK - proceed to next step |
| "Access Denied" | Insufficient permissions | Go back to Phase 0, Step 0.3 |
| "Syntax error" | Typo in SQL | Check for missing backticks or commas |
| "Invalid field name" | Column name typo | Review table schema and fix column names |

**Rollback Commands (if needed):**
```sql
-- Drop all analysis tables to start fresh:
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.crm_match_results`;
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`;
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.new_advisor_reports`;
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate.weekly_analyses`;
```

**Then re-run Step 1.2**

---

## Step 1.3: Create Helper Functions

### 🤖 CURSOR PROMPT 1.3

```
Create the BigQuery User-Defined Functions (UDFs) needed for the analysis logic.
These functions help determine which recruiter group to analyze based on the week.
```

### 📝 CODE SNIPPET 1.3.1: Week of Month Function

```sql
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate.get_week_of_month`(date_input DATE)
RETURNS INT64
AS (
  CAST(CEIL(EXTRACT(DAY FROM date_input) / 7.0) AS INT64)
);
```

### 📝 CODE SNIPPET 1.3.2: Active Frequency Function

```sql
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate.get_active_frequency`(date_input DATE)
RETURNS STRING
AS (
  CASE 
    WHEN `savvy-gtm-analytics.savvy_pirate.get_week_of_month`(date_input) IN (1, 3) 
    THEN '1st_3rd_week'
    ELSE '2nd_4th_week'
  END
);
```

### 📝 CODE SNIPPET 1.3.3: LinkedIn URL Normalization Function

```sql
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`(url STRING)
RETURNS STRING
AS (
  LOWER(
    REGEXP_EXTRACT(url, r'linkedin\.com/in/([^/?]+)')
  )
);
```

### 📝 CODE SNIPPET 1.3.4: Name Normalization for Matching

```sql
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate.normalize_name`(name STRING)
RETURNS STRING
AS (
  -- Remove special characters, extra spaces, convert to lowercase
  LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        TRIM(name),
        r'[^\w\s]', ''  -- Remove non-alphanumeric except spaces
      ),
      r'\s+', ' '       -- Collapse multiple spaces
    )
  )
);
```

### ✅ VERIFICATION 1.3

```
Test the functions:

SELECT 
  `savvy-gtm-analytics.savvy_pirate.get_week_of_month`(CURRENT_DATE()) as current_week,
  `savvy-gtm-analytics.savvy_pirate.get_active_frequency`(CURRENT_DATE()) as active_group,
  `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`('https://www.linkedin.com/in/john-doe-123/') as normalized_url,
  `savvy-gtm-analytics.savvy_pirate.normalize_name`('John O''Brien III, CFP®') as normalized_name;
```

### ❌ ERROR RECOVERY 1.3

If function creation failed:

| Error Message | Cause | Recovery Action |
|--------------|-------|-----------------|
| "Function already exists" | Function was created before | This is OK - proceed to next step |
| "Invalid function body" | Syntax error in function | Check SQL syntax, especially CASE statements |
| "Cannot find function" | Dependency function missing | Ensure get_week_of_month is created before get_active_frequency |
| "Access Denied" | Insufficient permissions | Go back to Phase 0, Step 0.3 |

**Rollback Commands (if needed):**
```sql
-- Drop all functions to start fresh:
DROP FUNCTION IF EXISTS `savvy-gtm-analytics.savvy_pirate.normalize_name`;
DROP FUNCTION IF EXISTS `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`;
DROP FUNCTION IF EXISTS `savvy-gtm-analytics.savvy_pirate.get_active_frequency`;
DROP FUNCTION IF EXISTS `savvy-gtm-analytics.savvy_pirate.get_week_of_month`;
```

**Then re-run Step 1.3**

---

## Step 1.4: Create Views for Analysis

### 🤖 CURSOR PROMPT 1.4

```
Create the BigQuery views that power the analysis. These views identify 
advisors appearing in multiple recruiter networks (the "on the move" detection).
```

### 📝 CODE SNIPPET 1.4.1: Advisors On The Move View

```sql
CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_pirate.v_advisors_on_move` AS
WITH recruiter_appearances AS (
  SELECT 
    a.id AS advisor_id,
    a.name AS advisor_name,
    a.linkedin_url,
    a.current_title,
    a.current_location,
    a.accreditations,
    c.recruiter_id,
    r.name AS recruiter_name,
    r.frequency AS recruiter_frequency,
    c.first_seen_date,
    c.last_seen_date,
    c.search_type
  FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
  JOIN `savvy-gtm-analytics.savvy_pirate.connections` c ON a.id = c.advisor_id
  JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE r.is_active = TRUE
),
multi_recruiter AS (
  SELECT 
    advisor_id,
    COUNT(DISTINCT recruiter_id) AS recruiter_count,
    MIN(first_seen_date) AS first_appearance,
    MAX(first_seen_date) AS latest_appearance,
    DATE_DIFF(MAX(first_seen_date), MIN(first_seen_date), DAY) AS days_spread
  FROM recruiter_appearances
  GROUP BY advisor_id
  HAVING COUNT(DISTINCT recruiter_id) >= 2
)
SELECT 
  ra.advisor_id,
  ANY_VALUE(ra.advisor_name) AS advisor_name,
  ANY_VALUE(ra.linkedin_url) AS linkedin_url,
  ANY_VALUE(ra.current_title) AS current_title,
  ANY_VALUE(ra.current_location) AS current_location,
  ANY_VALUE(ra.accreditations) AS accreditations,
  mr.recruiter_count,
  mr.first_appearance,
  mr.latest_appearance,
  mr.days_spread,
  CURRENT_DATE() AS analysis_date,
  CASE 
    WHEN mr.recruiter_count >= 4 THEN 'critical'
    WHEN mr.recruiter_count >= 3 THEN 'high'
    ELSE 'normal'
  END AS severity,
  ARRAY_AGG(DISTINCT ra.recruiter_name ORDER BY ra.recruiter_name) AS recruiter_names,
  ARRAY_AGG(
    STRUCT(
      ra.recruiter_name,
      ra.first_seen_date,
      ra.search_type
    ) ORDER BY ra.first_seen_date
  ) AS recruiter_timeline
FROM recruiter_appearances ra
JOIN multi_recruiter mr ON ra.advisor_id = mr.advisor_id
GROUP BY ra.advisor_id, mr.recruiter_count, mr.first_appearance, mr.latest_appearance, mr.days_spread
ORDER BY mr.recruiter_count DESC, mr.days_spread ASC;
```

### 📝 CODE SNIPPET 1.4.2: CRM Match Candidates View

```sql
CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_pirate.v_crm_match_candidates` AS
WITH advisor_activity AS (
  -- All advisors who are either new or on the move
  SELECT 
    a.id AS advisor_id,
    a.name AS advisor_name,
    a.linkedin_url,
    `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`(a.linkedin_url) AS normalized_linkedin_id,
    `savvy-gtm-analytics.savvy_pirate.normalize_name`(a.name) AS normalized_name,
    a.current_title,
    a.current_location,
    CASE 
      WHEN mov.advisor_id IS NOT NULL THEN 'on_the_move'
      ELSE 'new_advisor'
    END AS activity_type,
    mov.recruiter_count,
    mov.recruiter_names,
    mov.first_appearance,
    mov.severity
  FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
  LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_on_move` mov 
    ON a.id = mov.advisor_id
  WHERE a.first_seen_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
     OR mov.advisor_id IS NOT NULL
)
SELECT * FROM advisor_activity;
```

### 📝 CODE SNIPPET 1.4.4: Create Disappeared Connections View

```sql
-- ================================================================
-- VIEW: v_disappeared_connections
-- Detects advisors who were in a recruiter's network but are no longer
-- This could indicate: unfriended, privacy settings changed, or left LinkedIn
-- ================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_pirate.v_disappeared_connections` AS

WITH latest_scrapes AS (
  -- Get the two most recent scrape dates for each recruiter
  SELECT 
    recruiter_id,
    observed_date,
    ROW_NUMBER() OVER (PARTITION BY recruiter_id ORDER BY observed_date DESC) as scrape_rank
  FROM (
    SELECT DISTINCT 
      recruiter_id, 
      DATE(observed_at) as observed_date
    FROM `savvy-gtm-analytics.savvy_pirate.connection_observations`
  )
),

current_scrape AS (
  SELECT recruiter_id, observed_date as current_date
  FROM latest_scrapes
  WHERE scrape_rank = 1
),

previous_scrape AS (
  SELECT recruiter_id, observed_date as previous_date
  FROM latest_scrapes
  WHERE scrape_rank = 2
),

current_connections AS (
  SELECT DISTINCT 
    o.recruiter_id,
    o.advisor_id
  FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o
  JOIN current_scrape c ON o.recruiter_id = c.recruiter_id 
    AND DATE(o.observed_at) = c.current_date
),

previous_connections AS (
  SELECT DISTINCT 
    o.recruiter_id,
    o.advisor_id,
    o.advisor_name,
    o.advisor_title,
    o.advisor_linkedin_url
  FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o
  JOIN previous_scrape p ON o.recruiter_id = p.recruiter_id 
    AND DATE(o.observed_at) = p.previous_date
)

SELECT 
  p.recruiter_id,
  r.name as recruiter_name,
  p.advisor_id,
  p.advisor_name,
  p.advisor_title,
  p.advisor_linkedin_url,
  prev.previous_date as last_seen_date,
  curr.current_date as checked_date,
  DATE_DIFF(curr.current_date, prev.previous_date, DAY) as days_since_seen
FROM previous_connections p
LEFT JOIN current_connections c 
  ON p.recruiter_id = c.recruiter_id AND p.advisor_id = c.advisor_id
JOIN previous_scrape prev ON p.recruiter_id = prev.recruiter_id
JOIN current_scrape curr ON p.recruiter_id = curr.recruiter_id
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON p.recruiter_id = r.id
WHERE c.advisor_id IS NULL  -- Was in previous, NOT in current = disappeared
ORDER BY r.name, p.advisor_name;
```

### 📝 CODE SNIPPET 1.4.5: Create Scrape History View

```sql
-- ================================================================
-- VIEW: v_scrape_history
-- Summary of all scrapes by recruiter and date
-- Use this to see what dates are available for reconstruction
-- ================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_pirate.v_scrape_history` AS

SELECT 
  r.name as recruiter_name,
  r.id as recruiter_id,
  DATE(o.observed_at) as scrape_date,
  COUNT(DISTINCT o.advisor_id) as connections_found,
  COUNT(DISTINCT o.search_job_title) as job_titles_searched,
  MIN(o.observed_at) as scrape_started,
  MAX(o.observed_at) as scrape_ended
FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON o.recruiter_id = r.id
GROUP BY r.name, r.id, DATE(o.observed_at)
ORDER BY r.name, scrape_date DESC;
```

### 📝 CODE SNIPPET 1.4.6: Create Observations with Advisors View (CRITICAL)

```sql
-- ================================================================
-- VIEW: v_observations_with_advisors
-- ⚠️ CRITICAL: Use this view instead of connection_observations directly
-- 
-- WHY THIS VIEW EXISTS:
-- The connection_observations table receives streaming inserts from Apps Script.
-- BigQuery streaming tables have a "streaming buffer" that prevents direct UPDATEs
-- for ~90 minutes after the last insert. This means we cannot immediately update
-- advisor_id values in the base table.
--
-- SOLUTION:
-- This view dynamically joins connection_observations with advisors to provide
-- the correct advisor_id based on linkedin_id matching. It works in real-time
-- even if the base table still has hash IDs or NULL values.
--
-- WHEN TO USE:
-- ✅ ALWAYS use this view for queries that need correct advisor_id
-- ❌ Only query connection_observations directly for raw data inspection
-- ================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors` AS

SELECT
  o.id,
  -- CRITICAL: Use advisor.id if matched, else original obs.advisor_id
  -- This ensures we always get the correct UUID, not hash IDs
  COALESCE(a.id, o.advisor_id) AS advisor_id,
  o.scrape_run_id,
  o.recruiter_id,
  o.search_id,
  o.observed_at,
  o.advisor_name,
  o.advisor_title,
  o.advisor_location,
  o.advisor_linkedin_url,
  o.search_job_title,
  o.created_at,
  -- Additional matched advisor info (for verification)
  a.name AS matched_advisor_name,
  a.linkedin_id AS matched_advisor_linkedin_id,
  -- Match status indicator (for debugging)
  CASE
    WHEN a.id IS NOT NULL THEN '✅ Matched via linkedin_id'
    WHEN o.advisor_id IS NULL THEN '⚠️ No advisor_id (needs backfill)'
    WHEN STARTS_WITH(o.advisor_id, 'adv_') THEN '⚠️ HASH ID (needs backfill)'
    ELSE '✅ Original ID (UUID)'
  END AS match_status
FROM
  `savvy-gtm-analytics.savvy_pirate.connection_observations` AS o
LEFT JOIN
  `savvy-gtm-analytics.savvy_pirate.advisors` AS a
ON
  -- Robust matching using the normalized LinkedIn ID (slug)
  -- This handles URL variations (trailing slashes, http vs https, etc.)
  REPLACE(
    REPLACE(
      LOWER(REGEXP_EXTRACT(o.advisor_linkedin_url, r'linkedin\.com/in/([^/?#]+)')),
      '%c2%ae', ''  -- Remove URL-encoded special characters
    ),
    '%c2%ae', ''
  ) = a.linkedin_id;
```

**📖 How Advisor ID Matching Works:**

1. **During Scrape (Apps Script):**
   - Chrome Extension scrapes profiles and sends to Apps Script
   - Apps Script `syncProfiles()` creates/updates advisors and returns `advisorIds` array
   - Apps Script `recordObservationsBatch()` receives `advisorIds` and uses them directly
   - If `advisorIds` not provided, it attempts lookup by `linkedin_id` (slug)

2. **Why Direct Updates Don't Work:**
   - `connection_observations` receives streaming inserts via `BigQuery.Tabledata.insertAll`
   - BigQuery maintains a "streaming buffer" for ~90 minutes after last insert
   - SQL `UPDATE` statements cannot modify data in the streaming buffer
   - Error: `"UPDATE or DELETE statement over table ... would affect rows in the streaming buffer"`

3. **The View Solution:**
   - `v_observations_with_advisors` performs the join **on-the-fly** during queries
   - It matches `connection_observations.advisor_linkedin_url` → `advisors.linkedin_id`
   - Always returns correct UUID `advisor_id`, even if base table has hash IDs
   - No waiting for streaming buffer to flush

4. **When to Use Each:**
   - **Use `v_observations_with_advisors`:** All analysis queries, exports, dashboards
   - **Use `connection_observations` directly:** Only for raw data inspection or debugging

### ✅ VERIFICATION 1.4

```
Test the views (they'll return 0 rows until data is populated):

SELECT 'v_advisors_on_move' as view_name, COUNT(*) as row_count 
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_on_move`
UNION ALL
SELECT 'v_crm_match_candidates', COUNT(*) 
FROM `savvy-gtm-analytics.savvy_pirate.v_crm_match_candidates`
UNION ALL
SELECT 'v_disappeared_connections', COUNT(*) 
FROM `savvy-gtm-analytics.savvy_pirate.v_disappeared_connections`
UNION ALL
SELECT 'v_scrape_history', COUNT(*) 
FROM `savvy-gtm-analytics.savvy_pirate.v_scrape_history`
UNION ALL
SELECT 'v_observations_with_advisors', COUNT(*) 
FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`;

-- Test the advisor_id matching in v_observations_with_advisors:
SELECT 
  match_status,
  COUNT(*) as count
FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`
GROUP BY match_status;
-- Expected: Most should show "✅ Matched via linkedin_id" after scrapes run
```

### ❌ ERROR RECOVERY 1.4

If view creation failed:

| Error Message | Cause | Recovery Action |
|--------------|-------|-----------------|
| "View already exists" | View was created before | This is OK - proceed to next step |
| "Table not found" | Dependent table missing | Go back to Step 1.1 or 1.2 and create missing tables |
| "Function not found" | Dependent function missing | Go back to Step 1.3 and create missing functions |
| "Invalid SQL" | Syntax error in view | Check JOIN syntax and CTE structure |
| "Access Denied" | Insufficient permissions | Go back to Phase 0, Step 0.3 |

**Rollback Commands (if needed):**
```sql
-- Drop all views to start fresh:
DROP VIEW IF EXISTS `savvy-gtm-analytics.savvy_pirate.v_crm_match_candidates`;
DROP VIEW IF EXISTS `savvy-gtm-analytics.savvy_pirate.v_advisors_on_move`;
```

**Then re-run Step 1.4**

---

## Step 1.5: Seed Initial Data

### 🤖 CURSOR PROMPT 1.5

```
Now seed the recruiters and searches tables with the initial data from 
the Command and Control workbook. There are 29 recruiters and 261 searches.

Use the data I'm providing below. Execute as INSERT statements.
```

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

### ✅ VERIFICATION 1.5

```sql
-- Verify counts
SELECT 'recruiters' AS table_name, COUNT(*) AS row_count FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
UNION ALL
SELECT 'searches', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.searches`;

-- Expected: recruiters = 29, searches = 261 (29 × 9)

-- Verify frequency distribution
SELECT frequency, COUNT(*) as count 
FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
GROUP BY frequency;

-- Expected: 1st_3rd_week = 16, 2nd_4th_week = 13
```

### ❌ ERROR RECOVERY 1.5

If seed data insertion failed:

| Error Message | Cause | Recovery Action |
|--------------|-------|-----------------|
| "Duplicate key" | Data already inserted | This is OK - data exists, proceed to next step |
| "Invalid value" | Data type mismatch | Check that all values match column types |
| "Table not found" | Table doesn't exist | Go back to Step 1.1 and create tables |
| "Access Denied" | Insufficient permissions | Go back to Phase 0, Step 0.3 |

**Rollback Commands (if needed):**
```sql
-- Delete all seed data to start fresh:
DELETE FROM `savvy-gtm-analytics.savvy_pirate.searches`;
DELETE FROM `savvy-gtm-analytics.savvy_pirate.recruiters`;
```

**Then re-run Step 1.5**

---

## Step 1.6: Google Sheets ↔ BigQuery Sync

**✅ STATUS: Code updated, ready for deployment**
- Cloud Function `index.js` updated with `syncRecruitersFromSheets()` function
- `package.json` updated with `googleapis` dependency
- `recordObservation()` and `recordObservationsBatch()` functions added
- All actions added to switch statement
- **⚠️ BLOCKER:** Waiting on IAM permissions to deploy (see progress tracker at top of document)

### Why This Step Matters

Your Command & Control Google Sheet is the **source of truth** for:
- Which recruiters to monitor
- Their frequency groups (1st/3rd vs 2nd/4th week)
- Their output sheet URLs

BigQuery needs to stay in sync with these changes. Without this sync:
- New recruiters won't appear in weekly analysis
- Removed recruiters will still be analyzed
- Frequency changes won't be reflected in the Monday analysis

### 🤖 CURSOR PROMPT 1.6

```
Add a sync_recruiters action to the Cloud Function that:
1. Reads recruiter data from the Command & Control Google Sheet
2. Upserts recruiters to BigQuery using MERGE (idempotent)
3. Regenerates the searches table for any new recruiters
4. Marks removed recruiters as is_active = FALSE (soft delete)

This should work with the existing savvy-pirate-sync Cloud Function structure.
```

### 📝 CODE SNIPPET 1.6.1: Update Cloud Function Dependencies

In `cloud-functions/savvy-pirate-sync/package.json`, add the googleapis dependency:

```json
{
  "name": "savvy-pirate-sync",
  "version": "2.1.0",
  "description": "Cloud Function to sync Savvy Pirate data between Sheets and BigQuery",
  "main": "index.js",
  "dependencies": {
    "@google-cloud/bigquery": "^7.3.0",
    "googleapis": "^128.0.0",
    "uuid": "^9.0.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

### 📝 CODE SNIPPET 1.6.2: Add Sync Function to Cloud Function

Add these functions to `cloud-functions/savvy-pirate-sync/index.js`:

```javascript
// Add at top with other imports
const { google } = require('googleapis');

// ============================================================
// GOOGLE SHEETS → BIGQUERY SYNC
// ============================================================

/**
 * Sync recruiters from Google Sheets Command & Control to BigQuery
 * This should be called whenever recruiters are added/edited/removed in Sheets
 */
async function syncRecruitersFromSheets(data, res) {
    const { spreadsheetId, sheetName } = data;
    
    // Your Command & Control sheet ID - UPDATE THIS
    const SHEET_ID = spreadsheetId || 'YOUR_COMMAND_AND_CONTROL_SHEET_ID';
    const SHEET_NAME = sheetName || 'Mapping and Schedules';
    
    console.log(`[SYNC] Starting recruiter sync from sheet: ${SHEET_ID}`);
    
    try {
        // Authenticate with Google Sheets API using default credentials
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
        });
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Read the sheet data
        // Columns: Name, Sheet_URL, Title, Company, Day, Day of Week, Time (24hr), Frequency
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `'${SHEET_NAME}'!A:H`
        });
        
        const rows = response.data.values;
        if (!rows || rows.length < 2) {
            console.log('[SYNC] No data found in sheet');
            return res.json({ success: false, error: 'No data found in sheet' });
        }
        
        console.log(`[SYNC] Found ${rows.length - 1} rows in sheet`);
        
        // Parse recruiters from sheet (skip header row)
        const recruitersFromSheet = rows.slice(1).map(row => ({
            name: (row[0] || '').trim(),
            sheet_url: (row[1] || '').trim(),
            title: (row[2] || '').trim(),
            company: (row[3] || '').trim(),
            // Parse frequency - look for "1st" to determine group
            frequency: (row[7] || '').toLowerCase().includes('1st') ? '1st_3rd_week' : '2nd_4th_week'
        })).filter(r => r.name);  // Skip empty rows
        
        console.log(`[SYNC] Parsed ${recruitersFromSheet.length} valid recruiters`);
        
        // Get existing recruiter names from BigQuery
        const [existingRows] = await bigquery.query({
            query: `SELECT name FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` WHERE is_active = TRUE`
        });
        const existingNames = new Set(existingRows.map(r => r.name.toLowerCase()));
        const sheetNames = new Set(recruitersFromSheet.map(r => r.name.toLowerCase()));
        
        // Track stats
        let added = 0, updated = 0, deactivated = 0;
        
        // Upsert each recruiter from the sheet
        for (const rec of recruitersFromSheet) {
            // Generate deterministic ID (same as seed data)
            const id = 'rec_' + Buffer.from(rec.name.toLowerCase()).toString('hex').substring(0, 32);
            
            // Extract sheet ID from URL
            const sheetIdMatch = rec.sheet_url.match(/\/d\/([^/]+)/);
            const sheetId = sheetIdMatch ? sheetIdMatch[1] : null;
            
            const isNew = !existingNames.has(rec.name.toLowerCase());
            
            await bigquery.query({
                query: `
                    MERGE INTO \`${PROJECT_ID}.${DATASET_ID}.recruiters\` AS target
                    USING (
                        SELECT 
                            @id as id, 
                            @name as name, 
                            @company as company, 
                            @title as title, 
                            @frequency as frequency, 
                            @sheet_url as output_sheet_url,
                            @sheet_id as output_sheet_id
                    ) AS source
                    ON target.name = source.name
                    WHEN MATCHED THEN
                        UPDATE SET 
                            company = source.company,
                            title = source.title,
                            frequency = source.frequency,
                            output_sheet_url = source.output_sheet_url,
                            output_sheet_id = source.output_sheet_id,
                            is_active = TRUE,
                            updated_at = CURRENT_TIMESTAMP()
                    WHEN NOT MATCHED THEN
                        INSERT (id, name, company, title, frequency, output_sheet_url, output_sheet_id, is_active, created_at, updated_at)
                        VALUES (source.id, source.name, source.company, source.title, source.frequency, 
                                source.output_sheet_url, source.output_sheet_id, TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
                `,
                params: {
                    id: id,
                    name: rec.name,
                    company: rec.company || null,
                    title: rec.title || null,
                    frequency: rec.frequency,
                    sheet_url: rec.sheet_url || null,
                    sheet_id: sheetId
                }
            });
            
            if (isNew) added++;
            else updated++;
        }
        
        // Soft-delete recruiters that are no longer in the sheet
        for (const existingName of existingNames) {
            if (!sheetNames.has(existingName)) {
                await bigquery.query({
                    query: `
                        UPDATE \`${PROJECT_ID}.${DATASET_ID}.recruiters\`
                        SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP()
                        WHERE LOWER(name) = @name AND is_active = TRUE
                    `,
                    params: { name: existingName }
                });
                deactivated++;
                console.log(`[SYNC] Deactivated recruiter: ${existingName}`);
            }
        }
        
        // Regenerate searches for all active recruiters
        console.log('[SYNC] Regenerating searches table...');
        await bigquery.query({
            query: `
                MERGE INTO \`${PROJECT_ID}.${DATASET_ID}.searches\` AS target
                USING (
                    WITH job_titles AS (
                        SELECT title FROM UNNEST([
                            'Financial Advisor', 'Financial Consultant', 'Financial Planner',
                            'Investment Advisor', 'Partner', 'Portfolio Manager',
                            'Principal', 'Wealth Advisor', 'Wealth Manager'
                        ]) AS title
                    )
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
                        ) AS linkedin_search_url,
                        r.is_active
                    FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` r
                    CROSS JOIN job_titles jt
                ) AS source
                ON target.id = source.id
                WHEN MATCHED THEN
                    UPDATE SET 
                        is_active = source.is_active,
                        recruiter_name = source.recruiter_name
                WHEN NOT MATCHED THEN
                    INSERT (id, recruiter_id, recruiter_name, target_job_title, linkedin_search_url, is_active, created_at)
                    VALUES (source.id, source.recruiter_id, source.recruiter_name, source.target_job_title, 
                            source.linkedin_search_url, source.is_active, CURRENT_TIMESTAMP())
            `
        });
        
        // Get final counts for verification
        const [countResult] = await bigquery.query({
            query: `
                SELECT 
                    (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` WHERE is_active = TRUE) as active_recruiters,
                    (SELECT COUNT(*) FROM \`${PROJECT_ID}.${DATASET_ID}.searches\` WHERE is_active = TRUE) as active_searches
            `
        });
        
        const result = {
            success: true,
            added: added,
            updated: updated,
            deactivated: deactivated,
            total_active_recruiters: countResult[0].active_recruiters,
            total_active_searches: countResult[0].active_searches,
            message: `Sync complete: ${added} added, ${updated} updated, ${deactivated} deactivated`
        };
        
        console.log('[SYNC] Complete:', result);
        return res.json(result);
        
    } catch (error) {
        console.error('[SYNC] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Add to your main switch statement in exports.savvyPirateSync:
// case 'sync_recruiters':
//     return await syncRecruitersFromSheets(data, res);
```

### 📝 CODE SNIPPET 1.6.3: Update Main Handler

In the main `exports.savvyPirateSync` function, add the new action to the switch statement:

```javascript
// Find this switch statement in the existing Cloud Function:
switch (action) {
    case 'sync_profiles':
        return await syncProfiles(data, res);
    case 'get_or_create_recruiter':
        return await getOrCreateRecruiter(data, res);
    case 'create_scrape_run':
        return await createScrapeRun(data, res);
    case 'complete_scrape_run':
        return await completeScrapeRun(data, res);
    case 'test_connection':
        return res.json({ success: true, message: 'Connected to BigQuery', project: PROJECT_ID });
    
    // ADD THIS NEW CASE:
    case 'sync_recruiters':
        return await syncRecruitersFromSheets(data, res);
    
    default:
        return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
}
```

### 📝 CODE SNIPPET 1.6.4: Redeploy Cloud Function

After updating the code, redeploy:

```bash
cd cloud-functions/savvy-pirate-sync

# Install new dependency
npm install googleapis

# Redeploy
gcloud functions deploy savvy-pirate-sync \
  --runtime nodejs18 \
  --trigger-http \
  --allow-unauthenticated \
  --region us-central1 \
  --project savvy-gtm-analytics \
  --memory 256MB \
  --timeout 120s
```

### 📝 CODE SNIPPET 1.6.5: Grant Sheets Access to Service Account

The Cloud Function needs permission to read your Google Sheet:

```bash
# 1. Get the service account email
gcloud functions describe savvy-pirate-sync \
  --region=us-central1 \
  --format='value(serviceAccountEmail)'

# Expected output: savvy-gtm-analytics@appspot.gserviceaccount.com
```

Then in your Command & Control Google Sheet:
1. Click **Share** (top right)
2. Add the service account email: `savvy-gtm-analytics@appspot.gserviceaccount.com`
3. Set permission to **Viewer** (read-only is sufficient)
4. Click **Send**

### ✅ VERIFICATION 1.6

Test the sync function:

```bash
# Replace YOUR_SHEET_ID with your actual Command & Control sheet ID
# (found in the URL: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit)

curl -X POST https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync \
  -H "Content-Type: application/json" \
  -d '{
    "action": "sync_recruiters",
    "data": {
      "spreadsheetId": "YOUR_COMMAND_AND_CONTROL_SHEET_ID",
      "sheetName": "Mapping and Schedules"
    }
  }'

# Expected response:
# {
#   "success": true,
#   "added": 0,
#   "updated": 29,
#   "deactivated": 0,
#   "total_active_recruiters": 29,
#   "total_active_searches": 261,
#   "message": "Sync complete: 0 added, 29 updated, 0 deactivated"
# }
```

Verify in BigQuery:

```sql
-- Check recruiter counts match your sheet
SELECT 
  COUNT(*) as total_recruiters,
  COUNTIF(is_active) as active_recruiters,
  COUNTIF(NOT is_active) as inactive_recruiters
FROM `savvy-gtm-analytics.savvy_pirate.recruiters`;

-- Check frequency distribution
SELECT frequency, COUNT(*) as count
FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
WHERE is_active = TRUE
GROUP BY frequency;
-- Expected: 1st_3rd_week = 16, 2nd_4th_week = 13
```

### ⛔ STOP CONDITIONS

Do NOT proceed if:
- [ ] curl command returns error or non-200 status
- [ ] Recruiter count doesn't match your Google Sheet
- [ ] Frequency distribution is wrong

### ❌ ERROR RECOVERY 1.6

| Error | Cause | Fix |
|-------|-------|-----|
| "Permission denied" on Sheets | Service account not shared | Share the Sheet with the service account email |
| "Spreadsheet not found" | Wrong sheet ID | Check the ID in your Sheet URL |
| "Cannot read property 'values'" | Wrong sheet name | Verify sheetName matches exactly (case-sensitive) |
| "BigQuery permission denied" | IAM not configured | Run the IAM commands from Step 5.1.4 |

---

## Step 1.6.1: (Optional) Scheduled Auto-Sync

If you want the sync to run automatically every day:

### 📝 CODE SNIPPET 1.6.1.1: Create Cloud Scheduler Job

```bash
# Create a scheduled job to sync daily at midnight ET
gcloud scheduler jobs create http savvy-pirate-daily-sync \
  --schedule="0 0 * * *" \
  --time-zone="America/New_York" \
  --uri="https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-sync" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"action":"sync_recruiters","data":{"spreadsheetId":"YOUR_COMMAND_AND_CONTROL_SHEET_ID","sheetName":"Mapping and Schedules"}}' \
  --location=us-central1 \
  --project=savvy-gtm-analytics

# Verify job was created
gcloud scheduler jobs list --location=us-central1

# Test the job manually
gcloud scheduler jobs run savvy-pirate-daily-sync --location=us-central1
```

### When to Sync: Quick Reference

| Action in Google Sheets | Sync Required? | Method |
|------------------------|----------------|--------|
| Add new recruiter | ✅ Yes | Manual or wait for auto-sync |
| Remove recruiter | ✅ Yes | Manual or wait for auto-sync |
| Change frequency group | ✅ Yes | Manual or wait for auto-sync |
| Change output sheet URL | ✅ Yes | Manual or wait for auto-sync |
| Change scrape schedule/time | ❌ No | BigQuery doesn't use schedules |

---

# PHASE 2: CRM Matching Infrastructure

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

### ⚠️ VERIFY THESE PRE-FILLED VALUES MATCH YOUR SALESFORCE SCHEMA

Based on our existing Salesforce integration, here are the expected column names.
**Review and confirm these are correct for your instance before proceeding.**

**LEAD TABLE MAPPING (SavvyGTMData.Lead):**
```
LinkedIn URL Column:     LinkedIn_Profile_Apollo__c   ← VERIFIED: Uses Apollo field
Name Column:            Name                       ← Standard field
Status Column:          Status                     ← Standard field
Owner ID Column:        OwnerId                    ← Standard field
Owner Name Column:      SGA_Owner_Name__c          ← Custom field (owner name)
Disposition Column:     Disposition__c             ← Custom field
CRD Number Column:      FA_CRD__c                  ← Custom field
Last Activity Date:     LastActivityDate           ← Standard field
Full Prospect ID:       Full_Prospect_ID__c        ← Custom field (for SF links)
```

**OPPORTUNITY TABLE MAPPING (SavvyGTMData.Opportunity):**
```
LinkedIn URL Column:     LinkedIn_Profile_URL__c    ← VERIFIED: Exists in Opportunity
Name Column:            Name                       ← Standard field
Stage Column:           StageName                  ← Standard field
Owner ID Column:        OwnerId                    ← Standard field
Owner Name Column:      Opportunity_Owner_Name__c  ← Custom field (owner name)
Closed Lost Reason:     Closed_Lost_Reason__c      ← Custom field
CRD Number Column:      FA_CRD__c                  ← Custom field
Full Opportunity ID:    Full_Opportunity_ID__c     ← Custom field (for SF links)
Close Date:             CloseDate                  ← Standard field
Amount:                 Amount                     ← Standard field
```

**USER CONFIRMATION:**
- [ ] I have verified the Lead column names above match my Salesforce org
- [ ] I have verified the Opportunity column names above match my Salesforce org
- [ ] I understand that incorrect column names will cause CRM matching to fail

**If any column names are different in your org:**
1. Run the schema discovery queries in Step 2.1 to find the correct names
2. Update the column names in the mapping above
3. Then proceed to Step 2.2

**PROCEED TO STEP 2.2 ONLY AFTER CONFIRMING THE ABOVE**

---

## Step 2.2: Create CRM Matching View (Using YOUR Column Names)

### 🤖 CURSOR PROMPT 2.2

"""
Now create the CRM matching view using the CONFIRMED column names from Step 2.1.

IMPORTANT: Replace the placeholder column names in this SQL with the actual 
column names confirmed by the user above. DO NOT use the placeholders as-is.
"""

### 📝 CODE SNIPPET 2.2.1: CRM Matching View

```sql
-- ================================================================
-- CRM Matching View using confirmed Salesforce column names
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
    Name AS lead_name,
    LinkedIn_Profile_Apollo__c AS lead_linkedin_url,  -- CORRECTED: Uses Apollo field
    `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`(LinkedIn_Profile_Apollo__c) AS norm_linkedin_id,
    `savvy-gtm-analytics.savvy_pirate.normalize_name`(Name) AS norm_name,
    Status AS lead_status,
    OwnerId AS lead_owner_id,
    SGA_Owner_Name__c AS lead_owner_name,  -- Added owner name field
    Disposition__c AS disposition,
    Closed_Lost_Reason__c AS closed_lost_reason,
    LastActivityDate AS last_activity_date,
    FA_CRD__c AS lead_crd_number,
    Full_Prospect_ID__c AS full_prospect_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
),

normalized_opps AS (
  SELECT 
    Id AS opportunity_id,
    Name AS opportunity_name,
    LinkedIn_Profile_URL__c AS opp_linkedin_url,  -- VERIFIED: Exists in Opportunity
    `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`(LinkedIn_Profile_URL__c) AS norm_linkedin_id,
    `savvy-gtm-analytics.savvy_pirate.normalize_name`(Name) AS norm_name,
    StageName AS opportunity_stage,
    OwnerId AS opportunity_owner_id,
    Opportunity_Owner_Name__c AS opportunity_owner_name,  -- Added owner name field
    Closed_Lost_Reason__c AS closed_lost_reason,
    Amount AS amount,
    CloseDate AS close_date,
    FA_CRD__c AS opp_crd_number,
    Full_Opportunity_ID__c AS full_opportunity_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
),

-- Match by LinkedIn URL (highest confidence)
url_lead_matches AS (
  SELECT 
    a.advisor_id,
    a.advisor_name,
    a.advisor_linkedin_url,
    'lead' AS match_type,
    'exact_url' AS match_confidence,
    l.lead_id,
    l.lead_name,
    l.lead_status,
    l.lead_owner_id,
    l.disposition,
    l.closed_lost_reason AS lead_closed_lost_reason,
    l.last_activity_date,
    NULL AS opportunity_id,
    NULL AS opportunity_name,
    NULL AS opportunity_stage,
    NULL AS opportunity_owner_id,
    NULL AS opp_closed_lost_reason,
    NULL AS amount,
    NULL AS close_date
  FROM normalized_advisors a
  JOIN normalized_leads l 
    ON a.norm_linkedin_id = l.norm_linkedin_id
    AND a.norm_linkedin_id IS NOT NULL
),

url_opp_matches AS (
  SELECT 
    a.advisor_id,
    a.advisor_name,
    a.advisor_linkedin_url,
    'opportunity' AS match_type,
    'exact_url' AS match_confidence,
    NULL AS lead_id,
    NULL AS lead_name,
    NULL AS lead_status,
    NULL AS lead_owner_id,
    NULL AS lead_owner_name,
    NULL AS disposition,
    NULL AS lead_closed_lost_reason,
    NULL AS last_activity_date,
    o.opportunity_id,
    o.opportunity_name,
    o.opportunity_stage,
    o.opportunity_owner_id,
    o.opportunity_owner_name,
    o.closed_lost_reason AS opp_closed_lost_reason,
    o.amount,
    o.close_date
  FROM normalized_advisors a
  JOIN normalized_opps o 
    ON a.norm_linkedin_id = o.norm_linkedin_id
    AND a.norm_linkedin_id IS NOT NULL
),

-- Match by name (lower confidence) - only for advisors not matched by URL
name_lead_matches AS (
  SELECT 
    a.advisor_id,
    a.advisor_name,
    a.advisor_linkedin_url,
    'lead' AS match_type,
    'fuzzy_name' AS match_confidence,
    l.lead_id,
    l.lead_name,
    l.lead_status,
    l.lead_owner_id,
    l.disposition,
    l.closed_lost_reason AS lead_closed_lost_reason,
    l.last_activity_date,
    NULL AS opportunity_id,
    NULL AS opportunity_name,
    NULL AS opportunity_stage,
    NULL AS opportunity_owner_id,
    NULL AS opp_closed_lost_reason,
    NULL AS amount,
    NULL AS close_date
  FROM normalized_advisors a
  JOIN normalized_leads l 
    ON a.norm_name = l.norm_name
    AND a.norm_name IS NOT NULL
    AND LENGTH(a.norm_name) > 5  -- Avoid matching very short names
  WHERE a.advisor_id NOT IN (SELECT advisor_id FROM url_lead_matches)
),

name_opp_matches AS (
  SELECT 
    a.advisor_id,
    a.advisor_name,
    a.advisor_linkedin_url,
    'opportunity' AS match_type,
    'fuzzy_name' AS match_confidence,
    NULL AS lead_id,
    NULL AS lead_name,
    NULL AS lead_status,
    NULL AS lead_owner_id,
    NULL AS lead_owner_name,
    NULL AS disposition,
    NULL AS lead_closed_lost_reason,
    NULL AS last_activity_date,
    o.opportunity_id,
    o.opportunity_name,
    o.opportunity_stage,
    o.opportunity_owner_id,
    o.opportunity_owner_name,
    o.closed_lost_reason AS opp_closed_lost_reason,
    o.amount,
    o.close_date
  FROM normalized_advisors a
  JOIN normalized_opps o 
    ON a.norm_name = o.norm_name
    AND a.norm_name IS NOT NULL
    AND LENGTH(a.norm_name) > 5
  WHERE a.advisor_id NOT IN (SELECT advisor_id FROM url_opp_matches)
),

-- Combine all matches
all_matches AS (
  SELECT * FROM url_lead_matches
  UNION ALL
  SELECT * FROM url_opp_matches
  UNION ALL
  SELECT * FROM name_lead_matches
  UNION ALL
  SELECT * FROM name_opp_matches
)

SELECT 
  *,
  -- Determine alert priority
  CASE 
    WHEN match_confidence = 'exact_url' THEN 'high'
    WHEN match_confidence = 'fuzzy_name' AND lead_status IN ('Closed', 'Closed - Lost', 'Disqualified') THEN 'high'
    WHEN match_confidence = 'fuzzy_name' AND opportunity_stage LIKE '%Closed%Lost%' THEN 'high'
    ELSE 'medium'
  END AS alert_priority
FROM all_matches;
```

### ✅ VERIFICATION 2.2

Test the view:

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

## Step 2.3: FINTRX CRD Enrichment

### Why This Step Matters

FINTRX contains CRD (Central Registration Depository) numbers for ~788,000 registered investment advisors. A CRD number is definitive proof someone is a registered RIA - these are your highest-value leads.

This step enriches your advisors table by matching scraped profiles to FINTRX data to discover their CRD numbers.

### 🤖 CURSOR PROMPT 2.3

```
First, use MCP BigQuery tools to explore the FINTRX dataset and discover the actual table names and schema.

Then create a FINTRX enrichment system that:
1. Matches advisors to FINTRX ria_contacts_current by LinkedIn URL slug (primary) or exact name (secondary)
2. Extracts their CRD number (RIA_CONTACT_CRD_ID)
3. Uses CONSERVATIVE matching - prefer no match over false match
4. Creates a view that enriches advisors with CRD and basic firm info
```

### 📝 CODE SNIPPET 2.3.0: Explore FINTRX Schema (Run First)

Before creating the enrichment view, explore the FINTRX dataset structure:

```sql
-- 1. List all tables in the FINTRX dataset
SELECT table_name 
FROM `savvy-gtm-analytics.FinTrx_data_CA.INFORMATION_SCHEMA.TABLES`
ORDER BY table_name;

-- 2. Get the schema of the contacts table (likely ria_contacts_current)
SELECT column_name, data_type
FROM `savvy-gtm-analytics.FinTrx_data_CA.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'ria_contacts_current'
ORDER BY ordinal_position;

-- 3. Sample LinkedIn URL format
SELECT LINKEDIN_PROFILE_URL
FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
WHERE LINKEDIN_PROFILE_URL IS NOT NULL
LIMIT 5;
```

### 📝 CODE SNIPPET 2.3.1: Create LinkedIn Slug Extraction Function

```sql
-- Function to extract LinkedIn slug from URL
-- Handles various formats: https://linkedin.com/in/john-doe, http://www.linkedin.com/in/john-doe/, etc.
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`(url STRING)
RETURNS STRING
AS (
  LOWER(TRIM(REGEXP_EXTRACT(url, r'linkedin\.com/in/([^/?#]+)')))
);
```

### 📝 CODE SNIPPET 2.3.2: Create FINTRX Enrichment View

```sql
-- ================================================================
-- VIEW: v_advisors_with_crd
-- Enriches advisors with CRD numbers from FINTRX
-- Match Priority: 1. LinkedIn slug, 2. Exact name
-- Conservative: Only matches high-confidence records
-- ================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` AS

WITH advisor_slugs AS (
  -- Extract LinkedIn slugs from our advisors
  SELECT 
    id AS advisor_id,
    name,
    linkedin_url,
    current_title,
    current_location,
    first_seen_at,
    last_seen_at,
    times_seen,
    `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`(linkedin_url) AS advisor_slug,
    UPPER(TRIM(name)) AS advisor_name_upper
  FROM `savvy-gtm-analytics.savvy_pirate.advisors`
),

fintrx_slugs AS (
  -- Extract LinkedIn slugs from FINTRX contacts
  SELECT 
    RIA_CONTACT_CRD_ID AS crd_number,
    CONCAT(COALESCE(CONTACT_FIRST_NAME, ''), ' ', COALESCE(CONTACT_LAST_NAME, '')) AS fintrx_full_name,
    UPPER(TRIM(CONCAT(COALESCE(CONTACT_FIRST_NAME, ''), ' ', COALESCE(CONTACT_LAST_NAME, '')))) AS fintrx_name_upper,
    LINKEDIN_PROFILE_URL AS fintrx_linkedin_url,
    `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`(LINKEDIN_PROFILE_URL) AS fintrx_slug,
    PRIMARY_FIRM_NAME,
    PRIMARY_FIRM_TOTAL_AUM,
    REP_TYPE,
    PRODUCING_ADVISOR
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
  WHERE RIA_CONTACT_CRD_ID IS NOT NULL
),

-- Priority 1: Match by LinkedIn slug (most reliable)
slug_matches AS (
  SELECT 
    a.advisor_id,
    f.crd_number,
    f.fintrx_full_name,
    f.PRIMARY_FIRM_NAME,
    f.PRIMARY_FIRM_TOTAL_AUM,
    f.REP_TYPE,
    f.PRODUCING_ADVISOR,
    '1. LinkedIn Slug Match' AS match_type,
    a.advisor_slug AS matched_slug
  FROM advisor_slugs a
  INNER JOIN fintrx_slugs f
    ON a.advisor_slug = f.fintrx_slug
  WHERE a.advisor_slug IS NOT NULL 
    AND a.advisor_slug != ''
    AND LENGTH(a.advisor_slug) >= 3  -- Avoid matching very short slugs
),

-- Priority 2: Exact name match (only for those NOT matched by slug)
name_matches AS (
  SELECT 
    a.advisor_id,
    f.crd_number,
    f.fintrx_full_name,
    f.PRIMARY_FIRM_NAME,
    f.PRIMARY_FIRM_TOTAL_AUM,
    f.REP_TYPE,
    f.PRODUCING_ADVISOR,
    '2. Exact Name Match' AS match_type,
    CAST(NULL AS STRING) AS matched_slug
  FROM advisor_slugs a
  INNER JOIN fintrx_slugs f
    ON a.advisor_name_upper = f.fintrx_name_upper
  WHERE a.advisor_id NOT IN (SELECT advisor_id FROM slug_matches)
    AND a.advisor_name_upper IS NOT NULL
    AND LENGTH(a.advisor_name_upper) >= 5  -- Avoid matching very short names
    -- Additional filter: Name must have at least 2 parts (first + last)
    AND ARRAY_LENGTH(SPLIT(a.advisor_name_upper, ' ')) >= 2
),

-- Combine matches (deduplicate - prefer slug match)
all_matches AS (
  SELECT * FROM slug_matches
  UNION ALL
  SELECT * FROM name_matches
),

-- Deduplicate: If multiple FINTRX records match, take highest AUM
deduped_matches AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (
      PARTITION BY advisor_id 
      ORDER BY 
        CASE match_type 
          WHEN '1. LinkedIn Slug Match' THEN 1 
          WHEN '2. Exact Name Match' THEN 2 
          ELSE 99 
        END,
        PRIMARY_FIRM_TOTAL_AUM DESC NULLS LAST
    ) AS rn
  FROM all_matches
)

-- Final output: All advisors with CRD enrichment where available
SELECT 
  a.advisor_id,
  a.name,
  a.linkedin_url,
  a.current_title,
  a.current_location,
  a.first_seen_at,
  a.last_seen_at,
  a.times_seen,
  -- CRD enrichment fields
  m.crd_number,
  m.match_type AS crd_match_type,
  m.fintrx_full_name AS crd_matched_name,
  m.PRIMARY_FIRM_NAME AS crd_firm_name,
  m.PRIMARY_FIRM_TOTAL_AUM AS crd_firm_aum,
  m.REP_TYPE AS crd_rep_type,
  m.PRODUCING_ADVISOR AS crd_is_producing,
  -- Derived flags
  CASE WHEN m.crd_number IS NOT NULL THEN TRUE ELSE FALSE END AS is_registered_ria,
  CASE 
    WHEN m.crd_number IS NOT NULL AND m.PRODUCING_ADVISOR = TRUE THEN 'HIGH - Registered Producing Advisor'
    WHEN m.crd_number IS NOT NULL THEN 'MEDIUM - Registered RIA'
    ELSE 'NORMAL - Not in FINTRX'
  END AS lead_priority
FROM advisor_slugs a
LEFT JOIN deduped_matches m 
  ON a.advisor_id = m.advisor_id 
  AND m.rn = 1;
```

### 📝 CODE SNIPPET 2.3.3: Add CRD Column to Advisors Table (Optional)

If you want to persist CRD numbers directly in the advisors table:

```sql
-- Add crd_number column to advisors table if not exists
ALTER TABLE `savvy-gtm-analytics.savvy_pirate.advisors`
ADD COLUMN IF NOT EXISTS crd_number INT64;

-- Update advisors with CRD numbers from FINTRX
UPDATE `savvy-gtm-analytics.savvy_pirate.advisors` a
SET crd_number = (
  SELECT m.crd_number
  FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` m
  WHERE m.advisor_id = a.id
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` m
  WHERE m.advisor_id = a.id AND m.crd_number IS NOT NULL
);
```

### ✅ VERIFICATION 2.3

Test the CRD enrichment:

```sql
-- Check match statistics
SELECT 
  crd_match_type,
  is_registered_ria,
  COUNT(*) as count
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd`
GROUP BY crd_match_type, is_registered_ria
ORDER BY count DESC;

-- Sample of matched advisors
SELECT 
  name,
  linkedin_url,
  crd_number,
  crd_match_type,
  crd_firm_name,
  crd_firm_aum,
  lead_priority
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd`
WHERE is_registered_ria = TRUE
LIMIT 20;

-- Verify no duplicate matches (should return 0)
SELECT advisor_id, COUNT(*) as match_count
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd`
GROUP BY advisor_id
HAVING match_count > 1;
```

### ⛔ STOP CONDITIONS

Do NOT proceed if:
- [ ] Match statistics show unexpectedly high match rate (>80% would be suspicious)
- [ ] Sample matched records look incorrect (wrong names, wrong companies)
- [ ] Duplicate match query returns any rows

### ❌ ERROR RECOVERY 2.3

| Error | Cause | Fix |
|-------|-------|-----|
| "Table not found: ria_contacts_current" | Wrong table name | Use MCP to list tables in FinTrx_data_CA dataset |
| "Column not found: RIA_CONTACT_CRD_ID" | Schema differs | Use MCP to check column names in the contacts table |
| "Function already exists" | Function was created before | This is OK - proceed |
| Very low match rate (<5%) | LinkedIn URLs may have different formats | Check URL formats in both tables |

---

# PHASE 3: Scheduled Analysis Queries

## Step 3.1: Create Monday Analysis Procedure

### 🤖 CURSOR PROMPT 3.1

```
Create the scheduled query that runs every Monday at 6 AM ET.
This query should:
1. Determine which frequency group to analyze (1st/3rd or 2nd/4th week)
2. Find NEW advisors (seen in current 2-week period but not previous)
3. Detect "on the move" advisors (in 2+ recruiter networks)
4. Match with CRM data
5. Generate all reports

This will be set up as a BigQuery Scheduled Query.
```

### 📝 CODE SNIPPET 3.1.1: Complete Monday Analysis Script

```sql
-- ================================================================
-- SAVVY PIRATE - MONDAY WEEKLY ANALYSIS
-- ================================================================
-- Schedule: Every Monday at 06:00 AM ET (America/New_York)
-- This script performs the complete weekly analysis
-- ================================================================

-- Step 0: Declare variables
DECLARE analysis_id STRING;
DECLARE analysis_date DATE;
DECLARE active_frequency STRING;
DECLARE current_period_start DATE;
DECLARE current_period_end DATE;
DECLARE prev_period_start DATE;
DECLARE prev_period_end DATE;
DECLARE week_num INT64;

-- Initialize
SET analysis_date = CURRENT_DATE();
SET week_num = `savvy-gtm-analytics.savvy_pirate.get_week_of_month`(analysis_date);
SET active_frequency = `savvy-gtm-analytics.savvy_pirate.get_active_frequency`(analysis_date);
SET analysis_id = GENERATE_UUID();

-- Calculate date ranges (2-week windows)
SET current_period_end = DATE_SUB(analysis_date, INTERVAL 1 DAY);
SET current_period_start = DATE_SUB(current_period_end, INTERVAL 13 DAY);
SET prev_period_end = DATE_SUB(current_period_start, INTERVAL 1 DAY);
SET prev_period_start = DATE_SUB(prev_period_end, INTERVAL 13 DAY);

-- ================================================================
-- STEP 1: Log the analysis run
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
(id, analysis_date, frequency_group, current_period_start, current_period_end, 
 previous_period_start, previous_period_end, status, created_at)
VALUES
(analysis_id, analysis_date, active_frequency, current_period_start, current_period_end,
 prev_period_start, prev_period_end, 'running', CURRENT_TIMESTAMP());


-- ================================================================
-- STEP 2: Find NEW advisors
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.new_advisor_reports`
(id, analysis_id, analysis_date, advisor_id, advisor_name, linkedin_url, 
 title, location, accreditations, recruiter_id, recruiter_name, 
 search_type, first_seen_date, created_at)

WITH current_period_advisors AS (
  SELECT DISTINCT
    c.advisor_id,
    c.recruiter_id,
    c.search_type,
    c.first_seen_date
  FROM `savvy-gtm-analytics.savvy_pirate.connections` c
  JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE r.frequency = active_frequency
    AND r.is_active = TRUE
    AND c.first_seen_date BETWEEN current_period_start AND current_period_end
),
previous_period_advisors AS (
  SELECT DISTINCT c.advisor_id
  FROM `savvy-gtm-analytics.savvy_pirate.connections` c
  JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE r.frequency = active_frequency
    AND r.is_active = TRUE
    AND c.first_seen_date BETWEEN prev_period_start AND prev_period_end
),
new_advisors AS (
  SELECT *
  FROM current_period_advisors
  WHERE advisor_id NOT IN (SELECT advisor_id FROM previous_period_advisors)
)
SELECT
  GENERATE_UUID() AS id,
  analysis_id,
  analysis_date,
  a.id AS advisor_id,
  a.name AS advisor_name,
  a.linkedin_url,
  a.current_title AS title,
  a.current_location AS location,
  a.accreditations,
  r.id AS recruiter_id,
  r.name AS recruiter_name,
  na.search_type,
  na.first_seen_date,
  CURRENT_TIMESTAMP() AS created_at
FROM new_advisors na
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON na.advisor_id = a.id
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON na.recruiter_id = r.id;


-- ================================================================
-- STEP 3: Find ADVISORS ON THE MOVE
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
(id, analysis_date, advisor_id, advisor_name, linkedin_url, title, location,
 accreditations, recruiter_count, severity, recruiter_names, timeline_json,
 first_appearance, latest_appearance, days_between_first_last, why_flagged, created_at)

SELECT
  GENERATE_UUID() AS id,
  analysis_date,
  advisor_id,
  advisor_name,
  linkedin_url,
  current_title AS title,
  current_location AS location,
  accreditations,
  recruiter_count,
  severity,
  recruiter_names,
  TO_JSON_STRING(recruiter_timeline) AS timeline_json,
  first_appearance,
  latest_appearance,
  days_spread AS days_between_first_last,
  CONCAT(
    advisor_name, ' has appeared in ', CAST(recruiter_count AS STRING),
    ' different recruiters'' networks: ',
    ARRAY_TO_STRING(recruiter_names, ' → '),
    '. First seen: ', CAST(first_appearance AS STRING),
    ', Latest: ', CAST(latest_appearance AS STRING),
    ' (', CAST(days_spread AS STRING), ' days span). ',
    'This indicates active job searching behavior.'
  ) AS why_flagged,
  CURRENT_TIMESTAMP() AS created_at
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_on_move`
WHERE advisor_id NOT IN (
  SELECT advisor_id 
  FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
  WHERE analysis_date = analysis_date
);


-- ================================================================
-- STEP 4: CRM Matching
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.crm_match_results`
(id, analysis_date, advisor_id, advisor_name, advisor_linkedin_url,
 match_type, match_confidence, lead_id, lead_name, lead_status, 
 lead_owner_name, lead_disposition, lead_closed_lost_reason, lead_last_activity_date,
 opportunity_id, opportunity_name, opportunity_stage, opportunity_owner_name,
 opportunity_closed_lost_reason, opportunity_amount, opportunity_close_date,
 found_via, recruiter_names, first_seen_date, alert_priority, suggested_action, created_at)

WITH todays_advisors AS (
  -- Advisors from today's new advisor reports
  SELECT DISTINCT 
    advisor_id, 
    'new_advisor' AS source,
    ARRAY_AGG(recruiter_name) AS recruiter_names,
    MIN(first_seen_date) AS first_seen_date
  FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports`
  WHERE analysis_date = analysis_date
  GROUP BY advisor_id
  
  UNION ALL
  
  -- Advisors from today's movement alerts
  SELECT DISTINCT
    advisor_id,
    'on_the_move' AS source,
    recruiter_names,
    first_appearance AS first_seen_date
  FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
  WHERE analysis_date = analysis_date
),
combined_advisors AS (
  SELECT 
    advisor_id,
    ARRAY_TO_STRING(ARRAY_AGG(DISTINCT source), ', ') AS found_via,
    ANY_VALUE(recruiter_names) AS recruiter_names,
    MIN(first_seen_date) AS first_seen_date
  FROM todays_advisors
  GROUP BY advisor_id
),
matched AS (
  SELECT 
    ca.advisor_id,
    ca.found_via,
    ca.recruiter_names,
    ca.first_seen_date,
    m.*
  FROM combined_advisors ca
  JOIN `savvy-gtm-analytics.savvy_pirate.v_crm_matches` m 
    ON ca.advisor_id = m.advisor_id
)
SELECT
  GENERATE_UUID() AS id,
  analysis_date,
  m.advisor_id,
  m.advisor_name,
  m.advisor_linkedin_url,
  m.match_type,
  m.match_confidence,
  m.lead_id,
  m.lead_name,
  m.lead_status,
  m.lead_owner_id AS lead_owner_name,  -- TODO: Join to get actual name
  m.disposition AS lead_disposition,
  m.lead_closed_lost_reason,
  m.last_activity_date AS lead_last_activity_date,
  m.opportunity_id,
  m.opportunity_name,
  m.opportunity_stage,
  m.opportunity_owner_id AS opportunity_owner_name,  -- TODO: Join to get actual name
  m.opp_closed_lost_reason AS opportunity_closed_lost_reason,
  m.amount AS opportunity_amount,
  m.close_date AS opportunity_close_date,
  m.found_via,
  m.recruiter_names,
  m.first_seen_date,
  m.alert_priority,
  CASE
    WHEN m.match_type = 'lead' AND m.lead_status IN ('Closed - Lost', 'Disqualified') 
      THEN CONCAT('RE-ENGAGE: ', m.advisor_name, ' was previously closed (', m.lead_status, ') but is now actively looking')
    WHEN m.match_type = 'opportunity' AND m.opportunity_stage LIKE '%Closed%Lost%'
      THEN CONCAT('RE-ENGAGE: ', m.advisor_name, ' opportunity was lost but they are back on the market')
    WHEN m.match_type = 'lead' 
      THEN CONCAT('EXISTING LEAD: ', m.advisor_name, ' is in your pipeline (', m.lead_status, ') - now showing activity with recruiters')
    WHEN m.match_type = 'opportunity'
      THEN CONCAT('EXISTING OPP: ', m.advisor_name, ' has opportunity (', m.opportunity_stage, ') - now showing recruiter activity')
    ELSE 'Review for action'
  END AS suggested_action,
  CURRENT_TIMESTAMP() AS created_at
FROM matched m;


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


-- ================================================================
-- STEP 6: Update analysis record with counts
-- ================================================================
UPDATE `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
SET 
  total_new_advisors = (
    SELECT COUNT(DISTINCT advisor_id) 
    FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports`
    WHERE analysis_id = analysis_id
  ),
  total_advisors_on_move = (
    SELECT COUNT(*) 
    FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
    WHERE analysis_date = analysis_date
  ),
  total_crm_matches = (
    SELECT COUNT(*) 
    FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results`
    WHERE analysis_date = analysis_date
  ),
  recruiters_analyzed = (
    SELECT COUNT(*) 
    FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
    WHERE frequency = active_frequency AND is_active = TRUE
  ),
  status = 'completed'
WHERE id = analysis_id;


-- ================================================================
-- STEP 7: Summary output
-- ================================================================
SELECT 
  CONCAT(
    '✅ SAVVY PIRATE WEEKLY ANALYSIS COMPLETE\n',
    '==========================================\n',
    'Analysis Date: ', CAST(analysis_date AS STRING), '\n',
    'Week of Month: ', CAST(week_num AS STRING), '\n',
    'Frequency Group: ', active_frequency, '\n',
    'Period Analyzed: ', CAST(current_period_start AS STRING), ' to ', CAST(current_period_end AS STRING), '\n',
    '==========================================\n',
    'NEW ADVISORS: ', CAST((SELECT COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` WHERE analysis_id = analysis_id) AS STRING), '\n',
    'ON THE MOVE: ', CAST((SELECT COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts` WHERE analysis_date = analysis_date) AS STRING), '\n',
    'CRM MATCHES: ', CAST((SELECT COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results` WHERE analysis_date = analysis_date) AS STRING), '\n',
    '==========================================\n',
    'Reports ready for CSV export!'
  ) AS analysis_summary;
```

### ✅ VERIFICATION 3.1

```
To create the scheduled query:
1. Go to BigQuery Console → Scheduled Queries → Create
2. Paste the above script
3. Configure:
   - Name: "Savvy Pirate Weekly Analysis"
   - Schedule: Every Monday at 06:00
   - Timezone: America/New_York
   - Region: US
4. Save and enable
```

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Verification query returns 0 rows when rows are expected
- [ ] Any error message appears in the output
- [ ] Count doesn't match expected value

If any stop condition is triggered:
1. Check the ERROR RECOVERY section above
2. Fix the issue
3. Re-run verification
4. Only proceed when all checks pass

---

## Step 3.2: Connection Count Trends Analysis

### 📝 CODE SNIPPET 3.2.1: Connection Count Trends Query

```sql
-- ================================================================
-- ANALYSIS: Connection count trends over time
-- See how each recruiter's network is growing/shrinking
-- ================================================================

SELECT 
  recruiter_name,
  scrape_date,
  connections_found,
  LAG(connections_found) OVER (PARTITION BY recruiter_id ORDER BY scrape_date) as previous_count,
  connections_found - LAG(connections_found) OVER (PARTITION BY recruiter_id ORDER BY scrape_date) as net_change,
  ROUND(
    (connections_found - LAG(connections_found) OVER (PARTITION BY recruiter_id ORDER BY scrape_date)) * 100.0 
    / NULLIF(LAG(connections_found) OVER (PARTITION BY recruiter_id ORDER BY scrape_date), 0),
    1
  ) as percent_change
FROM `savvy-gtm-analytics.savvy_pirate.v_scrape_history`
ORDER BY recruiter_name, scrape_date DESC;
```

This query shows:
- How many connections each recruiter had on each scrape date
- Net change from previous scrape
- Percentage change (growth or decline)

---

# PHASE 4: CSV Export Queries

## Step 4.1: Create Export Queries

### 🤖 CURSOR PROMPT 4.1

```
Create the SQL queries that will be run manually on Mondays to export CSV files
for the sales team. These should be saved as BigQuery saved queries for easy access.
```

### 📝 CODE SNIPPET 4.1.1: Export New Advisors

```sql
-- ================================================================
-- EXPORT: NEW ADVISORS
-- Run after Monday analysis, download as CSV
-- ================================================================

SELECT
  nar.advisor_name AS `Advisor Name`,
  nar.title AS `Title`,
  nar.location AS `Location`,
  nar.linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(nar.accreditations, '; ') AS `Accreditations`,
  nar.recruiter_name AS `Found By Recruiter`,
  nar.search_type AS `Search Type`,
  CAST(nar.first_seen_date AS STRING) AS `First Seen Date`,
  -- CRD enrichment
  ea.crd_number AS `CRD Number`,
  ea.lead_priority AS `Lead Priority`,
  ea.crd_firm_name AS `Firm Name`,
  ROUND(ea.crd_firm_aum / 1000000, 1) AS `Firm AUM (Millions)`,
  CASE WHEN ea.crd_is_producing = TRUE THEN 'Yes' ELSE 'No' END AS `Is Producing Advisor`
FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` nar
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` ea
  ON nar.advisor_id = ea.advisor_id
WHERE nar.analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY 
  CASE ea.lead_priority 
    WHEN 'HIGH - Registered Producing Advisor' THEN 1
    WHEN 'MEDIUM - Registered RIA' THEN 2
    ELSE 3
  END,
  nar.first_seen_date DESC;
```

### 📝 CODE SNIPPET 4.1.2: Export Advisors On The Move

```sql
-- ================================================================
-- EXPORT: ADVISORS ON THE MOVE
-- Run after Monday analysis, download as CSV
-- ================================================================

SELECT
  advisor_name AS `Advisor Name`,
  title AS `Title`,
  location AS `Location`,
  linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(accreditations, '; ') AS `Accreditations`,
  recruiter_count AS `Number of Recruiters`,
  severity AS `Severity`,
  ARRAY_TO_STRING(recruiter_names, ' → ') AS `Recruiter Trail`,
  CAST(first_appearance AS STRING) AS `First Appearance`,
  CAST(latest_appearance AS STRING) AS `Latest Appearance`,
  days_between_first_last AS `Days Span`,
  why_flagged AS `Why Flagged`
FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY recruiter_count DESC, advisor_name;
```

### 📝 CODE SNIPPET 4.1.3: Export CRM Matches (Re-Engagement Alerts)

```sql
-- ================================================================
-- EXPORT: CRM MATCH ALERTS (Re-Engagement Opportunities)
-- Run after Monday analysis, download as CSV
-- ================================================================

SELECT
  advisor_name AS `Advisor Name`,
  advisor_linkedin_url AS `LinkedIn URL`,
  match_type AS `Match Type`,
  match_confidence AS `Match Confidence`,
  alert_priority AS `Priority`,
  
  -- Lead info (if matched)
  lead_name AS `Lead Name`,
  lead_status AS `Lead Status`,
  lead_owner_name AS `Lead Owner (SGA)`,
  lead_disposition AS `Disposition`,
  lead_closed_lost_reason AS `Lead Closed Lost Reason`,
  
  -- Opportunity info (if matched)
  opportunity_name AS `Opportunity Name`,
  opportunity_stage AS `Opportunity Stage`,
  opportunity_owner_name AS `Opportunity Owner (SGM)`,
  opportunity_closed_lost_reason AS `Opp Closed Lost Reason`,
  CAST(opportunity_amount AS STRING) AS `Opportunity Amount`,
  
  -- Context
  found_via AS `Found Via`,
  ARRAY_TO_STRING(recruiter_names, ', ') AS `Recruiters`,
  CAST(first_seen_date AS STRING) AS `First Seen in Recruiter Network`,
  suggested_action AS `Suggested Action`
  
FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY alert_priority DESC, advisor_name;
```

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

### 📝 CODE SNIPPET 4.1.6: Export - Reconstruct Past Scrape

```sql
-- ================================================================
-- EXPORT: Reconstruct a specific scrape
-- Replace the date and recruiter name to get exact point-in-time data
-- ⚠️ Uses v_observations_with_advisors to ensure correct advisor_id matching
-- ================================================================

SELECT 
  o.advisor_name AS `Name`,
  o.advisor_title AS `Title`,
  o.advisor_location AS `Location`,
  o.advisor_linkedin_url AS `LinkedIn URL`,
  o.search_job_title AS `Search Type`,
  o.observed_at AS `Observed At`,
  o.advisor_id AS `Advisor ID`,  -- Correct UUID (from view matching)
  o.match_status AS `Match Status`  -- Shows how advisor_id was determined
FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors` o
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON o.recruiter_id = r.id
WHERE r.name = 'RECRUITER_NAME_HERE'
  AND DATE(o.observed_at) = 'YYYY-MM-DD'
ORDER BY o.search_job_title, o.advisor_name;
```

### 📝 CODE SNIPPET 4.1.7: Export - Disappeared Connections

```sql
-- ================================================================
-- EXPORT: Connections that disappeared from recruiter networks
-- These people may have changed privacy settings or unfriended
-- ================================================================

SELECT 
  recruiter_name AS `Recruiter`,
  advisor_name AS `Advisor Name`,
  advisor_title AS `Last Known Title`,
  advisor_linkedin_url AS `LinkedIn URL`,
  last_seen_date AS `Last Seen`,
  checked_date AS `Checked On`,
  days_since_seen AS `Days Gone`
FROM `savvy-gtm-analytics.savvy_pirate.v_disappeared_connections`
ORDER BY recruiter_name, days_since_seen DESC;
```

### 📝 CODE SNIPPET 4.1.4: Weekly Summary Dashboard Query

```sql
-- ================================================================
-- DASHBOARD: Weekly Analysis Summary
-- ================================================================

SELECT
  analysis_date AS `Analysis Date`,
  frequency_group AS `Frequency Group`,
  CONCAT(CAST(current_period_start AS STRING), ' to ', CAST(current_period_end AS STRING)) AS `Period Analyzed`,
  total_new_advisors AS `New Advisors`,
  total_advisors_on_move AS `On The Move`,
  total_crm_matches AS `CRM Matches`,
  recruiters_analyzed AS `Recruiters Analyzed`,
  status AS `Status`
FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
ORDER BY analysis_date DESC
LIMIT 20;
```

### ✅ VERIFICATION 4.1

```
Save each query in BigQuery Console:
1. Click "Save Query" → "Save"
2. Name: "Export - New Advisors", "Export - On The Move", etc.
3. Organize in a folder: "Savvy Pirate Exports"

To export:
1. Run the query
2. Click "Save Results" → "CSV (local file)"
3. File naming: new_advisors_YYYY-MM-DD.csv
```

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Verification query returns 0 rows when rows are expected
- [ ] Any error message appears in the output
- [ ] Count doesn't match expected value

If any stop condition is triggered:
1. Check the ERROR RECOVERY section above
2. Fix the issue
3. Re-run verification
4. Only proceed when all checks pass

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

**Copy the code from:** `big_query/apps-script/Code.gs`

Or copy this entire code into your `Code.gs` file:

**The complete code is available in:** `big_query/apps-script/Code.gs`

**Or copy this code block:**

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
 * Escape single quotes for SQL
 */
function escapeSql(str) {
  if (!str) return null;
  return str.replace(/'/g, "''");
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
        WHERE linkedin_url = '${escapeSql(linkedinUrl)}' 
        LIMIT 1
      `;
      const existing = runQuery(existingQuery);
      
      let advisorId;
      
      if (existing.length > 0) {
        advisorId = existing[0].id;
        // Update last seen
        const titleSql = profile.title ? `'${escapeSql(profile.title)}'` : 'current_title';
        const locationSql = profile.location ? `'${escapeSql(profile.location)}'` : 'current_location';
        const updateSql = `
          UPDATE \`${PROJECT_ID}.${DATASET_ID}.advisors\` 
          SET last_seen_at = CURRENT_TIMESTAMP(), 
              times_seen = times_seen + 1,
              current_title = ${titleSql},
              current_location = ${locationSql},
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
          accreditations: profile.accreditations || [],
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
  
  const trimmedName = name.trim();
  const escapedName = escapeSql(trimmedName);
  
  const existingQuery = `
    SELECT id FROM \`${PROJECT_ID}.${DATASET_ID}.recruiters\` 
    WHERE name = '${escapedName}' 
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
    name: trimmedName,
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
  
  const errorSql = error ? `'${escapeSql(error)}'` : 'NULL';
  const updateSql = `
    UPDATE \`${PROJECT_ID}.${DATASET_ID}.scrape_runs\`
    SET completed_at = CURRENT_TIMESTAMP(),
        status = '${status || 'completed'}',
        profiles_scraped = ${profilesScraped || 0},
        new_connections_found = ${newConnections || 0},
        searches_completed = ${searchesCompleted || 0},
        error_message = ${errorSql}
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
  const rows = profiles.map((profile, idx) => {
    // Generate advisor_id if not provided
    let advisorId = profile.advisor_id;
    if (!advisorId) {
      const hashInput = profile.linkedin_url || profile.name || String(idx);
      const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hashInput);
      const hashHex = hashBytes.map(b => (b + 256).toString(16).substring(1)).join('').substring(0, 32);
      advisorId = `adv_${hashHex}`;
    }
    
    return {
      id: `obs_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
      scrape_run_id: scrape_run_id || null,
      recruiter_id: recruiter_id,
      advisor_id: advisorId,
      search_id: search_id || null,
      observed_at: now,
      advisor_name: profile.name || null,
      advisor_title: profile.title || null,
      advisor_location: profile.location || null,
      advisor_linkedin_url: profile.linkedin_url || null,
      search_job_title: search_job_title || null,
      created_at: now
    };
  });
  
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
https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec
```

### 📝 INSTRUCTIONS 5.3.2: Save Your Web App URL

✅ **Already configured!** Your Web App URL is saved in the Configuration Constants section at the top of this document:

```
APPS_SCRIPT_WEB_APP_URL = https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec
APPS_SCRIPT_DEPLOYMENT_ID = AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx
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
https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec
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
$url = "https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec"
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
curl -X POST "https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec" \
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
        appsScriptWebAppUrl: 'https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec',
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
const url = 'https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec';

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

# PHASE 6: Chrome Extension Integration

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
3. **manifest.json** - We'll add host permission for Apps Script Web App

### Existing Code Pattern

The extension uses this pattern for syncing data (from `service_worker.js`):

```javascript
// After scraping completes, profiles are synced to Google Sheets:
async function handleFinishedProfiles(profiles, sourceName, searchType) {
    // ... existing Sheets sync logic ...
    
    // ← BigQuery sync will be added HERE (after Sheets sync)
}
```

### Service Worker Modification (Explicit Anchors)

**File:** `background/service_worker.js`

**Step 6.1.A: Add Import**

SEARCH for this exact line near the top of service_worker.js:
```javascript
import { notifyWebhook } from './notifications.js';
```

INSERT immediately AFTER that line:
```javascript
import { initBigQueryConfig, syncProfilesToBigQuery, isConfigured } from './bigquery_sync.js';
```

**Step 6.1.B: Initialize Config on Startup**

SEARCH for this pattern (the startup initialization block):
```javascript
console.log(`${LOG} ✅ Service worker initialized`);
```

INSERT immediately BEFORE that line:
```javascript
// Initialize BigQuery sync config
await initBigQueryConfig();
```

**Step 6.1.C: Add Sync Call After Sheets Sync**

SEARCH for this pattern in handleFinishedProfiles or similar function:
```javascript
// ... existing Sheets sync logic completes here
```

INSERT immediately AFTER the Sheets sync completion:
```javascript
// NEW: BigQuery sync (non-blocking - failures don't break the flow)
if (isConfigured()) {
    try {
        const recruiterId = await getOrCreateRecruiter(sourceName);
        await syncProfilesToBigQuery(profiles, recruiterId, sourceName, searchType);
        console.log(`${LOG} ✅ BigQuery sync complete: ${profiles.length} profiles`);
    } catch (e) {
        console.error(`${LOG} ⚠️ BigQuery sync failed (non-critical):`, e.message);
    }
}
```

**File:** `manifest.json`

SEARCH for:
```json
"host_permissions": [
```

Ensure this array includes (add if missing):
```json
"https://*.cloudfunctions.net/*"
```

---

## Step 6.1: Add BigQuery Sync to Extension

### 🤖 CURSOR PROMPT 6.1

```
Update the Chrome Extension to sync scraped data to BigQuery via the Apps Script Web App.
This should happen AFTER the existing Google Sheets sync (BigQuery is secondary).

Create or update the background/bigquery_sync.js file in the extension.
```

### 📝 CODE SNIPPET 6.1.1: BigQuery Sync Module (bigquery_sync.js)

```javascript
// background/bigquery_sync.js
// Syncs scraped data to BigQuery via Apps Script Web App

const BQ_LOG = '[BIGQUERY]';

// ============================================================
// CONFIGURATION - Loaded from Chrome Storage
// ============================================================

// Default URL (will be overridden by stored config)
let APPS_SCRIPT_WEB_APP_URL = null;

/**
 * Initialize BigQuery sync configuration
 * Call this once during service worker startup
 */
export async function initBigQueryConfig() {
    try {
        const stored = await chrome.storage.local.get(['bigquery_config']);
        if (stored.bigquery_config?.appsScriptWebAppUrl) {
            APPS_SCRIPT_WEB_APP_URL = stored.bigquery_config.appsScriptWebAppUrl;
            console.log(`${BQ_LOG} ✅ Config loaded: ${APPS_SCRIPT_WEB_APP_URL}`);
            return true;
        } else {
            console.warn(`${BQ_LOG} ⚠️ No Apps Script Web App URL configured`);
            return false;
        }
    } catch (e) {
        console.error(`${BQ_LOG} Failed to load config:`, e);
        return false;
    }
}

/**
 * Save BigQuery configuration
 * @param {Object} config - { appsScriptWebAppUrl: string }
 */
export async function saveBigQueryConfig(config) {
    await chrome.storage.local.set({ 
        bigquery_config: {
            appsScriptWebAppUrl: config.appsScriptWebAppUrl,
            configured_at: new Date().toISOString()
        }
    });
    APPS_SCRIPT_WEB_APP_URL = config.appsScriptWebAppUrl;
    console.log(`${BQ_LOG} ✅ Config saved`);
}

/**
 * Check if BigQuery sync is configured
 */
export function isConfigured() {
    return !!APPS_SCRIPT_WEB_APP_URL;
}

/**
 * Get current configuration
 */
export function getConfig() {
    return {
        appsScriptWebAppUrl: APPS_SCRIPT_WEB_APP_URL,
        isConfigured: isConfigured()
    };
}

// ============================================================
// REST OF THE MODULE (unchanged)
// ============================================================

async function callAppsScriptWebApp(action, data) {
    if (!APPS_SCRIPT_WEB_APP_URL) {
        throw new Error('BigQuery Apps Script Web App URL not configured');
    }
    
    const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, data })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Apps Script Web App error: ${response.status} - ${error}`);
    }

    return response.json();
}

export async function syncProfilesToBigQuery(profiles, recruiterId, recruiterName, searchType = null, scrapeRunId = null) {
    console.log(`${BQ_LOG} Syncing ${profiles.length} profiles for ${recruiterName}...`);

    if (!isConfigured()) {
        console.warn(`${BQ_LOG} Apps Script Web App URL not configured - skipping sync`);
        return { synced: 0, errors: 0 };
    }

    try {
        const result = await callAppsScriptWebApp('sync_profiles', {
            profiles: profiles.map(p => ({
                name: p.name,
                linkedinUrl: p.linkedinUrl,
                title: p.title,
                location: p.location,
                accreditations: p.accreditations
            })),
            recruiterId,
            recruiterName,
            searchType,
            scrapeRunId
        });

        console.log(`${BQ_LOG} ✅ Sync complete: ${result.synced} synced, ${result.errors} errors`);
        return result;

    } catch (error) {
        console.error(`${BQ_LOG} Sync error:`, error);
        return { synced: 0, errors: profiles.length, error: error.message };
    }
}

export async function getOrCreateRecruiter(name, frequency = '1st_3rd_week', options = {}) {
    console.log(`${BQ_LOG} Getting/creating recruiter: ${name}`);

    try {
        const result = await callAppsScriptWebApp('get_or_create_recruiter', {
            name,
            frequency,
            company: options.company,
            title: options.title,
            sheetUrl: options.sheetUrl
        });

        console.log(`${BQ_LOG} Recruiter ${result.created ? 'created' : 'found'}: ${result.recruiterId}`);
        return result.recruiterId;

    } catch (error) {
        console.error(`${BQ_LOG} Error managing recruiter:`, error);
        throw error;
    }
}

export async function createScrapeRun(recruiterId, recruiterName, totalSearches = 9) {
    console.log(`${BQ_LOG} Creating scrape run for ${recruiterName}...`);

    try {
        const result = await callAppsScriptWebApp('create_scrape_run', {
            recruiterId,
            recruiterName,
            totalSearches
        });

        console.log(`${BQ_LOG} Scrape run created: ${result.scrapeRunId}`);
        return result.scrapeRunId;

    } catch (error) {
        console.error(`${BQ_LOG} Create scrape run error:`, error);
        return null;
    }
}

export async function completeScrapeRun(scrapeRunId, profilesScraped, newConnections, searchesCompleted, status = 'completed', error = null) {
    console.log(`${BQ_LOG} Completing scrape run: ${scrapeRunId}...`);

    try {
        await callAppsScriptWebApp('complete_scrape_run', {
            scrapeRunId,
            profilesScraped,
            newConnections,
            searchesCompleted,
            status,
            error
        });

        console.log(`${BQ_LOG} Scrape run completed`);

    } catch (err) {
        console.error(`${BQ_LOG} Complete scrape run error:`, err);
    }
}

export async function testConnection() {
    try {
        const result = await callAppsScriptWebApp('test_connection', {});
        return { success: true, message: result.message };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

/**
 * Record all profiles from a search as observations
 * Called after each search completes
 */
export async function recordSearchObservations(scrapeRunId, recruiterId, searchId, searchJobTitle, profiles) {
    if (!profiles || profiles.length === 0) {
        console.log('[BigQuery] No profiles to record as observations');
        return;
    }
    
    if (!isConfigured()) {
        console.warn('[BigQuery] Apps Script Web App URL not configured - skipping observations');
        return;
    }
    
    try {
        const result = await callAppsScriptWebApp('record_observations_batch', {
            scrape_run_id: scrapeRunId,
            recruiter_id: recruiterId,
            search_id: searchId,
            search_job_title: searchJobTitle,
            profiles: profiles.map(p => ({
                advisor_id: p.id || null,
                name: p.name,
                title: p.title,
                location: p.location,
                linkedin_url: p.linkedinUrl
            }))
        });
        
        console.log(`[BigQuery] Observations recorded:`, result);
        return result;
        
    } catch (error) {
        console.error('[BigQuery] Failed to record observations:', error);
    }
}

export default {
    syncProfilesToBigQuery,
    getOrCreateRecruiter,
    createScrapeRun,
    completeScrapeRun,
    isConfigured,
    testConnection,
    initBigQueryConfig,
    saveBigQueryConfig,
    getConfig
};
```

### 📝 CODE SNIPPET 6.1.2: Update Service Worker

```javascript
// In service_worker.js, add after Google Sheets sync:

import { 
    syncProfilesToBigQuery, 
    getOrCreateRecruiter,
    createScrapeRun,
    completeScrapeRun,
    isConfigured 
} from './bigquery_sync.js';

// After existing sheets sync, add BigQuery sync:
async function syncToAllDestinations(profiles, sourceName, searchType) {
    // Existing Google Sheets sync
    await syncToGoogleSheets(profiles, sourceName);
    
    // NEW: BigQuery sync (non-blocking - failures don't break the flow)
    if (isConfigured()) {
        try {
            const recruiterId = await getOrCreateRecruiter(sourceName);
            await syncProfilesToBigQuery(profiles, recruiterId, sourceName, searchType);
        } catch (e) {
            console.error('[SW] BigQuery sync failed (non-critical):', e);
        }
    }
}
```

### 📝 CODE SNIPPET 6.1.3: Update Manifest (host_permissions)

```json
{
  "host_permissions": [
    "https://*.linkedin.com/*",
    "https://sheets.googleapis.com/*",
    "https://www.googleapis.com/*",
    "https://script.google.com/*",
    "https://script.googleusercontent.com/*"
  ]
}
```

### ✅ VERIFICATION 6.1

```
1. Reload the Chrome Extension
2. Open the service worker console (chrome://extensions → service worker)
3. Run a test scrape
4. Check console for "[BIGQUERY] ✅ Sync complete" messages
5. Verify data in BigQuery:

SELECT COUNT(*) as profile_count, MAX(last_seen_at) as latest
FROM `savvy-gtm-analytics.savvy_pirate.advisors`;
```

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Verification query returns 0 rows when rows are expected
- [ ] Any error message appears in the output
- [ ] Count doesn't match expected value

If any stop condition is triggered:
1. Check the ERROR RECOVERY section above
2. Fix the issue
3. Re-run verification
4. Only proceed when all checks pass

---

# PHASE 7: Final Verification & Testing

## Step 7.1: End-to-End Test

### 🤖 CURSOR PROMPT 7.1

```
Perform a complete end-to-end test of the Savvy Pirate system:

1. Verify all BigQuery tables are created and have correct schemas
2. Verify the scheduled query is set up correctly
3. Test the Apps Script Web App
4. Test the Chrome Extension BigQuery sync
5. Verify the export queries work
```

### 📝 CODE SNIPPET 7.1.1: Complete System Verification Query

```sql
-- ================================================================
-- SYSTEM VERIFICATION QUERY
-- Run this to verify entire system is set up correctly
-- ================================================================

WITH table_check AS (
  SELECT table_name
  FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.TABLES`
),
function_check AS (
  SELECT routine_name
  FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.ROUTINES`
  WHERE routine_type = 'FUNCTION'
),
view_check AS (
  SELECT table_name as view_name
  FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.VIEWS`
),
data_check AS (
  SELECT 'recruiters' as table_name, COUNT(*) as row_count FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
  UNION ALL SELECT 'searches', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.searches`
  UNION ALL SELECT 'advisors', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.advisors`
  UNION ALL SELECT 'connections', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.connections`
)

SELECT 
  '=== TABLES ===' as category, 
  STRING_AGG(table_name, ', ') as items 
FROM table_check

UNION ALL

SELECT 
  '=== FUNCTIONS ===', 
  STRING_AGG(routine_name, ', ') 
FROM function_check

UNION ALL

SELECT 
  '=== VIEWS ===', 
  STRING_AGG(view_name, ', ') 
FROM view_check

UNION ALL

SELECT 
  '=== DATA COUNTS ===',
  STRING_AGG(CONCAT(table_name, ': ', CAST(row_count AS STRING)), ' | ')
FROM data_check;
```

### 📝 CODE SNIPPET 7.1.2: Expected Results Checklist

```
✅ TABLES (10 expected):
   - recruiters
   - searches  
   - advisors
   - connections
   - scrape_runs
   - weekly_analyses
   - new_advisor_reports
   - advisor_movement_alerts
   - crm_match_results

✅ FUNCTIONS (5 expected):
   - get_week_of_month
   - get_active_frequency
   - normalize_linkedin_url
   - normalize_name
   - extract_linkedin_slug

✅ VIEWS (6 expected):
   - v_advisors_on_move
   - v_crm_match_candidates
   - v_advisors_with_crd
   - v_disappeared_connections
   - v_scrape_history
   - v_observations_with_advisors (CRITICAL - use for all queries)

✅ DATA COUNTS:
   - recruiters: 29
   - searches: 261
   - advisors: 0 (until first scrape)
   - connections: 0 (until first scrape)
```

### ✅ VERIFICATION 7.1

```
If any checks fail:
1. Re-run the specific step that creates the missing item
2. Check for typos in project/dataset names
3. Verify BigQuery permissions
4. Check Apps Script execution logs for errors (View → Executions in Apps Script editor)
```

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Verification query returns 0 rows when rows are expected
- [ ] Any error message appears in the output
- [ ] Count doesn't match expected value

If any stop condition is triggered:
1. Check the ERROR RECOVERY section above
2. Fix the issue
3. Re-run verification
4. Only proceed when all checks pass

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
                    text: [
                        `🚨 *ON THE MOVE*: <${alert.linkedin_url}|${alert.advisor_name}>`,
                        `• Severity: ${alert.severity.toUpperCase()}`,
                        `• Recruiters (${alert.recruiter_count}): ${alert.recruiters}`,
                        `• ${alert.why_flagged}`
                    ].join('\n')
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
                    text: [
                        `🔥 *CRM RE-ENGAGE*: <${alert.advisor_linkedin_url}|${alert.advisor_name}>`,
                        `• Matched: ${alert.match_type} - ${record}`,
                        `• Owner: ${owner}`,
                        `• Priority: HIGH`
                    ].join('\n')
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

### ⛔ STOP CONDITIONS

Do NOT proceed to the next step if:
- [ ] Verification query returns 0 rows when rows are expected
- [ ] Any error message appears in the output
- [ ] Count doesn't match expected value

If any stop condition is triggered:
1. Check the ERROR RECOVERY section above
2. Fix the issue
3. Re-run verification
4. Only proceed when all checks pass

---

# 📋 Weekly Operations Runbook

## Monday Morning Workflow

### 6:00 AM ET - Automated Analysis Runs
The scheduled query automatically runs and populates:
- `new_advisor_reports` 
- `advisor_movement_alerts`
- `crm_match_results`

### ~8:00 AM ET - Manual Export Process

1. **Open BigQuery Console**
   ```
   https://console.cloud.google.com/bigquery?project=savvy-gtm-analytics
   ```

2. **Run Export Query: New Advisors**
   - Open saved query "Export - New Advisors"
   - Click Run
   - Save Results → CSV (local file)
   - Filename: `new_advisors_YYYY-MM-DD.csv`

3. **Run Export Query: On The Move**
   - Open saved query "Export - On The Move"
   - Click Run
   - Save Results → CSV (local file)
   - Filename: `on_the_move_YYYY-MM-DD.csv`

4. **Run Export Query: CRM Matches**
   - Open saved query "Export - CRM Matches"
   - Click Run
   - Save Results → CSV (local file)
   - Filename: `crm_re_engage_YYYY-MM-DD.csv`

5. **Distribute to Sales Team**
   - Email CSVs to relevant team members
   - High priority: CRM matches with alert_priority = 'high'

---

# 🔧 Troubleshooting Guide

## Common Issues

### Scheduled Query Not Running
```sql
-- Check scheduled query status
SELECT * FROM `region-us`.INFORMATION_SCHEMA.SCHEDULED_QUERIES
WHERE display_name LIKE '%Savvy Pirate%';
```

### Cloud Function Errors
```bash
# View Cloud Function logs
gcloud functions logs read savvy-pirate-sync --limit 50
```

### No CRM Matches Found
1. Verify Salesforce data exists in BigQuery
2. Check LinkedIn URL field names in Salesforce tables
3. Test normalization functions:
```sql
SELECT 
  `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`('https://linkedin.com/in/John-Doe-123'),
  `savvy-gtm-analytics.savvy_pirate.normalize_name`('John O''Brien III, CFP®');
```

### Chrome Extension Not Syncing
1. Check service worker console for errors
2. Verify Apps Script Web App URL is correct
3. Test Apps Script directly with curl

### Advisor ID Mismatch in Observations

**Symptom:** `connection_observations.advisor_id` shows hash IDs (like `adv_abc123...`) or NULL instead of UUIDs.

**Root Cause:** 
- BigQuery streaming tables cannot be updated for ~90 minutes after insert
- If `advisor_id` wasn't set correctly during insert, it can't be immediately fixed

**Solution (Immediate):**
```sql
-- ✅ ALWAYS use the view for queries:
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`
WHERE observed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY);

-- ❌ Don't query the base table directly:
-- SELECT * FROM connection_observations  -- May have hash IDs
```

**Check Match Status:**
```sql
-- See how many observations are correctly matched:
SELECT 
  match_status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percent
FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`
GROUP BY match_status
ORDER BY count DESC;
```

**Expected:** Most should show `✅ Matched via linkedin_id` after scrapes run.

**Permanent Fix (Optional):**
After ~90 minutes from last insert, run the backfill script:
```sql
-- See: big_query/BACKFILL_OBSERVATIONS_ADVISOR_ID.sql
-- This updates the base table with correct UUIDs
```

**Prevention:**
- Ensure Apps Script `syncProfiles()` returns `advisorIds` array
- Ensure Chrome Extension passes `advisorIds` to `recordObservationsBatch()`
- Check Apps Script execution logs for errors during sync

---

# 📊 Success Metrics

After running for 4+ weeks, you should see:

| Metric | Expected Range | How to Check |
|--------|---------------|--------------|
| Advisors discovered per week | 50-200 | `SELECT COUNT(*) FROM advisors WHERE first_seen_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)` |
| "On the move" alerts per month | 10-30 | `SELECT COUNT(*) FROM advisor_movement_alerts WHERE analysis_date > DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)` |
| CRM matches per analysis | 5-20% of new advisors | Check `crm_match_results` vs `new_advisor_reports` counts |
| CRD matches per analysis | 10-30% of new advisors | Check `v_advisors_with_crd` WHERE is_registered_ria = TRUE |
| Scrape success rate | >95% | `SELECT COUNTIF(status='completed')/COUNT(*) FROM scrape_runs` |
| Job changes detected per month | 5-15 | `SELECT COUNT(*) FROM advisor_job_changes WHERE detected_date > DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)` |
| Slack alerts sent per week | 2-10 | Check Cloud Function logs |

---

# PHASE 9: Looker Studio Dashboard

## Overview

This phase creates a unified dashboard for your sales team to access all Savvy Pirate intelligence without touching BigQuery. The dashboard will have:

- **Page 1:** New Advisors (weekly discoveries)
- **Page 2:** On The Move (multi-recruiter appearances)  
- **Page 3:** CRM Matches (advisors already in Salesforce)
- **Page 4:** Network Trends (optional - historical analysis)

**Time to complete:** 30-45 minutes  
**Prerequisites:** BigQuery connected to Looker Studio (already done)

---

## Step 9.1: Create New Looker Studio Report

### 🤖 CURSOR PROMPT 9.1

```
Guide the user through creating a new Looker Studio report connected to the Savvy Pirate BigQuery views.
```

### 📝 INSTRUCTIONS 9.1.1: Create Report

1. Go to [Looker Studio](https://lookerstudio.google.com/)
2. Click **Create → Report**
3. Name it: `Savvy Pirate Intelligence Dashboard`

### 📝 INSTRUCTIONS 9.1.2: Add Data Sources

Add these BigQuery data sources to the report:

| Data Source Name | BigQuery Table/View | Purpose |
|------------------|---------------------|---------|
| New Advisor Reports | `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` | Weekly new advisors |
| Advisor Movement Alerts | `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts` | Multi-recruiter detections |
| CRM Matches | `savvy-gtm-analytics.savvy_pirate.v_crm_matches` | Salesforce matches |
| Advisors with CRD | `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` | FINTRX enrichment |
| Scrape History | `savvy-gtm-analytics.savvy_pirate.v_scrape_history` | Historical trends |
| Disappeared Connections | `savvy-gtm-analytics.savvy_pirate.v_disappeared_connections` | Lost connections |
| Observations (Optional) | `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors` | ⚠️ Use view, not base table - ensures correct advisor_id |

**To add each data source:**
1. Click **Add data** (or Resource → Manage added data sources)
2. Select **BigQuery**
3. Choose project: `savvy-gtm-analytics`
4. Choose dataset: `savvy_pirate`
5. Select the table/view
6. Click **Add**

---

## Step 9.2: Create Page 1 - New Advisors

### 🤖 CURSOR PROMPT 9.2

```
Create the New Advisors page showing weekly discoveries with priority sorting and key metrics.
```

### 📝 INSTRUCTIONS 9.2.1: Page Setup

1. Rename the first page to **"New Advisors"**
2. Set page size: **Landscape (16:9)** under Page → Current page settings

### 📝 INSTRUCTIONS 9.2.2: Add Header Section

Add these components at the top:

| Component | Type | Configuration |
|-----------|------|---------------|
| Title | Text | "🏴‍☠️ New Advisors This Week" - Font size 24, Bold |
| Date Range | Date range control | Auto date range, show last 7 days |
| Recruiter Filter | Drop-down list | Dimension: `recruiter_name`, Allow "All" |

### 📝 INSTRUCTIONS 9.2.3: Add Scorecard Metrics

Add a row of 4 scorecards below the header:

| Scorecard | Metric | Configuration |
|-----------|--------|---------------|
| Total New | Record Count | Filter: `analysis_date` = last 7 days |
| High Priority | Record Count | Filter: `lead_priority` CONTAINS "HIGH" |
| With CRD | Record Count | Filter: `crd_number` IS NOT NULL |
| Avg Firm AUM | AVG(`crd_firm_aum`) | Format as currency, divide by 1M |

**Scorecard styling:**
- Background: Light blue (#E3F2FD)
- Border radius: 8px
- Metric font size: 32
- Label font size: 12

### 📝 INSTRUCTIONS 9.2.4: Add Main Data Table

Create the primary table with these columns:

| Column | Field | Format |
|--------|-------|--------|
| Priority | `lead_priority` | Conditional formatting (see below) |
| Name | `advisor_name` | Text |
| Title | `title` | Text |
| Location | `location` | Text |
| Recruiter | `recruiter_name` | Text |
| CRD | `crd_number` | Number (no decimals) |
| Firm | `crd_firm_name` | Text |
| Firm AUM | `crd_firm_aum` | Currency, show in millions |
| LinkedIn | `linkedin_url` | Data link (clickable) |
| First Seen | `first_seen_date` | Date (MM/DD/YYYY) |

**Conditional formatting for Priority column:**
- "HIGH - Registered Producing Advisor" → Green background (#C8E6C9)
- "MEDIUM - Registered RIA" → Yellow background (#FFF9C4)
- "NORMAL - Not in FINTRX" → No color

**Table settings:**
- Rows per page: 25
- Show pagination
- Enable sorting on all columns
- Default sort: Priority (ascending), then First Seen (descending)

### 📝 INSTRUCTIONS 9.2.5: Add LinkedIn Click Column

To make LinkedIn URLs clickable:
1. Select the `linkedin_url` column
2. In the DATA panel, check **"Add link to field"**
3. Set Link field to: `linkedin_url`

---

## Step 9.3: Create Page 2 - On The Move

### 🤖 CURSOR PROMPT 9.3

```
Create the On The Move page showing advisors appearing in multiple recruiter networks.
```

### 📝 INSTRUCTIONS 9.3.1: Page Setup

1. Add new page: **Page → New page**
2. Rename to **"On The Move"**
3. Copy header section from Page 1 (Date range, filters)
4. Change title to: "🚨 Advisors On The Move"

### 📝 INSTRUCTIONS 9.3.2: Add Alert Level Scorecards

| Scorecard | Metric | Filter | Color |
|-----------|--------|--------|-------|
| 🔴 3+ Recruiters | Record Count | `recruiter_count` >= 3 | Red (#FFCDD2) |
| 🟡 2 Recruiters | Record Count | `recruiter_count` = 2 | Yellow (#FFF9C4) |
| Total Alerts | Record Count | None | Blue (#E3F2FD) |

### 📝 INSTRUCTIONS 9.3.3: Add Movement Timeline Chart

Create a time series chart:
- **Chart type:** Time series (line)
- **Date dimension:** `first_appearance`
- **Metric:** Record Count
- **Breakdown:** `recruiter_count`
- **Date range:** Last 90 days

### 📝 INSTRUCTIONS 9.3.4: Add Main Alerts Table

| Column | Field | Format |
|--------|-------|--------|
| Alert Level | Calculated (see below) | Conditional color |
| Advisor | `advisor_name` | Text |
| Title | `advisor_title` | Text |
| # Recruiters | `recruiter_count` | Number |
| Recruiters | `recruiter_names` | Text (comma-separated) |
| First Detected | `first_appearance` | Date |
| Days Active | `days_between_first_last` | Number |
| LinkedIn | `linkedin_url` | Data link |
| CRD | (join to v_advisors_with_crd) | Number |

**Calculated field for Alert Level:**
```
CASE 
  WHEN recruiter_count >= 3 THEN "🔴 Hot"
  WHEN recruiter_count = 2 THEN "🟡 Warm"
  ELSE "⚪ New"
END
```

**Table settings:**
- Default sort: `recruiter_count` DESC, then `first_appearance` DESC
- Rows per page: 20

---

## Step 9.4: Create Page 3 - CRM Matches

### 🤖 CURSOR PROMPT 9.4

```
Create the CRM Matches page showing advisors that match existing Salesforce records.
```

### 📝 INSTRUCTIONS 9.4.1: Page Setup

1. Add new page, rename to **"CRM Matches"**
2. Add header with title: "🔗 CRM Matches"
3. Add Date range control and Recruiter filter

### 📝 INSTRUCTIONS 9.4.2: Add Match Type Breakdown

Create a pie chart or donut chart:
- **Dimension:** `match_type` (lead vs opportunity)
- **Metric:** Record Count
- **Colors:** Lead = Blue, Opportunity = Green

### 📝 INSTRUCTIONS 9.4.3: Add Confidence Level Breakdown

Create a bar chart:
- **Dimension:** `match_confidence` (exact_url vs fuzzy_name)
- **Metric:** Record Count
- **Colors:** exact_url = Green (high confidence), fuzzy_name = Yellow

### 📝 INSTRUCTIONS 9.4.4: Add CRM Matches Table

| Column | Field | Format |
|--------|-------|--------|
| Match Type | `match_type` | Badge style |
| Confidence | `match_confidence` | Conditional color |
| Advisor | `advisor_name` | Text |
| LinkedIn | `advisor_linkedin_url` | Data link |
| CRM Record | `lead_name` or `opportunity_name` | Text |
| Status | `lead_status` or `opportunity_stage` | Text |
| Disposition | `disposition` or `opp_closed_lost_reason` | Text |
| Last Activity | `lead_last_activity_date` | Date |
| Salesforce | (calculated link) | Data link |

**Calculated field for Salesforce link:**
```
CASE 
  WHEN match_type = 'lead' THEN 
    CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', lead_id, '/view')
  ELSE 
    CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', opportunity_id, '/view')
END
```

---

## Step 9.5: Create Page 4 - Network Trends (Optional)

### 🤖 CURSOR PROMPT 9.5

```
Create an optional Network Trends page for historical analysis using scrape history data.
```

### 📝 INSTRUCTIONS 9.5.1: Page Setup

1. Add new page, rename to **"Network Trends"**
2. Add header with title: "📈 Network Trends"

### 📝 INSTRUCTIONS 9.5.2: Add Connection Count Over Time

Create a time series chart:
- **Data source:** `v_scrape_history`
- **Date dimension:** `scrape_date`
- **Metric:** SUM(`connections_found`)
- **Breakdown dimension:** `recruiter_name`
- **Chart type:** Line chart with points

### 📝 INSTRUCTIONS 9.5.3: Add Recruiter Comparison Table

| Column | Field |
|--------|-------|
| Recruiter | `recruiter_name` |
| Latest Scrape | MAX(`scrape_date`) |
| Latest Count | (connections from latest scrape) |
| Previous Count | (connections from previous scrape) |
| Change | (calculated difference) |
| % Change | (calculated percentage) |

### 📝 INSTRUCTIONS 9.5.4: Add Disappeared Connections Section

Add a table from `v_disappeared_connections`:

| Column | Field |
|--------|-------|
| Recruiter | `recruiter_name` |
| Lost Advisor | `advisor_name` |
| Last Title | `advisor_title` |
| Last Seen | `last_seen_date` |
| Days Gone | `days_since_seen` |
| LinkedIn | `advisor_linkedin_url` |

---

## Step 9.6: Configure Auto-Refresh

### 🤖 CURSOR PROMPT 9.6

```
Configure the dashboard to auto-refresh so data stays current without manual intervention.
```

### 📝 INSTRUCTIONS 9.6.1: Set Data Freshness

For each data source:
1. Go to **Resource → Manage added data sources**
2. Click **Edit** on each data source
3. Set **Data freshness** to: **Every 15 minutes** (or **Every hour** for less critical views)

**Recommended freshness settings:**

| Data Source | Freshness |
|-------------|-----------|
| new_advisor_reports | Every hour |
| advisor_movement_alerts | Every hour |
| v_crm_matches | Every 4 hours |
| v_advisors_with_crd | Every 12 hours |
| v_scrape_history | Every 4 hours |
| v_disappeared_connections | Every 4 hours |

### 📝 INSTRUCTIONS 9.6.2: Enable Report Refresh

1. Go to **File → Report settings**
2. Under **Viewer tools**, ensure **"Enable cache"** is ON
3. Set cache duration based on your needs

---

## Step 9.7: Set Up Sharing & Export

### 🤖 CURSOR PROMPT 9.7

```
Configure sharing permissions and export options for the sales team.
```

### 📝 INSTRUCTIONS 9.7.1: Share the Dashboard

1. Click **Share** button (top right)
2. Add team members' emails
3. Set permission level:
   - **Viewer:** Can view and interact with filters
   - **Editor:** Can modify the dashboard

**Recommended:** Create a Google Group for the sales team and share with the group.

### 📝 INSTRUCTIONS 9.7.2: Enable Download Options

1. Go to **File → Report settings**
2. Under **Viewer tools**, enable:
   - ✅ Allow viewers to download the report as PDF
   - ✅ Allow viewers to download data from charts
   - ✅ Allow viewers to export data to Google Sheets

### 📝 INSTRUCTIONS 9.7.3: Create Scheduled Email Delivery

1. Click **Share → Schedule email delivery**
2. Configure:
   - **Recipients:** Sales team distribution list
   - **Subject:** "Savvy Pirate Weekly Intelligence Report"
   - **Schedule:** Weekly on Monday at 8:00 AM ET
   - **Pages:** All pages (or select specific pages)

---

## Step 9.8: Add Dashboard Navigation

### 🤖 CURSOR PROMPT 9.8

```
Add navigation elements to make the dashboard easy to use.
```

### 📝 INSTRUCTIONS 9.8.1: Add Page Navigation Buttons

On each page, add navigation buttons:

1. Add **Shape** (rectangle with rounded corners)
2. Add **Text** inside: "New Advisors" / "On The Move" / etc.
3. Right-click → **Add report navigation link**
4. Select the target page

**Button styling:**
- Active page: Filled background (#1976D2), white text
- Other pages: White background, blue text (#1976D2), border

### 📝 INSTRUCTIONS 9.8.2: Add Footer

Add a consistent footer to all pages:

```
Last refreshed: [Auto Date] | Data source: savvy-gtm-analytics.savvy_pirate | Questions? Contact: [your email]
```

---

## ✅ VERIFICATION 9

Verify the dashboard is working correctly:

### Checklist

- [ ] All 6 data sources connect successfully
- [ ] Page 1 (New Advisors) shows data with correct priority colors
- [ ] Page 2 (On The Move) shows multi-recruiter alerts
- [ ] Page 3 (CRM Matches) shows Salesforce matches with clickable links
- [ ] Page 4 (Network Trends) shows historical charts
- [ ] LinkedIn URLs are clickable
- [ ] Salesforce links work correctly
- [ ] Date range filter works across all pages
- [ ] Recruiter filter works correctly
- [ ] Auto-refresh is configured
- [ ] Team members can access the dashboard
- [ ] PDF export works
- [ ] Scheduled email is configured (if desired)

### ⛔ STOP CONDITIONS

Do NOT proceed if:
- [ ] Any data source shows "Configuration error"
- [ ] Tables show no data when data exists in BigQuery
- [ ] Filters don't update the visualizations
- [ ] Clickable links go to wrong URLs

### ❌ ERROR RECOVERY 9

| Error | Cause | Fix |
|-------|-------|-----|
| "Data source configuration error" | Permissions issue | Ensure your account has BigQuery access |
| "No data" in tables | Filter too restrictive or no data | Check date range, remove filters, verify data in BigQuery |
| Links don't work | Wrong field used for URL | Verify `linkedin_url` field contains full URLs |
| Slow loading | Too much data | Add date filter to limit data, increase cache duration |
| "Access denied" for shared users | Permissions | Share BigQuery dataset with users OR use "Viewer credentials" |

---

## 📝 Quick Reference: Dashboard URLs

After setup, save these URLs:

| Link | Purpose |
|------|---------|
| Dashboard (View) | `https://lookerstudio.google.com/reporting/[YOUR_REPORT_ID]` |
| Dashboard (Edit) | `https://lookerstudio.google.com/reporting/[YOUR_REPORT_ID]/edit` |
| New Advisors Page | Add `/page/p1` to view URL |
| On The Move Page | Add `/page/p2` to view URL |
| CRM Matches Page | Add `/page/p3` to view URL |

---

## 🎨 Branding Recommendations

For a polished look:

| Element | Recommendation |
|---------|----------------|
| Primary color | #1976D2 (Blue) |
| Success/High priority | #4CAF50 (Green) |
| Warning/Medium | #FFC107 (Amber) |
| Alert/Hot | #F44336 (Red) |
| Background | #FAFAFA (Light gray) |
| Logo | Add company logo top-left |
| Font | Roboto (default) or your brand font |

---

**Phase 9 Complete!** Your sales team now has a unified dashboard to access all Savvy Pirate intelligence without touching BigQuery.

---

# ✅ Implementation Complete Checklist

Before going to production, verify all components:

## Phase 0: Environment
- [x] MCP BigQuery connection works
- [x] GCloud CLI authenticated
- [x] BigQuery permissions verified

## Phase 1: Infrastructure
- [x] All 12 tables created
- [x] All 5 functions created
- [x] All 6 views created (including v_observations_with_advisors)
- [x] 29 recruiters seeded
- [x] 261 searches seeded
- [x] Sheets→BigQuery sync function added
- [x] connection_observations table created
- [x] v_observations_with_advisors view created (CRITICAL for correct advisor_id)
- [x] v_disappeared_connections view created
- [x] v_scrape_history view created

## Phase 2: CRM Matching
- [x] Salesforce column names confirmed by human
- [x] v_crm_matches view created with correct columns
- [x] Test query returns no errors
- [x] FINTRX slug extraction function created
- [x] v_advisors_with_crd view created
- [x] CRD match statistics verified

## Phase 3: Scheduled Analysis
- [x] Monday analysis scheduled query created
- [x] Timezone set to America/New_York
- [x] Test run executed successfully

## Phase 4: Export Queries
- [x] New Advisors export query saved
- [x] On The Move export query saved
- [x] CRM Matches export query saved
- [x] Job Changes export query saved
- [x] Reconstruct Past Scrape export query saved
- [x] Disappeared Connections export query saved
- [x] Weekly Summary Dashboard query saved
- [x] All queries tested and verified working

## Phase 5: Apps Script Web App
- [x] Apps Script project created
- [x] BigQuery Advanced Service enabled
- [x] Code.gs contains sync functions
- [x] Web app deployed with "Anyone" access
- [x] Web app URL saved to config
- [x] GET request returns success JSON
- [x] POST test_connection returns success
- [x] Chrome Extension configured with Apps Script URL
- [x] Test profile sync works (10/10 profiles, 0 errors)

## Phase 6: Chrome Extension
- [x] bigquery_sync.js added to background/
- [x] service_worker.js imports BigQuery sync
- [x] manifest.json has Apps Script Web App permission
- [x] Test scrape syncs to BigQuery
- [x] End-to-end sync verified (260+ advisors synced)

## Phase 7: Verification
- [x] End-to-end test passed
- [x] All table counts verified
- [x] Apps Script Web App verified
- [x] Chrome Extension sync verified
- [x] System status: PRODUCTION READY ✅

## Phase 8: Alerting (Optional)
- [ ] Slack webhook created
- [ ] savvy-pirate-alerts function deployed
- [ ] Cloud Scheduler job created
- [ ] Test alert received in Slack

## Phase 9: Looker Studio Dashboard
- [ ] All 6 data sources added to report
- [ ] Page 1 (New Advisors) created with scorecards and table
- [ ] Page 2 (On The Move) created with alerts table
- [ ] Page 3 (CRM Matches) created with match breakdowns
- [ ] Page 4 (Network Trends) created (optional)
- [ ] Auto-refresh configured for all data sources
- [ ] Dashboard shared with sales team
- [ ] Download/export options enabled
- [ ] Scheduled email delivery configured (optional)
- [ ] Navigation buttons added to all pages

---

# 🤖 Machine-Checkable Verification Script

This script can be run by Cursor.ai (or manually) to verify the entire system 
is correctly configured. Run this AFTER completing all phases.

## Full System Verification Query

```sql
-- ================================================================
-- SAVVY PIRATE SYSTEM VERIFICATION
-- Run this query to check all components are in place
-- All rows should show status = 'OK'
-- ================================================================

WITH checks AS (
  -- Check 1: Dataset exists
  SELECT 'dataset_exists' as check_name,
    CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'FAIL' END as status,
    'savvy_pirate dataset' as description
  FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.TABLES`
  
  UNION ALL
  
  -- Check 2: All 12 tables exist
  SELECT 'table_count', 
    CASE WHEN COUNT(*) = 12 THEN 'OK' ELSE CONCAT('FAIL: ', CAST(COUNT(*) AS STRING), '/12') END,
    'Expected 12 tables'
  FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.TABLES`
  
  UNION ALL
  
  -- Check 3: Recruiters seeded
  SELECT 'recruiters_seeded',
    CASE WHEN COUNT(*) = 29 THEN 'OK' ELSE CONCAT('FAIL: ', CAST(COUNT(*) AS STRING), '/29') END,
    'Expected 29 recruiters'
  FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
  
  UNION ALL
  
  -- Check 4: Searches generated
  SELECT 'searches_generated',
    CASE WHEN COUNT(*) = 261 THEN 'OK' ELSE CONCAT('FAIL: ', CAST(COUNT(*) AS STRING), '/261') END,
    'Expected 261 searches (29 × 9)'
  FROM `savvy-gtm-analytics.savvy_pirate.searches`
  
  UNION ALL
  
  -- Check 5: All 5 UDFs exist
  SELECT 'functions_created',
    CASE WHEN COUNT(*) = 5 THEN 'OK' ELSE CONCAT('FAIL: ', CAST(COUNT(*) AS STRING), '/5') END,
    'Expected 5 functions (including extract_linkedin_slug)'
  FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.ROUTINES`
  WHERE routine_type = 'FUNCTION'
  
  UNION ALL
  
  -- Check 6: All views exist
  SELECT 'views_created',
    CASE WHEN COUNT(*) = 6 THEN 'OK' ELSE CONCAT('FAIL: ', CAST(COUNT(*) AS STRING), '/6') END,
    'Expected 6 views (including v_observations_with_advisors)'
  FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.VIEWS`
  
  UNION ALL
  
  -- Check 8: connection_observations table exists
  SELECT 'observations_table',
    CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'FAIL: Table missing' END,
    'connection_observations table exists'
  FROM `savvy-gtm-analytics.savvy_pirate.INFORMATION_SCHEMA.TABLES`
  WHERE table_name = 'connection_observations'
  
  UNION ALL
  
  -- Check 7: Frequency distribution correct
  SELECT 'frequency_distribution',
    CASE 
      WHEN (SELECT COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.recruiters` WHERE frequency = '1st_3rd_week') = 16
       AND (SELECT COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.recruiters` WHERE frequency = '2nd_4th_week') = 13
      THEN 'OK'
      ELSE 'FAIL: Check frequency values'
    END,
    'Expected 16 in 1st_3rd, 13 in 2nd_4th'
)

SELECT 
  check_name,
  status,
  description,
  CASE WHEN status = 'OK' THEN '✅' ELSE '❌' END as icon
FROM checks
ORDER BY CASE WHEN status = 'OK' THEN 1 ELSE 0 END, check_name;
```

### Expected Output (All OK)

```
| check_name              | status | description                    | icon |
|-------------------------|--------|--------------------------------|------|
| dataset_exists          | OK     | savvy_pirate dataset           | ✅   |
| frequency_distribution  | OK     | Expected 16 in 1st_3rd, 13...  | ✅   |
| functions_created       | OK     | Expected 5 functions           | ✅   |
| recruiters_seeded       | OK     | Expected 29 recruiters         | ✅   |
| searches_generated      | OK     | Expected 261 searches (29 × 9) | ✅   |
| table_count             | OK     | Expected 12 tables             | ✅   |
| views_created           | OK     | Expected 6 views               | ✅   |
| observations_table      | OK     | connection_observations table exists | ✅   |
```

### If Any Check Shows FAIL

1. Note which check(s) failed
2. Go to the corresponding phase in this document
3. Re-run that phase's steps
4. Run this verification script again
5. Only proceed to production when ALL checks show OK

---

## Apps Script Web App Verification Commands

```bash
# Verify Apps Script Web App is deployed and accessible
curl -X POST "https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec" \
  -H "Content-Type: application/json" \
  -d '{"action": "test_connection", "data": {}}'

# Expected response: {"success":true,"message":"Connected to BigQuery",...}

# Verify savvy-pirate-alerts is deployed (Phase 8 - still uses Cloud Function)
curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://us-central1-savvy-gtm-analytics.cloudfunctions.net/savvy-pirate-alerts

# Expected: 200
```

## Chrome Extension Verification

```javascript
// Run in service worker console (chrome://extensions → Savvy Pirate → "service worker")

// Check 1: BigQuery config exists
chrome.storage.local.get(['bigquery_config'], (data) => {
    if (data.bigquery_config?.appsScriptWebAppUrl) {
        console.log('✅ BigQuery config OK:', data.bigquery_config.appsScriptWebAppUrl);
    } else {
        console.log('❌ BigQuery config MISSING - run Phase 5.3 setup');
    }
});

// Check 2: Test BigQuery connection
fetch('https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test_connection', data: {} })
})
.then(r => r.json())
.then(d => console.log(d.success ? '✅ Apps Script Web App OK' : '❌ Apps Script Web App FAIL:', d))
.catch(e => console.log('❌ Apps Script Web App ERROR:', e.message));
```

---

**Document Version:** 4.5 (Apps Script Edition - No GCP Admin Required)  
**Last Updated:** December 2024  
**Maintainer:** Savvy Pirate Team
