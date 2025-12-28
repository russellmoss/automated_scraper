# How to Save Export Queries in BigQuery

## Quick Steps

1. **Open BigQuery Console:** https://console.cloud.google.com/bigquery?project=savvy-gtm-analytics
2. **Create Folder:** In left sidebar → "Saved queries" → Create folder → Name: "Savvy Pirate Exports"
3. **For each query below:** Copy SQL → Create new query → Paste → Save with name

---

## Query 1: Export - New Advisors

**Name:** `Export - New Advisors`  
**Description:** `Export new advisors from latest Monday analysis with CRD enrichment`

```sql
-- Copy the entire contents of: big_query/exports/EXPORT_NEW_ADVISORS.sql
```

**Steps:**
1. Click "Compose new query" (+ button)
2. Copy/paste the SQL from `EXPORT_NEW_ADVISORS.sql`
3. Click "Save" → "Save query"
4. Name: `Export - New Advisors`
5. Folder: `Savvy Pirate Exports`
6. Click "Save"

---

## Query 2: Export - On The Move

**Name:** `Export - On The Move`  
**Description:** `Export advisors appearing in multiple recruiter networks`

```sql
-- Copy the entire contents of: big_query/exports/EXPORT_ON_THE_MOVE.sql
```

**Steps:** Same as above, use name `Export - On The Move`

---

## Query 3: Export - CRM Matches

**Name:** `Export - CRM Matches`  
**Description:** `Export advisors matched to existing Salesforce leads/opportunities`

```sql
-- Copy the entire contents of: big_query/exports/EXPORT_CRM_MATCHES.sql
```

**Steps:** Same as above, use name `Export - CRM Matches`

---

## Query 4: Export - Job Changes

**Name:** `Export - Job Changes`  
**Description:** `Export advisors who changed titles or companies`

```sql
-- Copy the entire contents of: big_query/exports/EXPORT_JOB_CHANGES.sql
```

**Steps:** Same as above, use name `Export - Job Changes`

---

## Query 5: Export - Reconstruct Past Scrape

**Name:** `Export - Reconstruct Past Scrape`  
**Description:** `Reconstruct a specific recruiter's scrape from a specific date (edit query to set recruiter name and date)`

```sql
-- Copy the entire contents of: big_query/exports/EXPORT_RECONSTRUCT_SCRAPE.sql
```

**Steps:** Same as above, use name `Export - Reconstruct Past Scrape`

**Note:** This query has placeholders - edit `RECRUITER_NAME_HERE` and `YYYY-MM-DD` before running.

---

## Query 6: Export - Disappeared Connections

**Name:** `Export - Disappeared Connections`  
**Description:** `Export connections that disappeared from recruiter networks`

```sql
-- Copy the entire contents of: big_query/exports/EXPORT_DISAPPEARED_CONNECTIONS.sql
```

**Steps:** Same as above, use name `Export - Disappeared Connections`

---

## Query 7: Dashboard - Weekly Summary

**Name:** `Dashboard - Weekly Summary`  
**Description:** `Summary of all Monday analyses (last 20 runs)`

```sql
-- Copy the entire contents of: big_query/exports/WEEKLY_SUMMARY_DASHBOARD.sql
```

**Steps:** Same as above, use name `Dashboard - Weekly Summary`

---

## Verification

After saving all queries, verify they're accessible:

1. Go to "Saved queries" → "Savvy Pirate Exports" folder
2. You should see all 7 queries listed
3. Click on one to open it
4. Click "Run" to test it
5. Verify it returns data (or 0 rows if expected)

---

## Test Results (From Your Latest Analysis)

Based on your test run, these queries should return:

- **Export - On The Move:** 6 rows ✅
- **Export - CRM Matches:** 3 rows ✅
- **Export - New Advisors:** 0 rows (expected - need 2+ weeks of data)
- **Dashboard - Weekly Summary:** 1 row (your test analysis)

---

## Quick Access Tips

After saving, you can:
- **Pin queries** to the top of the folder for quick access
- **Share folder** with team members
- **Set up scheduled exports** (optional - for automated CSV generation)

---

**All queries are ready to save!** Follow the steps above for each query file.

