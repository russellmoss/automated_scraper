# 🏴‍☠️ Savvy Pirate Analytics - BigQuery Edition

LinkedIn recruiter connection intelligence with weekly analysis and CSV exports, powered by BigQuery.

## 🎯 What This Does

1. **Scrapes LinkedIn** (via your existing Chrome Extension)
2. **Stores in BigQuery** (alongside your existing Salesforce/lead scoring data)
3. **Runs Monday Analysis** (scheduled query finds new advisors + advisors on the move)
4. **Generates CSV Reports** (download for your sales team)

## 📊 Your Weekly Monday Workflow

Every Monday at 6 AM ET, the scheduled query runs and:
1. **Determines active group** - Is this a 1st/3rd week (Group 1) or 2nd/4th week (Group 2)?
2. **Compares 2-week periods** - Current vs previous for that group's recruiters
3. **Finds new advisors** - People who just appeared in recruiter networks
4. **Detects movement** - Advisors in 2+ recruiter networks (actively looking)
5. **Saves results** - Ready for CSV export

Then you:
1. Open BigQuery console
2. Run the export queries
3. Download CSVs
4. Send to sales team

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    SAVVY PIRATE (BIGQUERY)                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌───────────────────────────────────────┐  │
│  │   Chrome     │────▶│         Cloud Function               │  │
│  │  Extension   │     │   (receives scraped profiles)        │  │
│  └──────────────┘     └───────────────┬───────────────────────┘  │
│         │                             │                          │
│         │                             ▼                          │
│         │             ┌───────────────────────────────────────┐  │
│         │             │            BigQuery                   │  │
│         │             │  ┌─────────────────────────────────┐  │  │
│         │             │  │ Tables:                         │  │  │
│         │             │  │  • recruiters                   │  │  │
│         │             │  │  • advisors                     │  │  │
│         │             │  │  • connections                  │  │  │
│         │             │  │  • scrape_runs                  │  │  │
│         │             │  │  • weekly_analyses              │  │  │
│         │             │  │  • new_advisor_reports          │  │  │
│         │             │  │  • advisor_movement_alerts      │  │  │
│         │             │  └─────────────────────────────────┘  │  │
│         │             │                                       │  │
│         ▼             │  ┌─────────────────────────────────┐  │  │
│  ┌──────────────┐     │  │ Scheduled Query:               │  │  │
│  │Google Sheets │     │  │  Monday 6 AM ET                │  │  │
│  │   (backup)   │     │  │  → Weekly Analysis             │  │  │
│  └──────────────┘     │  └─────────────────────────────────┘  │  │
│                       └───────────────────────────────────────┘  │
│                                       │                          │
│                                       ▼                          │
│                       ┌───────────────────────────────────────┐  │
│                       │           CSV Exports                 │  │
│                       │  • new_advisors_YYYY-MM-DD.csv       │  │
│                       │  • on_the_move_YYYY-MM-DD.csv        │  │
│                       └───────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Setup Guide

### Prerequisites
- Google Cloud project (you already have this for BigQuery)
- BigQuery access
- Your existing Chrome extension

### Step 1: Create BigQuery Dataset

1. Open [BigQuery Console](https://console.cloud.google.com/bigquery)
2. Click your project
3. Run the SQL in `sql/001_schema.sql`
4. Replace `YOUR_PROJECT_ID` with your actual project ID first!

```bash
# Or use bq command line:
bq query --use_legacy_sql=false < sql/001_schema.sql
```

### Step 2: Import Your Recruiters

After the schema is created, import your recruiters from the Mapping and Schedules CSV.

**Option A: BigQuery Console**
1. Click on `savvy_pirate.recruiters` table
2. Click "Edit Schema" if needed
3. Upload your CSV

**Option B: Use the import query**
```sql
-- First upload your CSV to Cloud Storage, then:
LOAD DATA INTO `YOUR_PROJECT_ID.savvy_pirate.recruiters`
FROM FILES (
  format = 'CSV',
  uris = ['gs://your-bucket/Savvy_Pirate_Command_and_Control_-_Mapping_and_Schedules.csv']
);
```

**Option C: Manual Insert** (for 29 recruiters, this is easiest)

Here's a query based on your actual data:

```sql
-- Insert your recruiters
INSERT INTO `YOUR_PROJECT_ID.savvy_pirate.recruiters`
(id, name, company, title, frequency, output_sheet_url, is_active, created_at, updated_at)
VALUES
-- Group 1: 1st & 3rd week of month
(GENERATE_UUID(), 'Louis Diamond', 'Diamond Consultants', 'CEO', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/19kTNLaDim8abDqNPclT2BLz7flSgkVL0Pl-oM828y74', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Jeff Nash', 'Bridgemark Strategies', 'CEO & Co-Founder', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1zN33DnhWAiB4owxnDn_bjYpGcw-O23aZlGQkPtu5U2I', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Jesse Papike', 'Cross-Search', 'President & Managing Partner', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1M1ligL-6Kqp4jYi46fsEbWtUx3ibM8rdxRyeMBCIpxM', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Patrick Kelly', 'Willis Consulting', 'President', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1gzhH8o_VYjnD2bsIbW9oj9Qsl7bxmmJgNzJi6xU5Vjc', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Jon Bartick', 'StevenDouglas', 'Director, Wealth Management Search', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1-HaVM-QBaUv2aGQa9lS4-F3pX1BYwSdohHE9oY5eLyE', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Matt DuToit', 'WealthRight', 'Founder', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1534k10S3JqBP8MDCjDNUecnNC-PvxLgQFI6x7DBVeLQ', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Thor Gould', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1kTRFnXJhjBV2_YLIShl0alPNFvspHzl3ucrIZkG2Jhw', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Sam Briganti', 'Successful OnBoarding', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1IPauSbctqtT_IDZq7SMXFt4jE_JTTFd-4qLuQFTaaO4', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Taylor Newman', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1X6GMt_tsdoO2bc2Az28VI6z8umOyJuUM5s2gfvHgQY8', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Kate Little', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1VmVeloKbzYQgTvZC9hjyaGlLzzp-Zd_vnhHjgjYJRcU', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Mina Consarino', 'Independent / Firm Unconfirmed', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1XsBb3L65EW3i2p8s4rGC7If9fogObuMddkNKTVjhX5Q', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Kaitlin Wickenheiser', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1wz2WniaLSYnO9nPzAwmJKVeRpbFzreTb2VOKCTKbFNo', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Kaely Ferguson', 'Farther', 'Recruiter', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1JLpNWXWpaY3GgbF-t8XBoEiw3tKGA8OEMCcMeoc50Ww', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Julianna King', 'Windward Recruiting', 'Director of Operations | Recruitment', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1ETjX9eKGyHESKy9N1orkhbKtKHNrRpc075uhO80tM1w', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Kristy Puckett', 'RFG Advisory', 'Financial Advisor Advocate', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1bpPb5xbI4mbydCVJQU8AnNNyuClbP74D4f2GN-ss5xo', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Sean Lindenbaum', 'Dynasty Financial Partners', 'Director, Business Development', '1st_3rd_week', 'https://docs.google.com/spreadsheets/d/1-TE8PXv59pMZ5qBNy3gGVLKggqqmpqBf1oEUnLzK21c', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),

-- Group 2: 2nd & 4th week of month
(GENERATE_UUID(), 'Michael Terrana', 'Terrana Group', 'President & CEO', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1kQzFIzRj17LJoCBYHqZuJwtDigXSrooUpybLbjyggwg', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Jodie Papike Sladavic', 'Cross-Search', 'CEO & Managing Partner', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1CFoZ1khxKr3ZmFAjg5cA3mbkcmEeUmyucOoE4nXQ730', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Taylor Matthews', 'Farther', 'Co-Founder & CEO', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1Sr6m9opYBMI_3cZCmFV3KhDg8gnRe0hZJ12UuD7usx4', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Stacey Frank', 'Elite Consulting Partners', 'Vice President', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1n1V0UkNepiQjc-uogkFbciMPUhA48U9rV3e-R8aWVtM', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Michael McGahey', 'StevenDouglas', 'Director, Wealth Management Search', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1v1e1Khwx-u8YgvJllqoqhCHrClY7PFWZZGgAZSm5HtY', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Megan Bailey', 'Farther', 'Wealth Management', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Scott Briganti', 'Successful OnBoarding', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1MdeGJtYae-rH9HUwB17AYKG3hcPVXJjpsrbahoZHOCc', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Morgan Cirotto', 'Farther', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1ks-IMVWfgjLQlbfGwCIhHmZPjyRdz79MB2cxnimDMUw', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Nicole Owens', 'Farther', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/14mSYDy7CcrDDQKVvpColxReawm7-NDrZJopJO69j62w', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Kylie Leone', 'Farther', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1VcEnfXYLQ56nIvK4EgupTj-LzWvXrz80-Db8WKle1sw', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Rachel Schuyler', 'Farther', 'Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1IX8r76KaYwSMCXbpmCJnf0TuuoCIhChAs6DqM5TKkHU', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Frank LaRosa', 'Elite Consulting Partners', 'CEO of Elite Consulting Partners', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1QIPvgiNwrb4ukQSD744DOHtO9kdyZchikwoR_HB5wpc', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()),
(GENERATE_UUID(), 'Simon Hoyle', 'RIAChoice', 'Hybrid Advisor Recruiter', '2nd_4th_week', 'https://docs.google.com/spreadsheets/d/1ZKJ78cJPAqh7b7jLvo-8eUjGb7D69i1LkTH_qTp4hFA', true, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP());
```

### Step 3: Deploy Cloud Function

```bash
cd cloud-functions/savvy-pirate-sync

# Update index.js with your PROJECT_ID
# Then deploy:
gcloud functions deploy savvy-pirate-sync \
  --runtime nodejs18 \
  --trigger-http \
  --allow-unauthenticated \
  --region us-central1 \
  --project YOUR_PROJECT_ID
```

Note the function URL (like `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/savvy-pirate-sync`)

### Step 4: Schedule the Monday Analysis

1. Go to BigQuery Console
2. Click "Scheduled queries" in the left menu
3. Click "Create scheduled query"
4. Paste the contents of `sql/002_monday_analysis_scheduled_query.sql`
5. Replace `YOUR_PROJECT_ID` with your actual project ID
6. Configure:
   - **Name**: Savvy Pirate Weekly Analysis
   - **Schedule**: Every Monday at 06:00 (America/New_York)
   - **Processing location**: US (or your region)

### Step 5: Update Chrome Extension

1. Copy `chrome-extension-integration/bigquery_sync.js` to your extension's `background/` folder

2. Update the `CLOUD_FUNCTION_URL` in the file:
```javascript
const CLOUD_FUNCTION_URL = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/savvy-pirate-sync';
```

3. In your `service_worker.js`, add the sync:
```javascript
import { syncProfilesToBigQuery, isConfigured } from './bigquery_sync.js';

// After syncing to Google Sheets, add:
if (isConfigured()) {
    try {
        await syncProfilesToBigQuery(profiles, recruiterId, recruiterName, searchType);
    } catch (e) {
        console.error('[SW] BigQuery sync failed:', e);
    }
}
```

4. Update `manifest.json` host_permissions:
```json
"host_permissions": [
    "https://*.linkedin.com/*",
    "https://sheets.googleapis.com/*",
    "https://www.googleapis.com/*",
    "https://*.cloudfunctions.net/*"
]
```

---

## 📥 Getting Your Monday CSVs

Every Monday after 6 AM ET:

### 1. Open BigQuery Console

### 2. Run the New Advisors Export Query
```sql
SELECT
  advisor_name AS `Advisor Name`,
  title AS `Title`,
  location AS `Location`,
  linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(accreditations, '; ') AS `Accreditations`,
  recruiter_name AS `Found By Recruiter`,
  search_type AS `Search Type`,
  CAST(first_seen_date AS STRING) AS `First Seen Date`
FROM `YOUR_PROJECT_ID.savvy_pirate.new_advisor_reports`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `YOUR_PROJECT_ID.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY recruiter_name, advisor_name;
```

### 3. Save as CSV
- Click "Save Results"
- Choose "CSV (local file)"
- Name it `new_advisors_2025-01-27.csv`

### 4. Run the Advisors on the Move Query
```sql
SELECT
  advisor_name AS `Advisor Name`,
  title AS `Title`,
  location AS `Location`,
  linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(accreditations, '; ') AS `Accreditations`,
  recruiter_count AS `Number of Recruiters`,
  severity AS `Severity`,
  ARRAY_TO_STRING(recruiter_names, ', ') AS `Recruiter Names`,
  CAST(first_appearance AS STRING) AS `First Appearance`,
  CAST(latest_appearance AS STRING) AS `Latest Appearance`,
  why_flagged AS `Why Flagged`
FROM `YOUR_PROJECT_ID.savvy_pirate.advisor_movement_alerts`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `YOUR_PROJECT_ID.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY recruiter_count DESC, advisor_name;
```

### 5. Save as CSV
- Name it `advisors_on_move_2025-01-27.csv`

### 6. Send to Sales Team! 🎉

---

## 📊 Joining with Salesforce Data

One of the big advantages of using BigQuery is you can join this data with your Salesforce data!

Example: Find advisors on the move who are NOT already in your CRM:
```sql
SELECT 
  m.advisor_name,
  m.title,
  m.linkedin_url,
  m.recruiter_count,
  m.why_flagged
FROM `YOUR_PROJECT_ID.savvy_pirate.advisor_movement_alerts` m
LEFT JOIN `YOUR_PROJECT_ID.salesforce.contacts` sf 
  ON LOWER(m.linkedin_url) = LOWER(sf.linkedin_url)
WHERE m.analysis_date = CURRENT_DATE()
  AND sf.id IS NULL  -- Not in Salesforce
ORDER BY m.recruiter_count DESC;
```

---

## 🔧 Troubleshooting

### Scheduled query not running
1. Check scheduled query logs in BigQuery
2. Verify timezone is set to America/New_York
3. Check if query has syntax errors

### Cloud Function errors
1. Check Cloud Function logs in GCP Console
2. Verify BigQuery permissions for the service account
3. Test with `curl`:
```bash
curl -X POST https://YOUR_FUNCTION_URL \
  -H "Content-Type: application/json" \
  -d '{"action": "test_connection", "data": {}}'
```

### No data in analysis
1. Make sure scrapes are syncing to BigQuery (check connections table)
2. Verify recruiter frequency values match ("1st_3rd_week" or "2nd_4th_week")
3. Check the week calculation function

---

## 📋 Quick Reference

| Table | Purpose |
|-------|---------|
| `recruiters` | The 29 people whose connections you monitor |
| `advisors` | All financial advisors discovered |
| `connections` | Junction table: when advisor was seen in recruiter's network |
| `scrape_runs` | Log of each scraping execution |
| `weekly_analyses` | Summary of each Monday analysis |
| `new_advisor_reports` | Detailed new advisor data per analysis |
| `advisor_movement_alerts` | Advisors in 2+ networks with explanations |

| Frequency | Week of Month | Recruiters |
|-----------|---------------|------------|
| `1st_3rd_week` | 1, 3 | 16 people |
| `2nd_4th_week` | 2, 4 | 13 people |

---

**Built for LinkedIn Competitive Intelligence** 🏴‍☠️
