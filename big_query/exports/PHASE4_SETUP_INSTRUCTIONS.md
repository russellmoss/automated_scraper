# Phase 4: CSV Export Queries Setup

## Overview
This guide will help you save all the export queries in BigQuery so your sales team can easily export CSV files every Monday after the analysis runs.

## Step 1: Create Saved Queries Folder

1. Go to [BigQuery Console](https://console.cloud.google.com/bigquery?project=savvy-gtm-analytics)
2. In the left sidebar, expand **"Saved queries"**
3. Click **"Create folder"** (or use the three dots menu)
4. Name it: **"Savvy Pirate Exports"**

## Step 2: Save Each Export Query

For each query file in `big_query/exports/`:

### 2.1: Export - New Advisors

1. Click **"Compose new query"** (or use the + button)
2. Copy the contents of `EXPORT_NEW_ADVISORS.sql`
3. Paste into the query editor
4. Click **"Save"** → **"Save query"**
5. Name: **"Export - New Advisors"**
6. Description: **"Export new advisors from latest Monday analysis with CRD enrichment"**
7. Folder: Select **"Savvy Pirate Exports"**
8. Click **"Save"**

### 2.2: Export - On The Move

1. Repeat steps above with `EXPORT_ON_THE_MOVE.sql`
2. Name: **"Export - On The Move"**
3. Description: **"Export advisors appearing in multiple recruiter networks"**

### 2.3: Export - CRM Matches

1. Repeat with `EXPORT_CRM_MATCHES.sql`
2. Name: **"Export - CRM Matches"**
3. Description: **"Export advisors matched to existing Salesforce leads/opportunities"**

### 2.4: Export - Job Changes

1. Repeat with `EXPORT_JOB_CHANGES.sql`
2. Name: **"Export - Job Changes"**
3. Description: **"Export advisors who changed titles or companies"**

### 2.5: Export - Reconstruct Scrape

1. Repeat with `EXPORT_RECONSTRUCT_SCRAPE.sql`
2. Name: **"Export - Reconstruct Past Scrape"**
3. Description: **"Reconstruct a specific recruiter's scrape from a specific date (edit query to set recruiter name and date)"**

### 2.6: Export - Disappeared Connections

1. Repeat with `EXPORT_DISAPPEARED_CONNECTIONS.sql`
2. Name: **"Export - Disappeared Connections"**
3. Description: **"Export connections that disappeared from recruiter networks"**

### 2.7: Weekly Summary Dashboard

1. Repeat with `WEEKLY_SUMMARY_DASHBOARD.sql`
2. Name: **"Dashboard - Weekly Summary"**
3. Description: **"Summary of all Monday analyses (last 20 runs)"**

## Step 3: Test Each Query

After saving, test each query:

1. Open the saved query
2. Click **"Run"**
3. Verify it returns data (or 0 rows if no data yet)
4. Check for any errors

**Expected Results:**
- **New Advisors:** Should show 0 rows until you have 2+ weeks of data
- **On The Move:** Should show 6 rows (from your test run)
- **CRM Matches:** Should show 3 rows (from your test run)
- **Job Changes:** May show 0 rows if no job changes detected yet
- **Disappeared Connections:** May show 0 rows if no connections disappeared yet

## Step 4: Export as CSV

Once queries are saved and tested:

1. Open a saved query (e.g., "Export - On The Move")
2. Click **"Run"**
3. Wait for results
4. Click **"Save Results"** → **"CSV (local file)"**
5. File will download automatically
6. Rename it: `on_the_move_2025-12-28.csv` (use the analysis date)

## Weekly Workflow (Monday Morning)

After the scheduled query runs at 6 AM ET:

1. **8:00 AM ET** - Open BigQuery Console
2. Run each export query:
   - Export - New Advisors
   - Export - On The Move
   - Export - CRM Matches
   - Export - Job Changes (if any)
3. Download each as CSV
4. Email CSVs to sales team or upload to shared drive
5. **Priority:** Send CRM Matches first (highest priority leads)

## Quick Reference: Query Names

| Query Name | Purpose | When to Use |
|------------|---------|-------------|
| Export - New Advisors | New advisors discovered this week | Every Monday |
| Export - On The Move | Advisors in 2+ recruiter networks | Every Monday |
| Export - CRM Matches | Advisors already in Salesforce | Every Monday (HIGH PRIORITY) |
| Export - Job Changes | Title/company changes | Every Monday (if any) |
| Export - Reconstruct Past Scrape | Historical scrape data | As needed |
| Export - Disappeared Connections | Lost connections | Weekly review |
| Dashboard - Weekly Summary | Analysis overview | Weekly review |

## Troubleshooting

### Query Returns 0 Rows
- **New Advisors:** Normal until you have 2+ weeks of scrape data
- **Other queries:** Check that the latest analysis completed successfully:
  ```sql
  SELECT * FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  ORDER BY created_at DESC LIMIT 1;
  ```

### Query Error: "Table not found"
- Verify all tables exist (run Phase 1 verification)
- Check dataset name is `savvy_pirate`

### Query Error: "Column not found"
- Verify views exist (run Phase 1 Step 1.4 verification)
- Check that Phase 2 views were created

## Next Steps

After Phase 4 is complete:
- **Phase 7:** Final Verification & Testing
- **Phase 9:** Looker Studio Dashboard (optional - visual interface)

---

**Phase 4 Complete!** Your sales team now has easy access to export all analysis results as CSV files.

