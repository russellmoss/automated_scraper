# 📤 Upload These Queries to BigQuery

## Instructions

1. Go to **BigQuery Console** → **Queries** (left sidebar)
2. For each file below, click **"Compose new query"**
3. Copy the SQL from the file
4. Paste into BigQuery
5. Click **"Save"** and give it the name shown below

---

## ✅ Queries to Upload (7 total)

### 1. **01_export_new_advisors.sql**
   - **Save as:** `Export - New Advisors`
   - **Purpose:** List of new advisors found this week with CRD enrichment
   - **When to run:** After Monday analysis

### 2. **02_export_on_the_move.sql**
   - **Save as:** `Export - Advisors On The Move`
   - **Purpose:** Advisors appearing in multiple recruiter networks (strong transition signal)
   - **When to run:** After Monday analysis

### 3. **03_export_crm_matches.sql**
   - **Save as:** `Export - CRM Matches`
   - **Purpose:** Advisors found in recruiter networks who already exist in Salesforce
   - **When to run:** After Monday analysis

### 4. **04_export_job_changes.sql**
   - **Save as:** `Export - Job Changes`
   - **Purpose:** Advisors with title/location changes (likely job transitions)
   - **When to run:** After Monday analysis

### 5. **05_export_reconstruct_scrape.sql**
   - **Save as:** `Export - Reconstruct Past Scrape`
   - **Purpose:** Reconstruct a specific recruiter's scrape from a specific date
   - **Note:** Edit the query to replace `RECRUITER_NAME_HERE` and `YYYY-MM-DD` before running

### 6. **06_export_disappeared_connections.sql**
   - **Save as:** `Export - Disappeared Connections`
   - **Purpose:** Connections that disappeared from recruiter networks
   - **When to run:** Anytime (not dependent on Monday analysis)

### 7. **07_weekly_summary_dashboard.sql**
   - **Save as:** `Dashboard - Weekly Summary`
   - **Purpose:** Overview of all Monday analyses (last 20 runs)
   - **When to run:** Anytime to check analysis history

---

## 🎯 Quick Upload Checklist

- [ ] Export - New Advisors
- [ ] Export - Advisors On The Move
- [ ] Export - CRM Matches
- [ ] Export - Job Changes
- [ ] Export - Reconstruct Past Scrape
- [ ] Export - Disappeared Connections
- [ ] Dashboard - Weekly Summary

---

## 💡 Tips

- After saving, you can **run** any query by clicking it and hitting "Run"
- To **export as CSV**, click "Run" → "Save results" → "CSV (local file)"
- All queries are ready to use except `05_export_reconstruct_scrape.sql` (needs manual editing)

