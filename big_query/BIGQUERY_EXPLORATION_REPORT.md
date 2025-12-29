# BigQuery Exploration Report
## Savvy Pirate - LinkedIn Recruiter Intelligence System

**Generated:** 2025-12-29  
**Project:** `savvy-gtm-analytics`  
**Dataset:** `savvy_pirate`  
**Location:** `northamerica-northeast2` (Toronto, Canada)

---

## 1. BigQuery Schema Discovery

### Project and Dataset Information

- **Project ID:** `savvy-gtm-analytics`
- **Dataset ID:** `savvy_pirate`
- **Dataset Location:** `northamerica-northeast2` (Toronto, Canada)
- **Description:** "LinkedIn recruiter connection intelligence for Savvy Pirate"
- **Created:** 2025-12-28T14:14:53.289-05:00
- **Owner:** russell.moss@savvywealth.com

### Tables Overview

The dataset contains **11 tables** and **7 views**:

#### Core Data Tables (11)

1. **recruiters** - Recruiter configuration and metadata
2. **searches** - LinkedIn search configurations per recruiter
3. **advisors** - Financial advisor profiles (deduplicated)
4. **connections** - Many-to-many relationship between advisors and recruiters
5. **connection_observations** - Point-in-time snapshots of each scrape
6. **scrape_runs** - Execution tracking for each scrape session
7. **weekly_analyses** - Results from automated Monday analysis
8. **new_advisor_reports** - New advisors discovered in each analysis
9. **advisor_movement_alerts** - Advisors appearing in multiple recruiter networks
10. **crm_match_results** - Matches between advisors and Salesforce CRM
11. **advisor_job_changes** - Detected title/location changes (job change signals)

#### Views (7)

1. **v_advisors_on_move** - Advisors appearing in 2+ recruiter networks
2. **v_advisors_with_crd** - Advisors enriched with FINTRX CRD data
3. **v_crm_match_candidates** - Advisors eligible for CRM matching
4. **v_crm_matches** - Matches between advisors and Salesforce Leads/Opportunities
5. **v_disappeared_connections** - Connections that disappeared from recruiter networks
6. **v_observations_with_advisors** - Observations with corrected `advisor_id` (handles streaming buffer limitations)
7. **v_scrape_history** - Historical scrape summary by recruiter and date

---

## 2. Detailed Table Schemas

### Table: `recruiters`

**Purpose:** Stores recruiter configuration and metadata

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique recruiter ID (deterministic hash) |
| `name` | STRING | ✅ | - | Recruiter name (Connection Source) |
| `linkedin_url` | STRING | ❌ | - | Recruiter's LinkedIn profile URL |
| `company` | STRING | ❌ | - | Company name |
| `title` | STRING | ❌ | - | Job title |
| `frequency` | STRING | ✅ | - | Scrape frequency: `'1st_3rd_week'` or `'2nd_4th_week'` |
| `output_sheet_url` | STRING | ❌ | - | Google Sheets URL for this recruiter |
| `output_sheet_id` | STRING | ❌ | - | Google Sheets ID |
| `is_active` | BOOLEAN | ❌ | `TRUE` | Whether recruiter is actively scraped |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |
| `updated_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Last update time |

**Current Row Count:** 29

---

### Table: `searches`

**Purpose:** Stores LinkedIn search configurations for each recruiter

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique search ID |
| `recruiter_id` | STRING | ✅ | - | Foreign key to `recruiters.id` |
| `recruiter_name` | STRING | ✅ | - | Denormalized recruiter name |
| `target_job_title` | STRING | ✅ | - | Job title to search for (e.g., "Financial Advisor") |
| `linkedin_search_url` | STRING | ✅ | - | Full LinkedIn search URL |
| `is_active` | BOOLEAN | ❌ | `TRUE` | Whether search is active |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 261

---

### Table: `advisors`

**Purpose:** Master table of all financial advisors discovered (deduplicated by LinkedIn URL)

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique advisor UUID (generated) |
| `linkedin_url` | STRING | ✅ | - | Normalized LinkedIn profile URL |
| `linkedin_id` | STRING | ❌ | - | LinkedIn slug (extracted from URL) |
| `name` | STRING | ✅ | - | Advisor full name |
| `current_title` | STRING | ❌ | - | Most recent job title seen |
| `current_location` | STRING | ❌ | - | Most recent location seen |
| `accreditations` | ARRAY<STRING> | ❌ | - | Array of accreditations (CFP®, AWMA®, etc.) |
| `first_seen_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | When advisor was first discovered |
| `last_seen_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Most recent sighting |
| `times_seen` | INTEGER | ❌ | `1` | Count of times advisor appeared in scrapes |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |
| `updated_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Last update time |

**Current Row Count:** 37 (after test data clear)

**Note:** This is a **streaming table** - uses streaming inserts. Updates to recently inserted rows may fail due to streaming buffer (90-minute delay).

---

### Table: `connections`

**Purpose:** Many-to-many relationship between advisors and recruiters (tracks when advisor appeared in recruiter's network)

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique connection ID |
| `advisor_id` | STRING | ✅ | - | Foreign key to `advisors.id` |
| `recruiter_id` | STRING | ✅ | - | Foreign key to `recruiters.id` |
| `first_seen_date` | DATE | ✅ | - | First date advisor appeared in this recruiter's network |
| `last_seen_date` | DATE | ✅ | - | Most recent date advisor appeared |
| `search_type` | STRING | ❌ | - | Job title search that found this connection |
| `scrape_run_id` | STRING | ❌ | - | Foreign key to `scrape_runs.id` |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 37

**Note:** This is a **streaming table** - uses streaming inserts. Updates to recently inserted rows may fail due to streaming buffer (90-minute delay).

---

### Table: `connection_observations`

**Purpose:** Point-in-time snapshots of each scrape (stores exact data as seen during scrape, even if advisor profile changes later)

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique observation ID |
| `scrape_run_id` | STRING | ❌ | - | Foreign key to `scrape_runs.id` |
| `recruiter_id` | STRING | ✅ | - | Foreign key to `recruiters.id` |
| `advisor_id` | STRING | ❌ | - | Foreign key to `advisors.id` (may be NULL or hash ID if lookup failed) |
| `search_id` | STRING | ❌ | - | Foreign key to `searches.id` |
| `observed_at` | TIMESTAMP | ✅ | - | Exact timestamp when observation was recorded |
| `advisor_name` | STRING | ❌ | - | Advisor name as seen during scrape |
| `advisor_title` | STRING | ❌ | - | Job title as seen during scrape |
| `advisor_location` | STRING | ❌ | - | Location as seen during scrape |
| `advisor_linkedin_url` | STRING | ❌ | - | LinkedIn URL as seen during scrape |
| `search_job_title` | STRING | ❌ | - | Job title search that found this advisor |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 163 (in streaming buffer)

**Important Notes:**
- This is a **streaming table** - uses streaming inserts
- `advisor_id` may be NULL or a hash ID (`adv_*`) if the advisor lookup failed during scrape
- Use **`v_observations_with_advisors`** view to get correct `advisor_id` by joining with `advisors` table
- Streaming buffer contains ~163 rows that haven't been flushed yet
- Cannot UPDATE/DELETE rows in streaming buffer (must wait ~90 minutes)

---

### Table: `scrape_runs`

**Purpose:** Tracks execution of each scrape session

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique scrape run ID (UUID) |
| `recruiter_id` | STRING | ❌ | - | Foreign key to `recruiters.id` |
| `recruiter_name` | STRING | ❌ | - | Denormalized recruiter name |
| `started_at` | TIMESTAMP | ✅ | - | Scrape start time |
| `completed_at` | TIMESTAMP | ❌ | - | Scrape completion time |
| `status` | STRING | ❌ | `'running'` | Status: `'running'`, `'completed'`, `'failed'` |
| `profiles_scraped` | INTEGER | ❌ | `0` | Total profiles scraped |
| `new_connections_found` | INTEGER | ❌ | `0` | New connections discovered |
| `searches_completed` | INTEGER | ❌ | `0` | Number of searches completed |
| `total_searches` | INTEGER | ❌ | `9` | Total searches configured |
| `error_message` | STRING | ❌ | - | Error message if scrape failed |
| `scrape_week` | DATE | ❌ | - | Week of scrape (for grouping) |
| `week_of_month` | INTEGER | ❌ | - | Week of month (1-4) |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 0

---

### Table: `weekly_analyses`

**Purpose:** Results from automated Monday analysis runs

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique analysis ID |
| `analysis_date` | DATE | ✅ | - | Date analysis was run |
| `frequency_group` | STRING | ✅ | - | `'1st_3rd_week'` or `'2nd_4th_week'` |
| `current_period_start` | DATE | ❌ | - | Start of current analysis period |
| `current_period_end` | DATE | ❌ | - | End of current analysis period |
| `previous_period_start` | DATE | ❌ | - | Start of previous period (for comparison) |
| `previous_period_end` | DATE | ❌ | - | End of previous period |
| `total_new_advisors` | INTEGER | ❌ | `0` | New advisors discovered |
| `total_advisors_on_move` | INTEGER | ❌ | `0` | Advisors appearing in multiple networks |
| `total_crm_matches` | INTEGER | ❌ | `0` | CRM matches found |
| `recruiters_analyzed` | INTEGER | ❌ | `0` | Number of recruiters analyzed |
| `status` | STRING | ❌ | `'running'` | Status: `'running'`, `'completed'`, `'failed'` |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 0

---

### Table: `new_advisor_reports`

**Purpose:** New advisors discovered in each weekly analysis

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique report ID |
| `analysis_id` | STRING | ✅ | - | Foreign key to `weekly_analyses.id` |
| `analysis_date` | DATE | ✅ | - | Analysis date |
| `advisor_id` | STRING | ❌ | - | Foreign key to `advisors.id` |
| `advisor_name` | STRING | ❌ | - | Advisor name |
| `linkedin_url` | STRING | ❌ | - | LinkedIn URL |
| `title` | STRING | ❌ | - | Job title |
| `location` | STRING | ❌ | - | Location |
| `accreditations` | ARRAY<STRING> | ❌ | - | Accreditations array |
| `recruiter_id` | STRING | ❌ | - | Recruiter who found this advisor |
| `recruiter_name` | STRING | ❌ | - | Recruiter name |
| `search_type` | STRING | ❌ | - | Search type that found advisor |
| `first_seen_date` | DATE | ❌ | - | First seen date |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 0

---

### Table: `advisor_movement_alerts`

**Purpose:** Advisors detected as "on the move" (appearing in multiple recruiter networks)

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique alert ID |
| `analysis_date` | DATE | ✅ | - | Analysis date |
| `advisor_id` | STRING | ✅ | - | Foreign key to `advisors.id` |
| `advisor_name` | STRING | ❌ | - | Advisor name |
| `linkedin_url` | STRING | ❌ | - | LinkedIn URL |
| `title` | STRING | ❌ | - | Job title |
| `location` | STRING | ❌ | - | Location |
| `accreditations` | ARRAY<STRING> | ❌ | - | Accreditations array |
| `recruiter_count` | INTEGER | ✅ | - | Number of recruiters who have this advisor |
| `severity` | STRING | ❌ | - | `'critical'`, `'high'`, `'normal'` |
| `recruiter_names` | ARRAY<STRING> | ❌ | - | Array of recruiter names |
| `timeline_json` | STRING | ❌ | - | JSON timeline of appearances |
| `first_appearance` | DATE | ❌ | - | First appearance date |
| `latest_appearance` | DATE | ❌ | - | Latest appearance date |
| `days_between_first_last` | INTEGER | ❌ | - | Days between first and last |
| `why_flagged` | STRING | ❌ | - | Reason for flagging |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 0

---

### Table: `crm_match_results`

**Purpose:** Matches between advisors and Salesforce CRM (Leads/Opportunities)

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique match ID |
| `analysis_date` | DATE | ✅ | - | Analysis date |
| `advisor_id` | STRING | ✅ | - | Foreign key to `advisors.id` |
| `advisor_name` | STRING | ❌ | - | Advisor name |
| `advisor_linkedin_url` | STRING | ❌ | - | Advisor LinkedIn URL |
| `match_type` | STRING | ✅ | - | `'lead'` or `'opportunity'` |
| `match_confidence` | STRING | ❌ | - | `'exact_url'` or `'fuzzy_name'` |
| `lead_id` | STRING | ❌ | - | Salesforce Lead ID |
| `lead_name` | STRING | ❌ | - | Lead name |
| `lead_status` | STRING | ❌ | - | Lead status |
| `lead_owner_name` | STRING | ❌ | - | Lead owner name |
| `lead_disposition` | STRING | ❌ | - | Lead disposition |
| `lead_closed_lost_reason` | STRING | ❌ | - | Closed lost reason |
| `lead_last_activity_date` | DATE | ❌ | - | Last activity date |
| `opportunity_id` | STRING | ❌ | - | Salesforce Opportunity ID |
| `opportunity_name` | STRING | ❌ | - | Opportunity name |
| `opportunity_stage` | STRING | ❌ | - | Opportunity stage |
| `opportunity_owner_name` | STRING | ❌ | - | Opportunity owner name |
| `opportunity_closed_lost_reason` | STRING | ❌ | - | Closed lost reason |
| `opportunity_amount` | FLOAT | ❌ | - | Opportunity amount |
| `opportunity_close_date` | DATE | ❌ | - | Close date |
| `found_via` | STRING | ❌ | - | How advisor was found |
| `recruiter_names` | ARRAY<STRING> | ❌ | - | Recruiters who found advisor |
| `first_seen_date` | DATE | ❌ | - | First seen in recruiter network |
| `alert_priority` | STRING | ❌ | - | `'high'`, `'medium'` |
| `suggested_action` | STRING | ❌ | - | Suggested action |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 0

---

### Table: `advisor_job_changes`

**Purpose:** Detected advisor job changes (title/location changes)

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | STRING | ✅ | - | Unique change ID |
| `advisor_id` | STRING | ✅ | - | Foreign key to `advisors.id` |
| `advisor_name` | STRING | ❌ | - | Advisor name |
| `linkedin_url` | STRING | ❌ | - | LinkedIn URL |
| `change_type` | STRING | ✅ | - | Type of change |
| `previous_title` | STRING | ❌ | - | Previous job title |
| `new_title` | STRING | ❌ | - | New job title |
| `previous_location` | STRING | ❌ | - | Previous location |
| `new_location` | STRING | ❌ | - | New location |
| `detected_date` | DATE | ✅ | - | Date change was detected |
| `previous_seen_date` | DATE | ❌ | - | Previous sighting date |
| `is_likely_job_change` | BOOLEAN | ❌ | - | Whether this is likely a job change |
| `created_at` | TIMESTAMP | ❌ | `CURRENT_TIMESTAMP()` | Record creation time |

**Current Row Count:** 0

---

## 3. User-Defined Functions (UDFs)

The dataset contains **5 user-defined functions**:

### 1. `extract_linkedin_slug(url STRING) -> STRING`
Extracts the LinkedIn slug from a LinkedIn URL.

**Example:**
```sql
SELECT `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`('https://www.linkedin.com/in/john-doe/')
-- Returns: 'john-doe'
```

**Definition:**
```sql
LOWER(TRIM(REGEXP_EXTRACT(url, r'linkedin\.com/in/([^/?#]+)')))
```

---

### 2. `normalize_linkedin_url(url STRING) -> STRING`
Normalizes a LinkedIn URL to a consistent format for matching.

**Definition:**
```sql
LOWER(REGEXP_EXTRACT(url, r'linkedin\.com/in/([^/?]+)'))
```

---

### 3. `normalize_name(name STRING) -> STRING`
Normalizes a name for fuzzy matching (removes special characters, lowercases, trims whitespace).

**Definition:**
```sql
LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      TRIM(name),
      r'[^\w\s]', ''
    ),
    r'\s+', ' '
  )
)
```

---

### 4. `get_week_of_month(date_input DATE) -> INT64`
Returns the week of the month (1-4) for a given date.

**Definition:**
```sql
CAST(CEIL(EXTRACT(DAY FROM date_input) / 7.0) AS INT64)
```

---

### 5. `get_active_frequency(date_input DATE) -> STRING`
Returns the active frequency group (`'1st_3rd_week'` or `'2nd_4th_week'`) for a given date.

**Definition:**
```sql
CASE 
  WHEN `savvy-gtm-analytics.savvy_pirate.get_week_of_month`(date_input) IN (1, 3) 
  THEN '1st_3rd_week'
  ELSE '2nd_4th_week'
END
```

---

## 4. Current Data State

### Row Counts by Table

| Table | Row Count | Status |
|-------|-----------|--------|
| `recruiters` | 29 | ✅ Seed data (preserved) |
| `searches` | 261 | ✅ Seed data (preserved) |
| `advisors` | 37 | ✅ Production data (after test clear) |
| `connections` | 37 | ✅ Production data |
| `connection_observations` | 163 | ⚠️ Streaming buffer (not yet flushed) |
| `scrape_runs` | 0 | Empty |
| `weekly_analyses` | 0 | Empty |
| `new_advisor_reports` | 0 | Empty |
| `advisor_movement_alerts` | 0 | Empty |
| `crm_match_results` | 0 | Empty |
| `advisor_job_changes` | 0 | Empty |

### Date Ranges

#### `connection_observations`
- **Earliest Date:** 2025-12-29
- **Latest Date:** 2025-12-29
- **Unique Dates:** 1
- **Total Observations:** 163

#### `scrape_runs`
- **Total Scrapes:** 0
- **Recruiters with Scrapes:** 0

### Recruiters with Data

**Recruiter with Most Data:**
- **Kylie Leone**
  - Unique Advisors: 37
  - Total Connections: 37
  - First Connection: 2025-12-28
  - Last Connection: 2025-12-29

**Other Recruiters:**
- All other 28 recruiters have 0-1 connections (likely test data or edge cases)

---

## 5. Existing Code - Where We Write to BigQuery

### Primary Integration Point: Apps Script Web App

**Location:** `big_query/apps-script/Code.gs`

The system uses a **Google Apps Script Web App** (not a Cloud Function) to write data to BigQuery. This was chosen to avoid GCP permission requirements.

**Web App URL:** `https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec`

**Deployment ID:** `AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx`

---

### Chrome Extension Integration

**File:** `background/bigquery_sync.js`

This file contains the Chrome Extension code that calls the Apps Script Web App.

#### Key Functions:

1. **`syncProfilesToBigQuery(profiles, recruiterId, recruiterName, searchType, scrapeRunId)`**
   - **Purpose:** Syncs scraped profiles to BigQuery
   - **Calls:** Apps Script `sync_profiles` action
   - **Writes to:** `advisors` and `connections` tables
   - **Returns:** `{ success, synced, errors, total, advisorIds, errorDetails }`

2. **`getOrCreateRecruiter(name, frequency, options)`**
   - **Purpose:** Gets or creates a recruiter in BigQuery
   - **Calls:** Apps Script `get_or_create_recruiter` action
   - **Writes to:** `recruiters` table

3. **`createScrapeRun(recruiterId, recruiterName, totalSearches)`**
   - **Purpose:** Creates a scrape run record
   - **Calls:** Apps Script `create_scrape_run` action
   - **Writes to:** `scrape_runs` table

4. **`completeScrapeRun(scrapeRunId, profilesScraped, newConnections, searchesCompleted, status, error)`**
   - **Purpose:** Completes a scrape run
   - **Calls:** Apps Script `complete_scrape_run` action
   - **Updates:** `scrape_runs` table

5. **`recordSearchObservations(scrapeRunId, recruiterId, searchId, searchJobTitle, profiles, advisorIds)`**
   - **Purpose:** Records point-in-time observations
   - **Calls:** Apps Script `record_observations_batch` action
   - **Writes to:** `connection_observations` table

---

### Queue Processing

**File:** `background/sync_queue.js`

The queue processor calls BigQuery sync after Google Sheets sync:

```javascript
// After syncing to Sheets
const recruiterId = await bigquerySync.getOrCreateRecruiter(sourceName);
const result = await bigquerySync.syncProfilesToBigQuery(
    item.rows,
    recruiterId,
    sourceName,
    null, // searchType
    null  // scrapeRunId
);

// Then record observations
await bigquerySync.recordSearchObservations(
    scrapeRunId,
    recruiterId,
    searchId,
    searchJobTitle,
    item.rows,
    result.advisorIds // Pass advisor_ids from sync result
);
```

---

### Apps Script Functions (Code.gs)

**File:** `big_query/apps-script/Code.gs`

#### Main Entry Point: `doPost(e)`

Handles POST requests from Chrome Extension and routes to appropriate functions:

- `sync_profiles` → `syncProfiles(data)`
- `get_or_create_recruiter` → `getOrCreateRecruiter(data)`
- `create_scrape_run` → `createScrapeRun(data)`
- `complete_scrape_run` → `completeScrapeRun(data)`
- `record_observations_batch` → `recordObservationsBatch(data)`
- `sync_recruiters_from_sheets` → `syncRecruitersFromSheets(data)`

---

#### Function: `syncProfiles(data)`

**Purpose:** Syncs advisor profiles to BigQuery

**Writes to:**
- `advisors` table (streaming insert)
- `connections` table (streaming insert)

**Logic:**
1. For each profile:
   - Normalize LinkedIn URL
   - Extract LinkedIn slug
   - Check if advisor exists in `advisors` table
   - If exists and row is >90 minutes old: UPDATE
   - If exists but row is <90 minutes old: Skip update (streaming buffer)
   - If doesn't exist: INSERT new advisor
   - Check if connection exists in `connections` table
   - If exists and row is >90 minutes old: UPDATE `last_seen_date`
   - If exists but row is <90 minutes old: Skip update
   - If doesn't exist: INSERT new connection
2. Returns array of `advisorIds` for each profile (aligned with input array)

**Key Features:**
- Handles streaming buffer limitations (90-minute delay)
- Uses `GENERATE_UUID()` for new advisor IDs
- Escapes SQL to prevent injection
- Type-casts arrays and strings explicitly

---

#### Function: `recordObservationsBatch(data)`

**Purpose:** Records point-in-time observations

**Writes to:**
- `connection_observations` table (streaming insert)

**Parameters:**
- `scrape_run_id`
- `recruiter_id`
- `search_id`
- `search_job_title`
- `profiles` (array of profile objects)
- `advisorIds` (optional array of advisor IDs from `syncProfiles`)

**Logic:**
1. If `advisorIds` provided: Use them directly
2. If not provided: Lookup `advisor_id` from `advisors` table using:
   - Primary: `linkedin_id` (slug) match
   - Fallback: Full URL match (with/without trailing slash)
3. Insert observation with all profile data as seen during scrape

**Key Features:**
- Handles missing `advisor_id` gracefully (can be NULL)
- Uses `v_observations_with_advisors` view for query-time correction
- Stores exact snapshot data (even if advisor profile changes later)

---

#### Function: `getOrCreateRecruiter(data)`

**Purpose:** Gets or creates a recruiter

**Writes to:**
- `recruiters` table (if creating new)

**Logic:**
1. Check if recruiter exists (by name hash)
2. If exists: Return existing ID
3. If not: Create new recruiter with deterministic ID (`rec_` + MD5 hash of name)

---

#### Function: `createScrapeRun(data)`

**Purpose:** Creates a scrape run record

**Writes to:**
- `scrape_runs` table

**Returns:** `{ scrapeRunId: UUID }`

---

#### Function: `completeScrapeRun(data)`

**Purpose:** Completes a scrape run

**Updates:**
- `scrape_runs` table (sets `completed_at`, `status`, metrics)

---

### Table Structure We're Inserting Into

#### `advisors` Table Insert Structure

```javascript
{
  id: UUID,                    // Generated via GENERATE_UUID()
  linkedin_url: STRING,       // Normalized URL
  linkedin_id: STRING,        // Extracted slug
  name: STRING,               // Advisor name
  current_title: STRING,      // Job title
  current_location: STRING,    // Location
  accreditations: ARRAY<STRING>, // Array of accreditations
  first_seen_at: TIMESTAMP,    // CURRENT_TIMESTAMP()
  last_seen_at: TIMESTAMP,    // CURRENT_TIMESTAMP()
  times_seen: INTEGER,        // 1 (for new advisors)
  created_at: TIMESTAMP,      // CURRENT_TIMESTAMP()
  updated_at: TIMESTAMP       // CURRENT_TIMESTAMP()
}
```

#### `connections` Table Insert Structure

```javascript
{
  id: UUID,                    // Generated via GENERATE_UUID()
  advisor_id: STRING,         // From advisors table
  recruiter_id: STRING,       // From recruiters table
  first_seen_date: DATE,      // Today's date
  last_seen_date: DATE,       // Today's date
  search_type: STRING,        // Job title search
  scrape_run_id: STRING,      // Optional scrape run ID
  created_at: TIMESTAMP       // CURRENT_TIMESTAMP()
}
```

#### `connection_observations` Table Insert Structure

```javascript
{
  id: UUID,                    // Generated via GENERATE_UUID()
  scrape_run_id: STRING,      // Optional
  recruiter_id: STRING,       // Required
  advisor_id: STRING,         // May be NULL or hash ID
  search_id: STRING,          // Optional
  observed_at: TIMESTAMP,     // CURRENT_TIMESTAMP()
  advisor_name: STRING,       // As seen during scrape
  advisor_title: STRING,      // As seen during scrape
  advisor_location: STRING,    // As seen during scrape
  advisor_linkedin_url: STRING, // As seen during scrape
  search_job_title: STRING,   // Job title search
  created_at: TIMESTAMP       // CURRENT_TIMESTAMP()
}
```

---

## 6. Backfill/Migration Code

### Backfill Script: `BACKFILL_OBSERVATIONS_ADVISOR_ID.sql`

**Location:** `big_query/BACKFILL_OBSERVATIONS_ADVISOR_ID.sql`

**Purpose:** Fixes `advisor_id` in `connection_observations` table by matching observations to advisors using LinkedIn slug.

**Note:** This script cannot run on streaming buffer rows. Must wait ~90 minutes after inserts before running.

**Steps:**
1. Check how many observations need fixing
2. Preview what will be updated
3. Create temporary table with matches
4. Update observations using temporary table
5. Clean up temporary table
6. Verify the fix

---

### View: `v_observations_with_advisors`

**Purpose:** Provides correct `advisor_id` for observations by joining with `advisors` table on `linkedin_id` (slug).

**Use Case:** Query-time correction for observations that have NULL or hash `advisor_id` values.

**Key Features:**
- Joins `connection_observations` with `advisors` on LinkedIn slug
- Provides `match_status` field showing how `advisor_id` was determined
- Handles streaming buffer limitations (can't UPDATE, but can query via view)

---

### Migration Scripts (Historical)

**Location:** `big_query/sql/migrate_to_toronto*.sql`

These scripts were used to migrate the dataset from `US` region to `northamerica-northeast2` (Toronto) to enable cross-region queries with `FinTrx_data_CA` dataset.

**Status:** Completed - dataset is now in Toronto region.

---

## 7. Data Flow Summary

```
Chrome Extension (Scrape)
    ↓
background/sync_queue.js
    ↓
background/bigquery_sync.js
    ↓
Apps Script Web App (Code.gs)
    ↓
BigQuery API
    ↓
savvy-gtm-analytics.savvy_pirate dataset
    ├── advisors (streaming)
    ├── connections (streaming)
    ├── connection_observations (streaming)
    └── scrape_runs
```

---

## 8. Key Implementation Details

### Streaming Buffer Limitations

- **Tables using streaming inserts:** `advisors`, `connections`, `connection_observations`
- **Buffer flush time:** ~90 minutes
- **Cannot UPDATE/DELETE** rows in streaming buffer
- **Workaround:** Use views (`v_observations_with_advisors`) for query-time correction

### Advisor ID Matching Strategy

1. **During Scrape (Real-time):**
   - `syncProfiles` creates/updates `advisors` table
   - Returns `advisorIds` array
   - `recordObservationsBatch` uses these IDs directly

2. **Query-time (Fallback):**
   - If `advisor_id` is NULL or hash ID in `connection_observations`
   - Use `v_observations_with_advisors` view
   - Joins on `linkedin_id` (slug) for matching

### SQL Escaping

Apps Script uses `escapeSql()` function to prevent SQL injection:
- Escapes single quotes (`'` → `''`)
- Escapes backslashes (`\` → `\\`)
- Escapes newlines, carriage returns, tabs

### Type Casting

Explicit type casting in SQL to prevent BigQuery type inference errors:
- `accreditations`: Cast to `ARRAY<STRING>`
- `search_type`: Cast to `STRING`

---

## 9. Summary

### Current State
- ✅ **29 recruiters** configured (seed data)
- ✅ **261 searches** configured (seed data)
- ✅ **37 advisors** in production (after test data clear)
- ✅ **37 connections** tracked
- ✅ **163 observations** in streaming buffer
- ✅ **0 scrape runs** (ready for production)
- ✅ **0 analyses** (ready for first Monday analysis)

### Integration Status
- ✅ Apps Script Web App deployed and configured
- ✅ Chrome Extension integrated with BigQuery sync
- ✅ Queue processor syncing to BigQuery after Sheets
- ✅ All tables created and ready
- ✅ Views and functions created
- ✅ Cross-region dataset migration complete (Toronto)

### Next Steps
1. Run first production scrape
2. Wait for streaming buffer to flush (~90 minutes)
3. Run first Monday analysis (scheduled query)
4. Generate export reports
5. Set up Looker Studio dashboard

---

**Report Generated:** 2025-12-29  
**Dataset Location:** `savvy-gtm-analytics.savvy_pirate` (Toronto)  
**Status:** ✅ Ready for Production

