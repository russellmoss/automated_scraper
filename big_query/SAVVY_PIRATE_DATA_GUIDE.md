# 🏴‍☠️ Savvy Pirate BigQuery Data Guide

**Complete Reference for Querying the Savvy Pirate Competitive Intelligence System**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Database Overview](#2-database-overview)
3. [Table Reference](#3-table-reference)
4. [Views Reference](#4-views-reference)
5. [User-Defined Functions (UDFs)](#5-user-defined-functions-udfs)
6. [Business Use Cases & Queries](#6-business-use-cases--queries)
7. [Existing SQL Files Reference](#7-existing-sql-files-reference)
8. [Query Patterns & Best Practices](#8-query-patterns--best-practices)
9. [Example Workflows](#9-example-workflows)
10. [Quick Reference Card](#10-quick-reference-card)

---

## 1. Executive Summary

### What is Savvy Pirate?

Savvy Pirate is a competitive intelligence system that monitors financial advisor networks on LinkedIn through recruiter connections. By tracking which advisors appear in which recruiter networks over time, we can identify:

- **New leads** - Advisors we haven't seen before
- **"On the move" advisors** - Advisors appearing in multiple recruiter networks (strong transition signal)
- **Job changes** - Advisors who changed titles or locations
- **CRM re-engagement opportunities** - Advisors who match existing Salesforce leads/opportunities

### What Data Do We Collect?

The system automatically scrapes LinkedIn connections from 29 active recruiters, tracking:

- **Advisor profiles** - Name, title, location, accreditations, LinkedIn URL
- **Connection relationships** - Which advisors are connected to which recruiters
- **Historical snapshots** - Point-in-time observations from each scrape
- **Enrichment data** - FINTRX CRD numbers, firm AUM, producing advisor status
- **CRM matches** - Links to existing Salesforce leads and opportunities

### Key Business Questions This Data Answers

1. **Who are the new advisors we should reach out to?**
   - Query: `new_advisor_reports` table or use export query `01_export_new_advisors.sql`

2. **Which advisors are "on the move" (strong transition signal)?**
   - Query: `advisor_movement_alerts` table or use export query `02_export_on_the_move.sql`

3. **Which advisors match our existing CRM records?**
   - Query: `crm_match_results` table or use export query `03_export_crm_matches.sql`

4. **Which advisors changed jobs recently?**
   - Query: `advisor_job_changes` table or use export query `04_export_job_changes.sql`

5. **What's the network growth trend for each recruiter?**
   - Query: `v_scrape_history` view

6. **Which advisors have CRD numbers (registered RIAs)?**
   - Query: `v_advisors_with_crd` view

---

## 2. Database Overview

### Project & Dataset

- **Project:** `savvy-gtm-analytics`
- **Dataset:** `savvy_pirate`
- **Region:** `northamerica-northeast2` (Toronto, Canada)
- **Full Path:** `savvy-gtm-analytics.savvy_pirate`

### Table Relationships Diagram

```
┌─────────────┐
│ recruiters  │ (29 rows)
│             │
│ id (PK)     │
│ name        │
│ frequency   │
└──────┬──────┘
       │
       │ 1:N
       │
┌──────▼──────┐
│  searches   │ (261 rows)
│             │
│ id (PK)     │
│ recruiter_id│──FK──┐
│ target_job  │      │
└─────────────┘      │
                     │
       ┌─────────────┘
       │
       │ N:M
       │
┌──────▼──────┐      ┌──────────────┐
│ connections │      │   advisors   │ (26,349 rows)
│             │      │              │
│ id (PK)     │      │ id (PK)      │
│ advisor_id  │──FK──│ linkedin_url │
│ recruiter_id│──FK──│ name         │
│ first_seen  │      │ current_title│
└─────────────┘      └──────────────┘
       │
       │
┌──────▼──────────────────┐
│ connection_observations │ (77,602 rows)
│                         │
│ id (PK)                  │
│ advisor_id (FK)          │
│ recruiter_id (FK)        │
│ observed_at              │
│ advisor_name             │
│ advisor_title            │
│ advisor_linkedin_url     │
└──────────────────────────┘
       │
       │
┌──────▼──────────────┐
│   scrape_runs       │ (90 rows)
│                     │
│ id (PK)             │
│ recruiter_id (FK)   │
│ started_at          │
│ status              │
└─────────────────────┘

ANALYSIS TABLES (populated by Monday analysis):
┌─────────────────────┐
│ weekly_analyses     │
│ new_advisor_reports │
│ advisor_movement_   │
│   alerts            │
│ crm_match_results   │
│ advisor_job_changes │
└─────────────────────┘
```

### Data Flow

1. **Chrome Extension** scrapes LinkedIn → sends to **Apps Script Web App**
2. **Apps Script** writes to BigQuery:
   - `advisors` (deduplicated)
   - `connections` (many-to-many relationships)
   - `connection_observations` (point-in-time snapshots)
   - `scrape_runs` (execution log)
3. **Monday Analysis** (scheduled query) processes data → populates analysis tables
4. **Export queries** generate CSV files for sales team
5. **Views** provide enriched data (CRD matches, CRM matches, etc.)

---

## 3. Table Reference

### 3.1 recruiters

**Purpose:** Master list of recruiters whose LinkedIn networks we monitor. Each recruiter has a scraping frequency (1st/3rd week or 2nd/4th week of each month).

**Row Count:** 29 (as of Dec 28, 2024)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique recruiter ID (format: `rec_{md5_hash}`) |
| `name` | STRING | Recruiter's full name |
| `linkedin_url` | STRING | LinkedIn profile URL (nullable) |
| `company` | STRING | Recruiter's company name |
| `title` | STRING | Recruiter's job title |
| `frequency` | STRING | Scraping frequency: `'1st_3rd_week'` or `'2nd_4th_week'` |
| `output_sheet_url` | STRING | Google Sheets URL where scrape results are written |
| `output_sheet_id` | STRING | Google Sheets ID |
| `is_active` | BOOLEAN | Whether this recruiter is actively being scraped |
| `created_at` | TIMESTAMP | When record was created |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Relationships:**
- `searches.recruiter_id` → `recruiters.id`
- `connections.recruiter_id` → `recruiters.id`
- `scrape_runs.recruiter_id` → `recruiters.id`

**Example Data:**
```
id: rec_477d828c44c9e6253f039ddbd0bfb129
name: Jeff Nash
company: Bridgemark Strategies
title: CEO & Co-Founder
frequency: 1st_3rd_week
is_active: true
```

**Common Queries:**

```sql
-- Get all active recruiters
SELECT name, company, frequency, output_sheet_url
FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
WHERE is_active = TRUE
ORDER BY name;

-- Count recruiters by frequency
SELECT frequency, COUNT(*) as count
FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
WHERE is_active = TRUE
GROUP BY frequency;
```

---

### 3.2 searches

**Purpose:** LinkedIn search URLs for each recruiter. Each recruiter has 9 searches (one for each target job title: Financial Advisor, Wealth Advisor, etc.).

**Row Count:** 261 (29 recruiters × 9 searches)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique search ID |
| `recruiter_id` | STRING | Foreign key to `recruiters.id` |
| `recruiter_name` | STRING | Denormalized recruiter name |
| `target_job_title` | STRING | Job title being searched (e.g., "Financial Advisor") |
| `linkedin_search_url` | STRING | Full LinkedIn search URL |
| `is_active` | BOOLEAN | Whether this search is active |
| `created_at` | TIMESTAMP | When record was created |

**Relationships:**
- `searches.recruiter_id` → `recruiters.id`
- `connection_observations.search_id` → `searches.id`

**Example Data:**
```
id: search_abc123
recruiter_id: rec_477d828c44c9e6253f039ddbd0bfb129
recruiter_name: Jeff Nash
target_job_title: Financial Advisor
linkedin_search_url: https://www.linkedin.com/search/results/people/...
is_active: true
```

**Common Queries:**

```sql
-- Get all searches for a specific recruiter
SELECT target_job_title, linkedin_search_url
FROM `savvy-gtm-analytics.savvy_pirate.searches`
WHERE recruiter_id = 'rec_477d828c44c9e6253f039ddbd0bfb129'
  AND is_active = TRUE
ORDER BY target_job_title;

-- Count searches per recruiter
SELECT recruiter_name, COUNT(*) as search_count
FROM `savvy-gtm-analytics.savvy_pirate.searches`
WHERE is_active = TRUE
GROUP BY recruiter_name
ORDER BY search_count DESC;
```

---

### 3.3 advisors

**Purpose:** Master table of all financial advisors discovered through LinkedIn scraping. Each advisor has a unique record regardless of how many recruiters they're connected to.

**Row Count:** 26,349 (as of Dec 28, 2024)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique UUID for this advisor |
| `linkedin_url` | STRING | Normalized LinkedIn profile URL |
| `linkedin_id` | STRING | LinkedIn slug (e.g., "john-doe-12345") |
| `name` | STRING | Full name |
| `current_title` | STRING | Most recent job title observed |
| `current_location` | STRING | Most recent location observed |
| `accreditations` | ARRAY<STRING> | Credentials (CFP®, CFA, CIMA®, etc.) |
| `first_seen_at` | TIMESTAMP | When we first discovered this advisor |
| `last_seen_at` | TIMESTAMP | Most recent sighting |
| `times_seen` | INTEGER | How many times seen across all scrapes |
| `created_at` | TIMESTAMP | When record was created |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Relationships:**
- `connections.advisor_id` → `advisors.id`
- `connection_observations.advisor_id` → `advisors.id` (via view matching)

**Example Data:**
```
id: 177b7fe9-3e4f-4a72-b433-e8c3566ffcd5
name: Gregory Hughes
linkedin_url: https://www.linkedin.com/in/gregory-hughes-awma®-16665625
linkedin_id: gregory-hughes-awma®-16665625
current_title: Co-Founder
current_location: Greater Boston
accreditations: ["AWMA®"]
first_seen_at: 2025-12-28 21:41:46 UTC
last_seen_at: 2025-12-29 00:20:43 UTC
times_seen: 12
```

**Common Queries:**

```sql
-- Find CFP® holders
SELECT name, current_title, linkedin_url, current_location
FROM `savvy-gtm-analytics.savvy_pirate.advisors`
WHERE 'CFP®' IN UNNEST(accreditations)
ORDER BY last_seen_at DESC
LIMIT 100;

-- Find advisors by location
SELECT name, current_title, linkedin_url
FROM `savvy-gtm-analytics.savvy_pirate.advisors`
WHERE current_location LIKE '%California%'
ORDER BY last_seen_at DESC;

-- Most frequently seen advisors
SELECT name, current_title, times_seen, last_seen_at
FROM `savvy-gtm-analytics.savvy_pirate.advisors`
ORDER BY times_seen DESC
LIMIT 50;
```

---

### 3.4 connections

**Purpose:** Many-to-many relationship table linking advisors to recruiters. Tracks when each advisor first appeared in each recruiter's network.

**Row Count:** 38,708 (as of Dec 28, 2024)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique connection ID |
| `advisor_id` | STRING | Foreign key to `advisors.id` |
| `recruiter_id` | STRING | Foreign key to `recruiters.id` |
| `first_seen_date` | DATE | First date this advisor appeared in this recruiter's network |
| `last_seen_date` | DATE | Most recent date seen in this network |
| `search_type` | STRING | Which job title search found them (nullable) |
| `scrape_run_id` | STRING | Which scrape run created this connection (nullable) |
| `created_at` | TIMESTAMP | When record was created |

**Relationships:**
- `connections.advisor_id` → `advisors.id`
- `connections.recruiter_id` → `recruiters.id`

**Example Data:**
```
id: 6b95043a-d7b3-42fa-9633-2059d8fa4876
advisor_id: 5727273c-c151-40b1-b7f5-133fe0b11b17
recruiter_id: rec_f42a9bda07f38ca2096a523ef6ece607
first_seen_date: 2025-12-29
last_seen_date: 2025-12-29
search_type: null
```

**Common Queries:**

```sql
-- Find advisors connected to multiple recruiters (on the move)
SELECT 
  a.name,
  a.current_title,
  COUNT(DISTINCT c.recruiter_id) as recruiter_count,
  ARRAY_AGG(DISTINCT r.name) as recruiter_names
FROM `savvy-gtm-analytics.savvy_pirate.connections` c
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON c.advisor_id = a.id
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
GROUP BY a.id, a.name, a.current_title
HAVING COUNT(DISTINCT c.recruiter_id) >= 2
ORDER BY recruiter_count DESC;

-- Find all connections for a specific recruiter
SELECT 
  a.name,
  a.current_title,
  a.linkedin_url,
  c.first_seen_date
FROM `savvy-gtm-analytics.savvy_pirate.connections` c
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON c.advisor_id = a.id
WHERE c.recruiter_id = 'rec_477d828c44c9e6253f039ddbd0bfb129'
ORDER BY c.first_seen_date DESC;
```

---

### 3.5 connection_observations

**Purpose:** Point-in-time snapshots from each scrape. This is the raw observation data - every time we see an advisor in a recruiter's network, we record it here. This table uses streaming inserts and has a 90-minute buffer delay for updates.

**Row Count:** 77,602 (as of Dec 28, 2024)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique observation ID |
| `scrape_run_id` | STRING | Which scrape run this observation belongs to |
| `recruiter_id` | STRING | Foreign key to `recruiters.id` |
| `advisor_id` | STRING | Foreign key to `advisors.id` (may be hash ID for recent rows) |
| `search_id` | STRING | Which search found this advisor |
| `observed_at` | TIMESTAMP | Exact timestamp when this observation was made |
| `advisor_name` | STRING | Name as seen in LinkedIn (denormalized) |
| `advisor_title` | STRING | Title as seen in LinkedIn (denormalized) |
| `advisor_location` | STRING | Location as seen in LinkedIn (denormalized) |
| `advisor_linkedin_url` | STRING | LinkedIn URL as seen (denormalized) |
| `search_job_title` | STRING | Which job title search found them |
| `created_at` | TIMESTAMP | When record was created |

**⚠️ Important:** Due to BigQuery streaming buffer limitations, `advisor_id` in this table may be a hash ID (format: `adv_*`) for rows inserted in the last ~90 minutes. **Always use `v_observations_with_advisors` view** for queries to get correct UUID `advisor_id` values.

**Relationships:**
- `connection_observations.recruiter_id` → `recruiters.id`
- `connection_observations.advisor_id` → `advisors.id` (via view matching)

**Example Data:**
```
id: obs_abc123
scrape_run_id: run_xyz789
recruiter_id: rec_477d828c44c9e6253f039ddbd0bfb129
advisor_id: 177b7fe9-3e4f-4a72-b433-e8c3566ffcd5
observed_at: 2025-12-29 00:20:43 UTC
advisor_name: Gregory Hughes
advisor_title: Co-Founder
advisor_location: Greater Boston
advisor_linkedin_url: https://www.linkedin.com/in/gregory-hughes-awma®-16665625
search_job_title: Financial Advisor
```

**Common Queries:**

```sql
-- ⚠️ ALWAYS use the view for correct advisor_id matching
-- Reconstruct a specific scrape (use v_observations_with_advisors)
SELECT 
  advisor_name,
  advisor_title,
  advisor_location,
  advisor_linkedin_url,
  search_job_title,
  observed_at
FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`
WHERE recruiter_id = 'rec_477d828c44c9e6253f039ddbd0bfb129'
  AND DATE(observed_at) = DATE('2025-12-28')
ORDER BY observed_at;

-- Count observations per recruiter
SELECT 
  r.name as recruiter_name,
  COUNT(*) as observation_count,
  COUNT(DISTINCT DATE(o.observed_at)) as scrape_days
FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON o.recruiter_id = r.id
GROUP BY r.name
ORDER BY observation_count DESC;
```

---

### 3.6 scrape_runs

**Purpose:** Execution log for each scrape. Tracks when scrapes started, completed, and their status.

**Row Count:** 90 (as of Dec 28, 2024)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique scrape run ID |
| `recruiter_id` | STRING | Foreign key to `recruiters.id` |
| `recruiter_name` | STRING | Denormalized recruiter name |
| `started_at` | TIMESTAMP | When scrape started |
| `completed_at` | TIMESTAMP | When scrape completed (nullable) |
| `status` | STRING | Status: `'running'`, `'completed'`, `'partial'`, `'failed'` |
| `profiles_scraped` | INTEGER | Number of profiles found |
| `new_connections_found` | INTEGER | Number of new connections (not yet implemented) |
| `searches_completed` | INTEGER | Number of searches completed (out of 9) |
| `total_searches` | INTEGER | Total searches (usually 9) |
| `error_message` | STRING | Error message if failed (nullable) |
| `scrape_week` | DATE | Which week this scrape belongs to |
| `week_of_month` | INTEGER | Week number (1-4) |
| `created_at` | TIMESTAMP | When record was created |

**Relationships:**
- `scrape_runs.recruiter_id` → `recruiters.id`
- `connection_observations.scrape_run_id` → `scrape_runs.id`

**Example Data:**
```
id: run_xyz789
recruiter_id: rec_477d828c44c9e6253f039ddbd0bfb129
recruiter_name: Jeff Nash
started_at: 2025-12-28 20:00:00 UTC
completed_at: 2025-12-28 20:01:00 UTC
status: completed
profiles_scraped: 110
new_connections_found: 0
searches_completed: 9
total_searches: 9
```

**Common Queries:**

```sql
-- Recent scrape activity
SELECT 
  DATE(started_at) as scrape_date,
  recruiter_name,
  status,
  profiles_scraped,
  searches_completed,
  TIMESTAMP_DIFF(completed_at, started_at, MINUTE) as duration_minutes
FROM `savvy-gtm-analytics.savvy_pirate.scrape_runs`
WHERE started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
ORDER BY started_at DESC;

-- Scrape success rate by recruiter
SELECT 
  recruiter_name,
  COUNT(*) as total_scrapes,
  COUNTIF(status = 'completed') as completed_scrapes,
  ROUND(COUNTIF(status = 'completed') * 100.0 / COUNT(*), 1) as success_rate_pct,
  AVG(profiles_scraped) as avg_profiles_per_scrape
FROM `savvy-gtm-analytics.savvy_pirate.scrape_runs`
GROUP BY recruiter_name
ORDER BY success_rate_pct DESC;
```

---

### 3.7 weekly_analyses

**Purpose:** Summary of each Monday analysis run. Tracks which frequency group was analyzed and the results.

**Row Count:** 0 (populated by scheduled Monday analysis)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique analysis ID |
| `analysis_date` | DATE | Date analysis was run (usually Monday) |
| `frequency_group` | STRING | Which frequency group: `'1st_3rd_week'` or `'2nd_4th_week'` |
| `current_period_start` | DATE | Start of current analysis period |
| `current_period_end` | DATE | End of current analysis period |
| `previous_period_start` | DATE | Start of previous period (for comparison) |
| `previous_period_end` | DATE | End of previous period |
| `total_new_advisors` | INTEGER | Number of new advisors found |
| `total_advisors_on_move` | INTEGER | Number of advisors in 2+ networks |
| `total_crm_matches` | INTEGER | Number of CRM matches found |
| `recruiters_analyzed` | INTEGER | Number of recruiters analyzed |
| `status` | STRING | Status: `'running'`, `'completed'`, `'failed'` |
| `created_at` | TIMESTAMP | When record was created |

**Common Queries:**

```sql
-- Latest analysis results
SELECT 
  analysis_date,
  frequency_group,
  total_new_advisors,
  total_advisors_on_move,
  total_crm_matches,
  status
FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
ORDER BY analysis_date DESC
LIMIT 10;
```

---

### 3.8 new_advisor_reports

**Purpose:** New advisors discovered in each weekly analysis. This is the primary export for sales outreach.

**Row Count:** 0 (populated by Monday analysis)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique report ID |
| `analysis_id` | STRING | Foreign key to `weekly_analyses.id` |
| `analysis_date` | DATE | Date of analysis |
| `advisor_id` | STRING | Foreign key to `advisors.id` |
| `advisor_name` | STRING | Advisor name |
| `linkedin_url` | STRING | LinkedIn URL |
| `title` | STRING | Job title |
| `location` | STRING | Location |
| `accreditations` | ARRAY<STRING> | Credentials |
| `recruiter_id` | STRING | Which recruiter found them |
| `recruiter_name` | STRING | Recruiter name |
| `search_type` | STRING | Which search found them |
| `first_seen_date` | DATE | When first seen |
| `created_at` | TIMESTAMP | When record was created |

**Common Queries:**

```sql
-- Export new advisors (use existing query: 01_export_new_advisors.sql)
-- This query includes CRD enrichment
SELECT
  nar.advisor_name,
  nar.title,
  nar.location,
  nar.linkedin_url,
  ARRAY_TO_STRING(nar.accreditations, '; ') AS accreditations,
  nar.recruiter_name,
  ea.crd_number,
  ea.lead_priority
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

---

### 3.9 advisor_movement_alerts

**Purpose:** Advisors appearing in 2+ recruiter networks (strong transition signal). This is a key indicator of advisors "on the move."

**Row Count:** 0 (populated by Monday analysis)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique alert ID |
| `analysis_date` | DATE | Date of analysis |
| `advisor_id` | STRING | Foreign key to `advisors.id` |
| `advisor_name` | STRING | Advisor name |
| `linkedin_url` | STRING | LinkedIn URL |
| `title` | STRING | Job title |
| `location` | STRING | Location |
| `accreditations` | ARRAY<STRING> | Credentials |
| `recruiter_count` | INTEGER | Number of recruiters they appear in |
| `severity` | STRING | `'critical'` (4+), `'high'` (3), `'normal'` (2) |
| `recruiter_names` | ARRAY<STRING> | List of recruiter names |
| `timeline_json` | STRING | JSON timeline of appearances (nullable) |
| `first_appearance` | DATE | First date seen in any network |
| `latest_appearance` | DATE | Most recent appearance |
| `days_between_first_last` | INTEGER | Days between first and last |
| `why_flagged` | STRING | Reason for flagging |
| `created_at` | TIMESTAMP | When record was created |

**Common Queries:**

```sql
-- Export advisors on the move (use existing query: 02_export_on_the_move.sql)
SELECT
  advisor_name,
  title,
  location,
  linkedin_url,
  recruiter_count,
  severity,
  ARRAY_TO_STRING(recruiter_names, ' → ') AS recruiter_trail,
  first_appearance,
  latest_appearance,
  days_between_first_last
FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY recruiter_count DESC, advisor_name;
```

---

### 3.10 crm_match_results

**Purpose:** Advisors who match existing Salesforce leads or opportunities. Used for re-engagement opportunities.

**Row Count:** 0 (populated by Monday analysis)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique match ID |
| `analysis_date` | DATE | Date of analysis |
| `advisor_id` | STRING | Foreign key to `advisors.id` |
| `advisor_name` | STRING | Advisor name |
| `advisor_linkedin_url` | STRING | LinkedIn URL |
| `match_type` | STRING | `'lead'` or `'opportunity'` |
| `match_confidence` | STRING | `'exact_url'` or `'fuzzy_name'` |
| `lead_id` | STRING | Salesforce Lead ID (if matched) |
| `lead_name` | STRING | Lead name |
| `lead_status` | STRING | Lead status |
| `lead_owner_name` | STRING | Lead owner |
| `lead_disposition` | STRING | Disposition |
| `lead_closed_lost_reason` | STRING | Closed lost reason |
| `opportunity_id` | STRING | Salesforce Opportunity ID (if matched) |
| `opportunity_name` | STRING | Opportunity name |
| `opportunity_stage` | STRING | Opportunity stage |
| `opportunity_owner_name` | STRING | Opportunity owner |
| `opportunity_closed_lost_reason` | STRING | Closed lost reason |
| `opportunity_amount` | FLOAT | Opportunity amount |
| `found_via` | STRING | How advisor was found |
| `recruiter_names` | ARRAY<STRING> | Recruiters who found them |
| `first_seen_date` | DATE | When first seen |
| `alert_priority` | STRING | `'high'` or `'medium'` |
| `suggested_action` | STRING | Suggested action |
| `created_at` | TIMESTAMP | When record was created |

**Common Queries:**

```sql
-- Export CRM matches (use existing query: 03_export_crm_matches.sql)
SELECT
  advisor_name,
  advisor_linkedin_url,
  match_type,
  match_confidence,
  alert_priority,
  lead_name,
  lead_status,
  opportunity_name,
  opportunity_stage,
  ARRAY_TO_STRING(recruiter_names, ', ') AS recruiters,
  suggested_action
FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY alert_priority DESC, advisor_name;
```

---

### 3.11 advisor_job_changes

**Purpose:** Advisors who changed job titles or locations between scrapes. Strong signal of job transitions.

**Row Count:** 0 (populated by Monday analysis)

| Column | Type | Description |
|--------|------|-------------|
| `id` | STRING | Unique change ID |
| `advisor_id` | STRING | Foreign key to `advisors.id` |
| `advisor_name` | STRING | Advisor name |
| `linkedin_url` | STRING | LinkedIn URL |
| `change_type` | STRING | `'title_change'`, `'location_change'`, or `'both'` |
| `previous_title` | STRING | Previous job title |
| `new_title` | STRING | New job title |
| `previous_location` | STRING | Previous location |
| `new_location` | STRING | New location |
| `detected_date` | DATE | When change was detected |
| `previous_seen_date` | DATE | Last date with old title/location |
| `is_likely_job_change` | BOOLEAN | Whether this is likely a job change |
| `created_at` | TIMESTAMP | When record was created |

**Common Queries:**

```sql
-- Export job changes (use existing query: 04_export_job_changes.sql)
SELECT
  a.name AS advisor_name,
  jc.previous_title,
  jc.new_title,
  jc.previous_location,
  jc.new_location,
  CASE WHEN jc.is_likely_job_change THEN 'Yes' ELSE 'Maybe' END AS likely_job_change,
  a.linkedin_url,
  jc.detected_date
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

## 4. Views Reference

### 4.1 v_observations_with_advisors

**Purpose:** ⚠️ **CRITICAL VIEW** - Always use this view instead of `connection_observations` directly. It corrects `advisor_id` values by matching on `linkedin_id`, overcoming streaming buffer limitations.

**Why it exists:** The `connection_observations` table uses streaming inserts. For ~90 minutes after insertion, rows are in a "streaming buffer" and cannot be updated. During this time, `advisor_id` may be a hash ID (`adv_*`) instead of the correct UUID. This view performs the matching on-the-fly.

**Columns:**
- All columns from `connection_observations`
- Plus: `matched_advisor_name`, `matched_advisor_title`, `matched_advisor_location`, `matched_linkedin_id`
- Plus: `match_status` - Shows how `advisor_id` was determined

**Match Status Values:**
- `✅ Matched via linkedin_id` - Correctly matched
- `✅ Has correct advisor_id` - Already had correct UUID
- `⚠️ Hash ID - needs backfill` - Hash ID, will be corrected after buffer flushes
- `❌ No advisor_id` - Missing advisor_id

**Example Query:**

```sql
-- Always use this view for observations
SELECT 
  advisor_name,
  advisor_title,
  advisor_linkedin_url,
  advisor_id,  -- Correct UUID
  match_status
FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`
WHERE recruiter_id = 'rec_477d828c44c9e6253f039ddbd0bfb129'
  AND DATE(observed_at) = CURRENT_DATE()
ORDER BY observed_at DESC;
```

---

### 4.2 v_advisors_with_crd

**Purpose:** Advisors enriched with FINTRX CRD data. Matches advisors to FINTRX `ria_contacts_current` table using LinkedIn slug or exact name matching.

**Columns:**
- All columns from `advisors`
- Plus: `crd_number` - FINTRX CRD number
- Plus: `crd_match_type` - `'1. LinkedIn Slug Match'` or `'2. Exact Name Match'`
- Plus: `crd_matched_name` - Name from FINTRX
- Plus: `crd_firm_name` - Firm name from FINTRX
- Plus: `crd_firm_aum` - Firm AUM from FINTRX
- Plus: `crd_rep_type` - Rep type from FINTRX
- Plus: `crd_is_producing` - Whether producing advisor
- Plus: `is_registered_ria` - Boolean
- Plus: `lead_priority` - `'HIGH - Registered Producing Advisor'`, `'MEDIUM - Registered RIA'`, or `'NORMAL - Not in FINTRX'`

**Example Query:**

```sql
-- Find high-priority leads with CRD data
SELECT 
  name,
  current_title,
  linkedin_url,
  crd_number,
  crd_firm_name,
  ROUND(crd_firm_aum / 1000000, 1) AS firm_aum_millions,
  lead_priority
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd`
WHERE lead_priority = 'HIGH - Registered Producing Advisor'
ORDER BY crd_firm_aum DESC NULLS LAST
LIMIT 100;
```

---

### 4.3 v_advisors_on_move

**Purpose:** Advisors appearing in 2+ recruiter networks. This is the real-time view (not waiting for Monday analysis).

**Columns:**
- `advisor_id`, `advisor_name`, `linkedin_url`, `current_title`, `current_location`, `accreditations`
- `recruiter_count` - Number of recruiters
- `first_appearance`, `latest_appearance`, `days_spread`
- `severity` - `'critical'` (4+), `'high'` (3), `'normal'` (2)
- `recruiter_names` - Array of recruiter names
- `recruiter_timeline` - Array of structs with recruiter name, first_seen_date, search_type

**Example Query:**

```sql
-- Find critical advisors (4+ recruiters)
SELECT 
  advisor_name,
  current_title,
  linkedin_url,
  recruiter_count,
  ARRAY_TO_STRING(recruiter_names, ' → ') AS recruiter_trail
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_on_move`
WHERE severity = 'critical'
ORDER BY recruiter_count DESC;
```

---

### 4.4 v_crm_match_candidates

**Purpose:** Advisors eligible for CRM matching. Includes new advisors (last 30 days) and advisors on the move.

**Columns:**
- `advisor_id`, `advisor_name`, `linkedin_url`, `normalized_linkedin_id`, `normalized_name`
- `current_title`, `current_location`
- `activity_type` - `'on_the_move'` or `'new_advisor'`
- `recruiter_count`, `recruiter_names`, `first_appearance`, `severity` (if on the move)

**Example Query:**

```sql
-- Find candidates for CRM matching
SELECT 
  advisor_name,
  linkedin_url,
  activity_type,
  recruiter_count,
  recruiter_names
FROM `savvy-gtm-analytics.savvy_pirate.v_crm_match_candidates`
WHERE activity_type = 'on_the_move'
ORDER BY recruiter_count DESC;
```

---

### 4.5 v_crm_matches

**Purpose:** Advisors matched to Salesforce leads or opportunities. Uses exact URL matching (preferred) or fuzzy name matching.

**Columns:**
- `advisor_id`, `advisor_name`, `advisor_linkedin_url`
- `match_type` - `'lead'` or `'opportunity'`
- `match_confidence` - `'exact_url'` or `'fuzzy_name'`
- Lead fields: `lead_id`, `lead_name`, `lead_status`, `lead_owner_name`, `lead_disposition`, etc.
- Opportunity fields: `opportunity_id`, `opportunity_name`, `opportunity_stage`, `opportunity_owner_name`, etc.
- `alert_priority` - `'high'` or `'medium'`

**Example Query:**

```sql
-- Find high-priority CRM matches
SELECT 
  advisor_name,
  advisor_linkedin_url,
  match_type,
  match_confidence,
  lead_status,
  opportunity_stage,
  alert_priority
FROM `savvy-gtm-analytics.savvy_pirate.v_crm_matches`
WHERE alert_priority = 'high'
ORDER BY match_confidence DESC;
```

---

### 4.6 v_disappeared_connections

**Purpose:** Connections that appeared in a previous scrape but not in the most recent scrape. May indicate privacy setting changes or unfriending.

**Columns:**
- `recruiter_id`, `recruiter_name`
- `advisor_id`, `advisor_name`, `advisor_title`, `advisor_linkedin_url`
- `last_seen_date` - Last date seen
- `checked_date` - Date of most recent scrape
- `days_since_seen` - Days since last seen

**Example Query:**

```sql
-- Find disappeared connections
SELECT 
  recruiter_name,
  advisor_name,
  advisor_title,
  advisor_linkedin_url,
  last_seen_date,
  days_since_seen
FROM `savvy-gtm-analytics.savvy_pirate.v_disappeared_connections`
WHERE days_since_seen <= 7  -- Recently disappeared
ORDER BY recruiter_name, days_since_seen DESC;
```

---

### 4.7 v_scrape_history

**Purpose:** Summary of scrape activity by recruiter and date.

**Columns:**
- `recruiter_name`, `recruiter_id`
- `scrape_date` - Date of scrape
- `connections_found` - Number of unique advisors found
- `job_titles_searched` - Number of job title searches
- `scrape_started`, `scrape_ended` - Timestamps

**Example Query:**

```sql
-- Scrape history for a recruiter
SELECT 
  scrape_date,
  connections_found,
  job_titles_searched,
  TIMESTAMP_DIFF(scrape_ended, scrape_started, MINUTE) as duration_minutes
FROM `savvy-gtm-analytics.savvy_pirate.v_scrape_history`
WHERE recruiter_name = 'Jeff Nash'
ORDER BY scrape_date DESC;
```

---

## 5. User-Defined Functions (UDFs)

### 5.1 extract_linkedin_slug(url)

**Purpose:** Extract the LinkedIn slug from a LinkedIn URL.

**Input:** `STRING` - LinkedIn URL (e.g., `"https://www.linkedin.com/in/john-doe-12345"`)

**Output:** `STRING` - LinkedIn slug (e.g., `"john-doe-12345"`)

**Example:**
```sql
SELECT 
  name,
  linkedin_url,
  `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`(linkedin_url) AS slug
FROM `savvy-gtm-analytics.savvy_pirate.advisors`
LIMIT 10;
```

---

### 5.2 normalize_linkedin_url(url)

**Purpose:** Normalize a LinkedIn URL to lowercase slug format for matching.

**Input:** `STRING` - LinkedIn URL

**Output:** `STRING` - Normalized slug (lowercase)

**Example:**
```sql
SELECT 
  linkedin_url,
  `savvy-gtm-analytics.savvy_pirate.normalize_linkedin_url`(linkedin_url) AS normalized
FROM `savvy-gtm-analytics.savvy_pirate.advisors`
LIMIT 10;
```

---

### 5.3 normalize_name(name)

**Purpose:** Normalize a name for fuzzy matching (lowercase, remove special chars, collapse spaces).

**Input:** `STRING` - Name

**Output:** `STRING` - Normalized name

**Example:**
```sql
SELECT 
  name,
  `savvy-gtm-analytics.savvy_pirate.normalize_name`(name) AS normalized
FROM `savvy-gtm-analytics.savvy_pirate.advisors`
LIMIT 10;
```

---

### 5.4 get_week_of_month(date)

**Purpose:** Get the week number (1-4) for a given date.

**Input:** `DATE` or `TIMESTAMP`

**Output:** `INT64` - Week number (1, 2, 3, or 4)

**Example:**
```sql
SELECT 
  CURRENT_DATE() AS today,
  `savvy-gtm-analytics.savvy_pirate.get_week_of_month`(CURRENT_DATE()) AS week_number;
```

---

### 5.5 get_active_frequency(date)

**Purpose:** Determine which frequency group is active for a given date.

**Input:** `DATE` or `TIMESTAMP`

**Output:** `STRING` - `'1st_3rd_week'` or `'2nd_4th_week'`

**Example:**
```sql
SELECT 
  CURRENT_DATE() AS today,
  `savvy-gtm-analytics.savvy_pirate.get_active_frequency`(CURRENT_DATE()) AS active_frequency;
```

---

## 6. Business Use Cases & Queries

### 6.1 Finding New Leads

#### Query: New Advisors Discovered in Last 14 Days

```sql
SELECT 
  a.name AS advisor_name,
  a.current_title,
  a.current_location,
  a.linkedin_url,
  ARRAY_TO_STRING(a.accreditations, '; ') AS accreditations,
  a.first_seen_at,
  -- CRD enrichment
  crd.crd_number,
  crd.lead_priority,
  crd.crd_firm_name,
  ROUND(crd.crd_firm_aum / 1000000, 1) AS firm_aum_millions
FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` crd
  ON a.id = crd.advisor_id
WHERE a.first_seen_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
ORDER BY 
  CASE crd.lead_priority 
    WHEN 'HIGH - Registered Producing Advisor' THEN 1
    WHEN 'MEDIUM - Registered RIA' THEN 2
    ELSE 3
  END,
  a.first_seen_at DESC;
```

#### Query: New Advisors by Recruiter

```sql
SELECT 
  r.name AS recruiter_name,
  COUNT(DISTINCT c.advisor_id) AS new_advisors_count,
  ARRAY_AGG(DISTINCT a.name LIMIT 10) AS sample_advisors
FROM `savvy-gtm-analytics.savvy_pirate.connections` c
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON c.advisor_id = a.id
WHERE c.first_seen_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
GROUP BY r.name
ORDER BY new_advisors_count DESC;
```

---

### 6.2 Multi-Recruiter Alerts (HOT Leads)

#### Query: Advisors in 2+ Recruiter Networks

```sql
SELECT 
  a.name AS advisor_name,
  a.current_title,
  a.current_location,
  a.linkedin_url,
  COUNT(DISTINCT c.recruiter_id) AS recruiter_count,
  ARRAY_AGG(DISTINCT r.name) AS recruiter_names,
  MIN(c.first_seen_date) AS first_appearance,
  MAX(c.first_seen_date) AS latest_appearance,
  DATE_DIFF(MAX(c.first_seen_date), MIN(c.first_seen_date), DAY) AS days_span
FROM `savvy-gtm-analytics.savvy_pirate.connections` c
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON c.advisor_id = a.id
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
WHERE r.is_active = TRUE
GROUP BY a.id, a.name, a.current_title, a.current_location, a.linkedin_url
HAVING COUNT(DISTINCT c.recruiter_id) >= 2
ORDER BY recruiter_count DESC, days_span ASC;
```

#### Query: Advisors Who JUST Appeared in New Networks

This is the "movement detection" query - finds advisors who were already in X recruiter networks and just showed up in new ones.

```sql
WITH recent_new_connections AS (
  SELECT 
    c.advisor_id,
    c.recruiter_id,
    r.name as recruiter_name,
    c.first_seen_date
  FROM `savvy-gtm-analytics.savvy_pirate.connections` c
  JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE c.first_seen_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
),
older_connections AS (
  SELECT 
    c.advisor_id,
    COUNT(DISTINCT c.recruiter_id) as prior_recruiter_count
  FROM `savvy-gtm-analytics.savvy_pirate.connections` c
  WHERE c.first_seen_date < DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
  GROUP BY c.advisor_id
)
SELECT 
  a.name,
  a.current_title,
  a.linkedin_url,
  oc.prior_recruiter_count as was_in_x_networks,
  COUNT(DISTINCT rnc.recruiter_id) as new_networks_count,
  ARRAY_AGG(DISTINCT rnc.recruiter_name) as new_recruiters
FROM recent_new_connections rnc
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON rnc.advisor_id = a.id
JOIN older_connections oc ON rnc.advisor_id = oc.advisor_id
GROUP BY a.id, a.name, a.current_title, a.linkedin_url, oc.prior_recruiter_count
ORDER BY oc.prior_recruiter_count DESC, new_networks_count DESC;
```

**How to read results:**
- `was_in_x_networks`: How many recruiters they were already connected to
- `new_networks_count`: How many NEW recruiters they just appeared in
- `new_recruiters`: Names of the new recruiters

**Priority scoring:**
- 🔥🔥🔥 was_in 5+ networks + appeared in 2+ new = VERY HOT
- 🔥🔥 was_in 3+ networks + appeared in 1+ new = HOT
- 🔥 was_in 1+ networks + appeared in 1+ new = WARM

#### Query: Timeline of When Advisor Appeared in Each Network

```sql
SELECT 
  a.name AS advisor_name,
  r.name AS recruiter_name,
  c.first_seen_date,
  c.search_type,
  c.last_seen_date
FROM `savvy-gtm-analytics.savvy_pirate.connections` c
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON c.advisor_id = a.id
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
WHERE a.id = '177b7fe9-3e4f-4a72-b433-e8c3566ffcd5'  -- Replace with advisor_id
ORDER BY c.first_seen_date;
```

---

### 6.3 Recruiter Analytics

#### Query: Connections Per Recruiter

```sql
SELECT 
  r.name AS recruiter_name,
  COUNT(DISTINCT c.advisor_id) AS total_connections,
  COUNT(DISTINCT DATE(c.first_seen_date)) AS days_with_connections,
  MIN(c.first_seen_date) AS first_connection_date,
  MAX(c.last_seen_date) AS last_connection_date
FROM `savvy-gtm-analytics.savvy_pirate.connections` c
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
WHERE r.is_active = TRUE
GROUP BY r.name
ORDER BY total_connections DESC;
```

#### Query: Network Growth Over Time

```sql
SELECT 
  r.name AS recruiter_name,
  DATE(c.first_seen_date) AS connection_date,
  COUNT(DISTINCT c.advisor_id) AS new_connections,
  SUM(COUNT(DISTINCT c.advisor_id)) OVER (
    PARTITION BY r.name 
    ORDER BY DATE(c.first_seen_date)
  ) AS cumulative_connections
FROM `savvy-gtm-analytics.savvy_pirate.connections` c
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
WHERE r.name = 'Jeff Nash'  -- Replace with recruiter name
GROUP BY r.name, DATE(c.first_seen_date)
ORDER BY connection_date;
```

#### Query: Scrape Success Rates

```sql
SELECT 
  recruiter_name,
  COUNT(*) AS total_scrapes,
  COUNTIF(status = 'completed') AS completed_scrapes,
  COUNTIF(status = 'partial') AS partial_scrapes,
  COUNTIF(status = 'failed') AS failed_scrapes,
  ROUND(COUNTIF(status = 'completed') * 100.0 / COUNT(*), 1) AS success_rate_pct,
  AVG(profiles_scraped) AS avg_profiles_per_scrape,
  MAX(profiles_scraped) AS max_profiles_per_scrape
FROM `savvy-gtm-analytics.savvy_pirate.scrape_runs`
GROUP BY recruiter_name
ORDER BY success_rate_pct DESC, avg_profiles_per_scrape DESC;
```

---

### 6.4 Advisor Intelligence

#### Query: Advisor Profile with All Recruiter Connections

```sql
SELECT 
  a.name AS advisor_name,
  a.current_title,
  a.current_location,
  a.linkedin_url,
  ARRAY_TO_STRING(a.accreditations, '; ') AS accreditations,
  COUNT(DISTINCT c.recruiter_id) AS recruiter_count,
  ARRAY_AGG(DISTINCT r.name) AS recruiter_names,
  MIN(c.first_seen_date) AS first_seen,
  MAX(c.last_seen_date) AS last_seen,
  -- CRD enrichment
  crd.crd_number,
  crd.lead_priority,
  crd.crd_firm_name
FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.connections` c ON a.id = c.advisor_id
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` crd ON a.id = crd.advisor_id
WHERE a.id = '177b7fe9-3e4f-4a72-b433-e8c3566ffcd5'  -- Replace with advisor_id
GROUP BY a.id, a.name, a.current_title, a.current_location, a.linkedin_url, a.accreditations, crd.crd_number, crd.lead_priority, crd.crd_firm_name;
```

#### Query: Advisors with Specific Accreditations

```sql
SELECT 
  name,
  current_title,
  linkedin_url,
  accreditations,
  COUNT(DISTINCT c.recruiter_id) AS recruiter_count
FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.connections` c ON a.id = c.advisor_id
WHERE 'CFP®' IN UNNEST(accreditations)
  OR 'CFA' IN UNNEST(accreditations)
  OR 'CIMA®' IN UNNEST(accreditations)
GROUP BY a.id, name, current_title, linkedin_url, accreditations
HAVING COUNT(DISTINCT c.recruiter_id) >= 2  -- On the move
ORDER BY recruiter_count DESC
LIMIT 100;
```

#### Query: Advisors by Location

```sql
SELECT 
  current_location,
  COUNT(DISTINCT id) AS advisor_count,
  COUNT(DISTINCT CASE WHEN 'CFP®' IN UNNEST(accreditations) THEN id END) AS cfp_count,
  COUNT(DISTINCT c.recruiter_id) AS unique_recruiters
FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.connections` c ON a.id = c.advisor_id
WHERE current_location IS NOT NULL
GROUP BY current_location
HAVING advisor_count >= 10
ORDER BY advisor_count DESC
LIMIT 50;
```

#### Query: Job Change Detection

```sql
-- Find advisors with title changes in observations
WITH title_changes AS (
  SELECT 
    advisor_id,
    advisor_name,
    advisor_linkedin_url,
    LAG(advisor_title) OVER (PARTITION BY advisor_id ORDER BY observed_at) AS previous_title,
    advisor_title AS new_title,
    LAG(advisor_location) OVER (PARTITION BY advisor_id ORDER BY observed_at) AS previous_location,
    advisor_location AS new_location,
    observed_at
  FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`
  WHERE advisor_id IS NOT NULL
)
SELECT 
  advisor_name,
  advisor_linkedin_url,
  previous_title,
  new_title,
  previous_location,
  new_location,
  observed_at
FROM title_changes
WHERE previous_title IS NOT NULL
  AND previous_title != new_title
  AND DATE(observed_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
ORDER BY observed_at DESC;
```

---

### 6.5 CRM Integration

#### Query: Find Advisors That Match Existing Salesforce Leads

```sql
SELECT 
  a.name AS advisor_name,
  a.linkedin_url AS advisor_linkedin_url,
  m.match_type,
  m.match_confidence,
  m.lead_name,
  m.lead_status,
  m.lead_owner_name,
  m.lead_disposition,
  m.alert_priority
FROM `savvy-gtm-analytics.savvy_pirate.v_crm_matches` m
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON m.advisor_id = a.id
WHERE m.match_type = 'lead'
  AND m.alert_priority = 'high'
ORDER BY m.match_confidence DESC, a.name;
```

#### Query: High-Priority Leads Not Yet in CRM

```sql
SELECT 
  a.name AS advisor_name,
  a.current_title,
  a.linkedin_url,
  crd.crd_number,
  crd.lead_priority,
  crd.crd_firm_name,
  COUNT(DISTINCT c.recruiter_id) AS recruiter_count,
  ARRAY_AGG(DISTINCT r.name) AS recruiter_names
FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` crd ON a.id = crd.advisor_id
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.connections` c ON a.id = c.advisor_id
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_crm_matches` crm ON a.id = crm.advisor_id
WHERE crd.lead_priority = 'HIGH - Registered Producing Advisor'
  AND crm.advisor_id IS NULL  -- Not in CRM
  AND a.first_seen_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY a.id, a.name, a.current_title, a.linkedin_url, crd.crd_number, crd.lead_priority, crd.crd_firm_name
HAVING COUNT(DISTINCT c.recruiter_id) >= 2  -- On the move
ORDER BY recruiter_count DESC, a.first_seen_at DESC;
```

---

### 6.6 Trend Analysis

#### Query: Week-over-Week Network Growth

```sql
WITH weekly_stats AS (
  SELECT 
    DATE_TRUNC(DATE(observed_at), WEEK) AS week_start,
    COUNT(DISTINCT advisor_id) AS unique_advisors,
    COUNT(DISTINCT recruiter_id) AS active_recruiters,
    COUNT(*) AS total_observations
  FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`
  WHERE observed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 8 WEEK)
  GROUP BY week_start
)
SELECT 
  week_start,
  unique_advisors,
  active_recruiters,
  total_observations,
  unique_advisors - LAG(unique_advisors) OVER (ORDER BY week_start) AS advisor_growth,
  ROUND((unique_advisors - LAG(unique_advisors) OVER (ORDER BY week_start)) * 100.0 / 
    NULLIF(LAG(unique_advisors) OVER (ORDER BY week_start), 0), 1) AS growth_pct
FROM weekly_stats
ORDER BY week_start DESC;
```

#### Query: Most Active Recruiters

```sql
SELECT 
  r.name AS recruiter_name,
  COUNT(DISTINCT DATE(o.observed_at)) AS scrape_days,
  COUNT(DISTINCT o.advisor_id) AS unique_advisors,
  COUNT(*) AS total_observations,
  AVG(COUNT(DISTINCT o.advisor_id)) OVER (
    PARTITION BY DATE(o.observed_at)
  ) AS avg_advisors_per_day
FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors` o
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON o.recruiter_id = r.id
WHERE o.observed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY r.name
ORDER BY unique_advisors DESC;
```

#### Query: Advisor Churn (Disappeared Connections)

```sql
SELECT 
  recruiter_name,
  COUNT(DISTINCT advisor_id) AS disappeared_count,
  AVG(days_since_seen) AS avg_days_gone,
  MAX(days_since_seen) AS max_days_gone
FROM `savvy-gtm-analytics.savvy_pirate.v_disappeared_connections`
WHERE days_since_seen <= 30  -- Recently disappeared
GROUP BY recruiter_name
ORDER BY disappeared_count DESC;
```

---

## 7. Existing SQL Files Reference

All SQL files are located in: `big_query/sql/`

### 7.1 Export Queries

#### `01_export_new_advisors.sql`
**Purpose:** Export new advisors discovered in the latest Monday analysis with CRD enrichment.

**When to use:** After Monday analysis completes. Download as CSV for sales outreach.

**Key features:**
- Includes CRD number, lead priority, firm AUM
- Sorted by priority (HIGH → MEDIUM → NORMAL)
- Includes accreditations, recruiter name, search type

---

#### `02_export_on_the_move.sql`
**Purpose:** Export advisors appearing in 2+ recruiter networks (movement alerts).

**When to use:** After Monday analysis completes. Download as CSV for high-priority outreach.

**Key features:**
- Shows recruiter count and severity
- Includes recruiter trail (which recruiters found them)
- Shows timeline (first appearance, latest appearance, days span)

---

#### `03_export_crm_matches.sql`
**Purpose:** Export advisors matched to Salesforce leads/opportunities (re-engagement opportunities).

**When to use:** After Monday analysis completes. Download as CSV for CRM follow-up.

**Key features:**
- Shows match type (lead vs opportunity) and confidence
- Includes lead/opportunity status, owner, disposition
- Suggests actions based on match type

---

#### `04_export_job_changes.sql`
**Purpose:** Export advisors who changed job titles or locations.

**When to use:** After Monday analysis completes. Download as CSV for transition outreach.

**Key features:**
- Shows previous vs new title/location
- Indicates likely job change (Yes/Maybe)
- Sorted by likelihood

---

#### `05_export_reconstruct_scrape.sql`
**Purpose:** Reconstruct a specific past scrape for a recruiter on a specific date.

**When to use:** When you need to see exactly what was found in a past scrape.

**⚠️ Important:** You MUST replace placeholders:
- `'RECRUITER_NAME_HERE'` with actual recruiter name
- `DATE('2025-01-01')` with actual scrape date

**Key features:**
- Uses `v_observations_with_advisors` for correct advisor_id
- Shows match status (how advisor_id was determined)

---

#### `06_export_disappeared_connections.sql`
**Purpose:** Export connections that disappeared from recruiter networks.

**When to use:** Anytime. Download as CSV to track network changes.

**Key features:**
- Shows last seen date and days since seen
- May indicate privacy setting changes or unfriending

---

#### `07_weekly_summary_dashboard.sql`
**Purpose:** Summary of each Monday analysis run.

**When to use:** Anytime. Use for dashboard or reporting.

**Key features:**
- Shows analysis date, frequency group, period analyzed
- Includes counts: new advisors, on the move, CRM matches
- Shows status (completed, running, failed)

---

### 7.2 Other SQL Files

#### `001_schema.sql`
**Purpose:** Schema definitions for all tables, views, and functions.

**When to use:** Reference for table structures or when recreating schema.

---

#### `002_monday_analysis_scheduled_query.sql`
**Purpose:** The complete Monday analysis script that runs as a scheduled query.

**When to use:** Reference for understanding how Monday analysis works, or to modify the analysis logic.

---

#### `003_csv_export_queries.sql`
**Purpose:** Combined export queries (may be outdated - use individual files instead).

**When to use:** Reference only.

---

## 8. Query Patterns & Best Practices

### 8.1 Streaming Buffer Limitations

**⚠️ Critical:** The `connection_observations` table uses streaming inserts. For ~90 minutes after insertion, rows are in a "streaming buffer" and cannot be updated.

**Impact:**
- `advisor_id` may be a hash ID (`adv_*`) instead of UUID for recent rows
- Direct `UPDATE` or `DELETE` statements will fail on recent rows

**Solution:**
- **Always use `v_observations_with_advisors` view** for queries
- The view performs matching on-the-fly, providing correct UUID `advisor_id` values
- Wait 90+ minutes if you need to update recent rows directly

**Example:**
```sql
-- ❌ DON'T: Query connection_observations directly
SELECT advisor_id FROM `savvy-gtm-analytics.savvy_pirate.connection_observations`
WHERE observed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR);

-- ✅ DO: Use the view
SELECT advisor_id FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors`
WHERE observed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR);
```

---

### 8.2 When to Use Views vs Direct Table Queries

**Use Views When:**
- Querying `connection_observations` (always use `v_observations_with_advisors`)
- Need CRD enrichment (use `v_advisors_with_crd`)
- Need CRM matches (use `v_crm_matches`)
- Need real-time "on the move" data (use `v_advisors_on_move`)
- Need scrape history summary (use `v_scrape_history`)

**Use Direct Tables When:**
- Querying `advisors`, `recruiters`, `searches`, `connections` (no streaming buffer)
- Need raw data without enrichment
- Performance is critical and view adds unnecessary joins

---

### 8.3 Date Range Filtering Patterns

**Last N Days:**
```sql
WHERE first_seen_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
```

**Last N Weeks:**
```sql
WHERE DATE(observed_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 4 WEEK)
```

**Specific Date:**
```sql
WHERE DATE(observed_at) = DATE('2025-12-28')
```

**Date Range:**
```sql
WHERE DATE(observed_at) BETWEEN DATE('2025-12-01') AND DATE('2025-12-31')
```

**Current Week:**
```sql
WHERE DATE_TRUNC(DATE(observed_at), WEEK) = DATE_TRUNC(CURRENT_DATE(), WEEK)
```

---

### 8.4 Joining Tables Efficiently

**Best Practice:** Join on indexed columns (IDs) and filter early.

**Example:**
```sql
-- ✅ Good: Filter early, join on IDs
SELECT a.name, r.name
FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
JOIN `savvy-gtm-analytics.savvy_pirate.connections` c ON a.id = c.advisor_id
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
WHERE r.is_active = TRUE
  AND a.first_seen_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY);

-- ❌ Avoid: Filtering after joins
SELECT a.name, r.name
FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
JOIN `savvy-gtm-analytics.savvy_pirate.connections` c ON a.id = c.advisor_id
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
WHERE r.is_active = TRUE;  -- Filter applied after join
```

---

### 8.5 Using UDFs Correctly

**Always qualify UDFs with full project.dataset path:**
```sql
SELECT 
  `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`(linkedin_url) AS slug
FROM `savvy-gtm-analytics.savvy_pirate.advisors`;
```

**UDFs are case-sensitive:**
```sql
-- ✅ Correct
`savvy-gtm-analytics.savvy_pirate.normalize_name`(name)

-- ❌ Wrong
`savvy-gtm-analytics.savvy_pirate.Normalize_Name`(name)
```

---

### 8.6 Handling Arrays

**Check if value in array:**
```sql
WHERE 'CFP®' IN UNNEST(accreditations)
```

**Convert array to string:**
```sql
ARRAY_TO_STRING(accreditations, '; ') AS accreditations_str
```

**Aggregate into array:**
```sql
ARRAY_AGG(DISTINCT r.name) AS recruiter_names
```

---

### 8.7 Performance Tips

1. **Use `LIMIT` for exploratory queries**
2. **Filter on date columns early** (they're often indexed)
3. **Use `COUNT(DISTINCT ...)` sparingly** (expensive)
4. **Prefer `EXISTS` over `IN` for subqueries**
5. **Use `STRUCT` for nested data** when appropriate

---

## 9. Example Workflows

### 9.1 Weekly Monday Analysis

**Step 1:** Check if analysis completed
```sql
SELECT 
  analysis_date,
  status,
  total_new_advisors,
  total_advisors_on_move,
  total_crm_matches
FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
ORDER BY analysis_date DESC
LIMIT 1;
```

**Step 2:** Export new advisors
```sql
-- Run: 01_export_new_advisors.sql
-- Download as CSV
```

**Step 3:** Export advisors on the move
```sql
-- Run: 02_export_on_the_move.sql
-- Download as CSV
```

**Step 4:** Export CRM matches
```sql
-- Run: 03_export_crm_matches.sql
-- Download as CSV
```

**Step 5:** Review summary
```sql
-- Run: 07_weekly_summary_dashboard.sql
```

---

### 9.2 New Recruiter Onboarding

**Step 1:** Verify recruiter exists
```sql
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
WHERE name = 'New Recruiter Name';
```

**Step 2:** Check searches are configured
```sql
SELECT target_job_title, linkedin_search_url
FROM `savvy-gtm-analytics.savvy_pirate.searches`
WHERE recruiter_id = 'rec_...'
ORDER BY target_job_title;
```

**Step 3:** Monitor first scrape
```sql
SELECT 
  status,
  profiles_scraped,
  searches_completed,
  error_message
FROM `savvy-gtm-analytics.savvy_pirate.scrape_runs`
WHERE recruiter_id = 'rec_...'
ORDER BY started_at DESC
LIMIT 1;
```

**Step 4:** Verify connections captured
```sql
SELECT COUNT(*) as connection_count
FROM `savvy-gtm-analytics.savvy_pirate.connections`
WHERE recruiter_id = 'rec_...';
```

---

### 9.3 Lead Export for Sales

**Step 1:** Get high-priority leads with CRD
```sql
SELECT 
  a.name,
  a.current_title,
  a.linkedin_url,
  crd.crd_number,
  crd.lead_priority,
  crd.crd_firm_name,
  ROUND(crd.crd_firm_aum / 1000000, 1) AS firm_aum_millions,
  COUNT(DISTINCT c.recruiter_id) AS recruiter_count
FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` crd ON a.id = crd.advisor_id
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.connections` c ON a.id = c.advisor_id
WHERE crd.lead_priority = 'HIGH - Registered Producing Advisor'
  AND a.first_seen_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY a.id, a.name, a.current_title, a.linkedin_url, crd.crd_number, crd.lead_priority, crd.crd_firm_name, crd.crd_firm_aum
HAVING COUNT(DISTINCT c.recruiter_id) >= 2
ORDER BY crd.crd_firm_aum DESC NULLS LAST
LIMIT 100;
```

**Step 2:** Export to CSV and share with sales team

**Step 3:** Track outreach in CRM

---

## 10. Quick Reference Card

### Most Common Queries

| Use Case | Query |
|----------|-------|
| **New advisors (last 14 days)** | `SELECT * FROM advisors WHERE first_seen_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)` |
| **Advisors on the move** | `SELECT * FROM v_advisors_on_move WHERE severity = 'critical'` |
| **High-priority leads** | `SELECT * FROM v_advisors_with_crd WHERE lead_priority = 'HIGH - Registered Producing Advisor'` |
| **CRM matches** | `SELECT * FROM v_crm_matches WHERE alert_priority = 'high'` |
| **Recent scrapes** | `SELECT * FROM scrape_runs WHERE started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)` |
| **Reconstruct scrape** | Use `05_export_reconstruct_scrape.sql` (replace placeholders) |
| **CFP® holders** | `SELECT * FROM advisors WHERE 'CFP®' IN UNNEST(accreditations)` |
| **Advisor profile** | `SELECT * FROM advisors WHERE id = '...'` |

### Key Tables Quick Reference

| Table | Row Count | Primary Use |
|-------|-----------|-------------|
| `advisors` | 26,349 | Master advisor profiles |
| `connections` | 38,708 | Advisor-recruiter relationships |
| `connection_observations` | 77,602 | Point-in-time scrape snapshots |
| `recruiters` | 29 | Recruiter master list |
| `searches` | 261 | LinkedIn search URLs |
| `scrape_runs` | 90 | Scrape execution log |

### Key Views Quick Reference

| View | Primary Use |
|------|-------------|
| `v_observations_with_advisors` | ⚠️ **ALWAYS use this** for observations (corrects advisor_id) |
| `v_advisors_with_crd` | CRD enrichment (FINTRX data) |
| `v_advisors_on_move` | Real-time "on the move" advisors |
| `v_crm_matches` | Salesforce CRM matches |
| `v_scrape_history` | Scrape summary by recruiter/date |
| `v_disappeared_connections` | Connections that disappeared |

### Export Queries Quick Reference

| File | Purpose | When to Run |
|------|---------|-------------|
| `01_export_new_advisors.sql` | New advisors with CRD | After Monday analysis |
| `02_export_on_the_move.sql` | Movement alerts | After Monday analysis |
| `03_export_crm_matches.sql` | CRM re-engagement | After Monday analysis |
| `04_export_job_changes.sql` | Job changes | After Monday analysis |
| `05_export_reconstruct_scrape.sql` | Past scrape data | Anytime (replace placeholders) |
| `06_export_disappeared_connections.sql` | Disappeared connections | Anytime |
| `07_weekly_summary_dashboard.sql` | Analysis summary | Anytime |

---

## Appendix: Common Error Messages

### "UPDATE or DELETE statement over table ... would affect rows in the streaming buffer"

**Cause:** Trying to update/delete rows in `connection_observations` that were inserted in the last ~90 minutes.

**Solution:** Wait 90+ minutes, or use `v_observations_with_advisors` view instead.

---

### "Unrecognized name: advisor_id"

**Cause:** Column name ambiguity in JOIN queries.

**Solution:** Use table aliases and qualify column names:
```sql
SELECT a.id AS advisor_id, c.advisor_id AS connection_advisor_id
FROM advisors a
JOIN connections c ON a.id = c.advisor_id;
```

---

### "Invalid field name: ... Fields must contain the allowed characters"

**Cause:** Column alias contains invalid characters (e.g., parentheses).

**Solution:** Use dashes instead of parentheses:
```sql
-- ❌ Bad
SELECT col AS `Name (Title)`

-- ✅ Good
SELECT col AS `Name - Title`
```

---

## Document Version

**Version:** 1.0  
**Last Updated:** December 28, 2024  
**Maintainer:** Savvy Pirate Team

---

**Questions or Issues?** Contact the Savvy Pirate team or refer to `SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md` for setup and troubleshooting.

