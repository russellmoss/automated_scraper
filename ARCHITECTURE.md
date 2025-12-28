# 🏗️ Savvy Pirate Architecture Overview

**Version:** 2.0.0  
**Last Updated:** December 2024  
**Purpose:** Complete architectural documentation of the Savvy Pirate Chrome Extension and BigQuery Intelligence System

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Directory Structure](#directory-structure)
3. [Chrome Extension Architecture](#chrome-extension-architecture)
4. [BigQuery Intelligence System](#bigquery-intelligence-system)
5. [Data Flow](#data-flow)
6. [Key Components](#key-components)
7. [Integration Points](#integration-points)

---

## 🎯 System Overview

Savvy Pirate is a **two-part system**:

1. **Chrome Extension** - Automated LinkedIn scraping and Google Sheets sync
2. **BigQuery Intelligence Platform** - Advanced analytics, CRM matching, and reporting

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SAVVY PIRATE ECOSYSTEM                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────┐   │
│  │  Chrome          │         │  BigQuery Intelligence    │   │
│  │  Extension       │─────────▶│  Platform                │   │
│  │                  │  HTTP   │                          │   │
│  │  • Scraping      │  POST   │  • Analytics             │   │
│  │  • Sheets Sync   │         │  • CRM Matching          │   │
│  │  • Scheduling    │         │  • Reporting             │   │
│  └──────────────────┘         └──────────────────────────┘   │
│           │                              │                     │
│           ▼                              ▼                     │
│  ┌──────────────────┐         ┌──────────────────────────┐   │
│  │  Google Sheets   │         │  Looker Studio           │   │
│  │  (Command Center)│         │  Dashboard              │   │
│  └──────────────────┘         └──────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📂 Directory Structure

### Root Directory

```
automated_scraper/
├── 📄 ARCHITECTURE.md                    # This file - system architecture documentation
├── 📄 README.md                          # Main extension documentation and user guide
├── 📄 SAVVY-PIRATE-V2-BUILD-GUIDE.md     # Build and deployment guide
├── 📄 auth-monitoring-plan.md            # Authentication monitoring strategy
├── 📄 scheduling-plan.md                 # Scheduling system design
│
├── 📁 background/                        # Service Worker scripts (background execution)
├── 📁 content/                          # Content scripts (injected into LinkedIn pages)
├── 📁 popup/                            # Extension UI (side panel)
├── 📁 utils/                            # Shared utilities and constants
├── 📁 icons/                            # Extension icons
├── 📁 config/                           # Configuration files (service account keys)
├── 📁 big_query/                        # BigQuery intelligence system
│
├── 📄 manifest.json                      # Extension manifest (⚠️ NOT in git)
├── 📄 manifest-template.json            # Template for manifest.json
├── 📄 linkedin-diagnostic.js            # LinkedIn DOM diagnostic tool
├── 📄 deploy-to-pi.sh                   # Deployment script (Linux/Mac)
├── 📄 Deploy-to-Pi.bat                  # Deployment script (Windows)
└── 📄 .gitignore                        # Git ignore rules
```

---

## 📁 Directory Definitions

### `/background/` - Service Worker Scripts

**Purpose:** Background scripts that run continuously, even when extension popup is closed.

| File | Purpose | Key Functions |
|------|---------|---------------|
| `service_worker.js` | **Main orchestration hub** - coordinates all extension operations | Message routing, scraping orchestration, queue management, schedule execution |
| `auth.js` | **Authentication management** - Google Service Account JWT tokens | Token generation, refresh, caching, service account setup |
| `sheets_api.js` | **Google Sheets API wrapper** - all Sheets operations | Read/write sheets, create tabs, compare tabs, manage headers |
| `sync_queue.js` | **Local data queue** - retry logic for failed syncs | Queue management, exponential backoff, failed item tracking |
| `scheduler.js` | **Schedule management** - automated scraping schedules | Schedule CRUD, execution tracking, next-run calculation, local overrides |
| `sheet_sync.js` | **Workbook sync** - syncs Command Center workbook to extension | Load workbook config, sync schedules, map sources to workbooks |
| `notifications.js` | **Webhook notifications** - Zapier integration | Send webhooks, notification formatting, error handling |
| `setup_service_account.js` | **Service account setup utility** - one-time setup helper | Service account configuration validation |

**Key Characteristics:**
- All files use ES6 modules (`import`/`export`)
- Service worker is always running (kept alive by alarms)
- Handles all Chrome extension message passing
- Manages Chrome storage (local storage for all data)

---

### `/content/` - Content Scripts

**Purpose:** Scripts injected into LinkedIn pages to scrape profile data.

| File | Purpose | Key Functions |
|------|---------|---------------|
| `content.js` | **LinkedIn DOM scraping** - extracts profile data from search pages | Profile card detection, data extraction, pagination, stop button overlay |

**Key Characteristics:**
- Only runs on LinkedIn search result pages (`linkedin.com/search/results/people/*`)
- Uses multi-layer selector strategy (primary + fallback selectors)
- Sends scraped data to service worker via `chrome.runtime.sendMessage`
- Handles stop button for manual/scheduled scrapes

---

### `/popup/` - Extension UI

**Purpose:** User interface for configuration and monitoring.

| File | Purpose | Key Functions |
|------|---------|---------------|
| `popup.html` | **UI structure** - HTML markup for side panel | Form elements, sections, navigation |
| `popup.css` | **Styling** - dark theme, responsive layout | Visual design, animations, responsive breakpoints |
| `popup.js` | **UI controller** - handles user interactions | Event handlers, API calls, state management, real-time updates |

**Key Sections:**
- 🔑 Google Service Account configuration
- 📘 Workbook Configuration (Live Sync)
- 🔍 Manual Scraping
- ⏰ Schedules management
- 📜 Execution History
- 📊 Compare Tabs
- ⚙️ Settings (webhooks)

---

### `/utils/` - Shared Utilities

**Purpose:** Shared constants and configuration used across all modules.

| File | Purpose | Key Exports |
|------|---------|-------------|
| `constants.js` | **Shared constants** - configuration values, message actions, storage keys | `CONFIG`, `ALARM_NAMES`, `STORAGE_KEYS`, `MESSAGE_ACTIONS`, `LOG_PREFIXES` |

**Key Constants:**
- `CONFIG` - Timing, delays, retry settings
- `ALARM_NAMES` - Chrome alarm identifiers
- `STORAGE_KEYS` - Chrome storage key names
- `MESSAGE_ACTIONS` - Message action types for inter-component communication
- `LOG_PREFIXES` - Logging prefixes for debugging

---

### `/icons/` - Extension Icons

**Purpose:** Extension icons for Chrome extension UI.

| File | Purpose |
|------|---------|
| `icon16.png` | Toolbar icon (16×16) |
| `icon48.png` | Extension management page (48×48) |
| `icon128.png` | Chrome Web Store (128×128) |

---

### `/config/` - Configuration Files

**Purpose:** Service account credentials and configuration templates.

| File | Purpose | Security |
|------|---------|---------|
| `service-account-key.template.json` | Template for service account JSON key | ✅ Safe to commit |
| `savvy-pirate-extension-*.json` | Actual service account key (if present) | ⚠️ **NEVER commit** - contains private key |

**Note:** Service account keys contain private keys and should NEVER be committed to git.

---

### `/big_query/` - BigQuery Intelligence System

**Purpose:** Advanced analytics, CRM matching, and intelligence platform built on Google BigQuery.

#### Subdirectories:

**`/big_query/chrome-extension-integration/`**
- `bigquery_sync.js` - Chrome extension module for syncing scraped data to BigQuery via Cloud Function

**`/big_query/cloud-functions/`**
- `savvy-pirate-sync/` - Google Cloud Function for receiving extension data
  - `index.js` - Cloud Function handler (syncs profiles, manages recruiters, records observations)
  - `package.json` - Node.js dependencies

**`/big_query/sql/`**
- `001_schema.sql` - BigQuery table and view definitions
- `002_monday_analysis_scheduled_query.sql` - Weekly analysis automation
- `003_csv_export_queries.sql` - Export queries for sales team

#### Documentation Files:

| File | Purpose |
|------|---------|
| `SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md` | **Complete implementation guide** - 10-phase setup process (v4.4) |
| `CURSOR_PROMPTS_UPGRADE_TO_A_PLUS.md` | Upgrade prompts for implementation guide |
| `CURSOR_PROMPT_PHASE2_CRM_AND_FINTRX.md` | CRM and FINTRX integration prompts |
| `README.md` | BigQuery system overview |

---

## 🔧 Chrome Extension Architecture

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────┐  │
│  │   Content    │      │   Service    │      │  Popup   │  │
│  │   Script     │─────▶│   Worker     │◀─────│   UI     │  │
│  │              │      │              │      │          │  │
│  │ LinkedIn DOM │      │ Orchestration│      │ User     │  │
│  │ Scraping     │      │ & Logic      │      │ Interface│  │
│  └──────────────┘      └──────────────┘      └──────────┘  │
│         │                      │                   │        │
│         │                      │                   │        │
│         └──────────────────────┼───────────────────┘        │
│                                │                             │
│                                ▼                             │
│                    ┌─────────────────────┐                   │
│                    │  Chrome Storage     │                   │
│                    │  (Local Storage)   │                   │
│                    └─────────────────────┘                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Component Communication

**Message Passing:**
- Content Script ↔ Service Worker: `chrome.runtime.sendMessage`
- Popup ↔ Service Worker: `chrome.runtime.sendMessage`
- Service Worker → Popup: `chrome.runtime.onMessage` listener

**Storage:**
- All data stored in `chrome.storage.local`
- Persistent across extension restarts
- Encrypted by Chrome

**Alarms:**
- Schedule checking (every 1 minute)
- Queue processing (every 1 minute)
- Keep-alive (every 30 seconds)
- Token refresh (proactive)
- Workbook sync (configurable interval)

---

## 📊 BigQuery Intelligence System Architecture

### System Components

```
┌──────────────────────────────────────────────────────────────┐
│              BIGQUERY INTELLIGENCE PLATFORM                   │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │   Chrome     │    │    Cloud     │    │  BigQuery    │   │
│  │  Extension   │───▶│  Function    │───▶│   Dataset    │   │
│  │              │    │              │    │              │   │
│  │ Scrapes      │    │ Receives &   │    │ • 12 Tables  │   │
│  │ LinkedIn     │    │ Processes    │    │ • 5 Views    │   │
│  │              │    │              │    │ • 5 Functions│   │
│  └──────────────┘    └──────────────┘    └──────────────┘   │
│         │                    │                   │          │
│         │                    │                   │          │
│         ▼                    ▼                   ▼          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ Google Sheets│    │  Cloud       │    │  Looker      │   │
│  │ Command      │    │  Scheduler   │    │  Studio      │   │
│  │ Center       │    │              │    │  Dashboard   │   │
│  └──────────────┘    └──────────────┘    └──────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### BigQuery Dataset Structure

**Dataset:** `savvy-gtm-analytics.savvy_pirate`

#### Tables (12 total):

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `recruiters` | Monitored recruiters (29) | id, name, frequency, output_sheet_url |
| `searches` | LinkedIn search URLs (261) | id, recruiter_id, linkedin_search_url |
| `advisors` | All discovered advisors | id, linkedin_url, name, current_title, crd_number |
| `connections` | Advisor ↔ Recruiter relationships | advisor_id, recruiter_id, first_seen_date |
| `connection_observations` | **Point-in-time scrape storage** | scrape_run_id, observed_at, advisor snapshot |
| `scrape_runs` | Execution history | id, recruiter_id, started_at, profiles_scraped |
| `weekly_analyses` | Analysis run logs | id, analysis_date, frequency_group, totals |
| `new_advisor_reports` | New advisors per analysis | advisor_id, recruiter_id, first_seen_date |
| `advisor_movement_alerts` | Multi-recruiter appearances | advisor_id, recruiter_count, severity |
| `advisor_job_changes` | Title/company changes | advisor_id, change_type, previous_title, new_title |
| `crm_match_results` | Salesforce matches | advisor_id, lead_id, opportunity_id, match_type |
| *(Analysis tables)* | Various analysis outputs | - |

#### Views (5 total):

| View | Purpose |
|------|---------|
| `v_advisors_on_move` | Advisors appearing in 2+ recruiter networks |
| `v_crm_match_candidates` | Advisors ready for CRM matching |
| `v_advisors_with_crd` | Advisors enriched with FINTRX CRD numbers |
| `v_disappeared_connections` | Advisors who left recruiter networks |
| `v_scrape_history` | Historical scrape summary by recruiter/date |

#### Functions (5 total):

| Function | Purpose |
|----------|---------|
| `get_week_of_month(date)` | Returns week number (1-4) for a date |
| `get_active_frequency(date)` | Returns '1st_3rd_week' or '2nd_4th_week' |
| `normalize_linkedin_url(url)` | Extracts and normalizes LinkedIn profile ID |
| `normalize_name(name)` | Normalizes names for matching (lowercase, trim) |
| `extract_linkedin_slug(url)` | Extracts LinkedIn slug from URL for FINTRX matching |

---

## 🔄 Data Flow

### Scraping Flow

```
1. User triggers scrape (manual or scheduled)
   ↓
2. Service Worker creates scrape run record
   ↓
3. Service Worker navigates to LinkedIn search URL
   ↓
4. Content Script injected into LinkedIn page
   ↓
5. Content Script finds profile cards (multi-layer selectors)
   ↓
6. Content Script extracts: name, title, location, LinkedIn URL, accreditations
   ↓
7. Content Script sends profiles to Service Worker via message
   ↓
8. Service Worker adds profiles to local queue
   ↓
9. Queue processor syncs to Google Sheets (with retry logic)
   ↓
10. Service Worker syncs to BigQuery (via Cloud Function)
   ↓
11. Service Worker records observations (point-in-time storage)
   ↓
12. Service Worker updates execution record with profile count
```

### BigQuery Sync Flow

```
Chrome Extension
   ↓
bigquery_sync.js
   ↓ (HTTP POST)
Cloud Function (savvy-pirate-sync)
   ↓
BigQuery Tables:
   • advisors (upsert)
   • connections (upsert)
   • connection_observations (append-only)
   • scrape_runs (update)
```

### Weekly Analysis Flow

```
Cloud Scheduler (Monday 6 AM ET)
   ↓
BigQuery Scheduled Query
   ↓
Analysis Script:
   1. Determine frequency group (1st/3rd vs 2nd/4th week)
   2. Find NEW advisors (current period - previous period)
   3. Detect "on the move" advisors (2+ recruiters)
   4. Match with CRM (Salesforce Lead/Opportunity)
   5. Detect job changes
   6. Generate reports
   ↓
Analysis Tables:
   • new_advisor_reports
   • advisor_movement_alerts
   • crm_match_results
   • advisor_job_changes
   ↓
Looker Studio Dashboard (auto-refresh)
   ↓
Sales Team (views dashboard)
```

---

## 🔑 Key Components

### Chrome Extension Components

#### 1. Service Worker (`background/service_worker.js`)

**Role:** Central orchestrator

**Responsibilities:**
- Message routing between popup and content script
- Scraping orchestration (manual and scheduled)
- Queue management and processing
- Schedule checking and execution
- Google Sheets API coordination
- BigQuery sync coordination
- Webhook notifications
- Execution history tracking

**Key State:**
- `autoRunState` - Current auto-run status
- `manualScrapeState` - Manual scrape progress
- `dedicatedScrapeTabId` - Reusable scrape tab

#### 2. Content Script (`content/content.js`)

**Role:** LinkedIn DOM interaction

**Responsibilities:**
- Profile card detection (multi-layer fallback selectors)
- Data extraction (name, title, location, URL, accreditations)
- Pagination handling
- Stop button overlay
- Scrolling for lazy-loaded content

**Key Functions:**
- `findProfileCards()` - Multi-selector profile detection
- `scrapeCurrentPage()` - Extract all profiles from current page
- `startScraping()` - Main scraping loop

#### 3. Popup UI (`popup/popup.js`)

**Role:** User interface

**Responsibilities:**
- Display schedules and execution history
- Manual scrape controls
- Workbook configuration
- Settings management
- Real-time progress updates

**Key Sections:**
- Service Account configuration
- Workbook Configuration (Live Sync)
- Manual Scraping
- Schedules
- Execution History
- Compare Tabs
- Settings

#### 4. Authentication (`background/auth.js`)

**Role:** Google Service Account authentication

**Responsibilities:**
- JWT token generation (signed with private key)
- Token exchange (JWT → access token)
- Token caching and refresh
- Service account setup validation

**Key Functions:**
- `getAuthToken()` - Get valid access token (cached or fresh)
- `ensureFreshToken()` - Ensure token is valid (refresh if needed)
- `setupServiceAccount()` - Configure service account from JSON

#### 5. Sheets API (`background/sheets_api.js`)

**Role:** Google Sheets operations

**Responsibilities:**
- Read/write spreadsheet data
- Tab management (create, list, compare)
- Weekly tab creation
- Header management
- Data validation

**Key Functions:**
- `appendRowsToTab()` - Add rows to specific tab
- `ensureWeeklyTab()` - Create weekly tab if needed
- `compareTabs()` - Find differences between tabs
- `getTabData()` - Read all data from a tab

#### 6. Sync Queue (`background/sync_queue.js`)

**Role:** Local-first data queue

**Responsibilities:**
- Queue management (add, process, retry)
- Exponential backoff retry logic
- Failed item tracking
- Queue persistence

**Key Functions:**
- `addToQueue()` - Add profiles to queue
- `processQueue()` - Process queue items
- `retryFailedItems()` - Retry failed syncs

#### 7. Scheduler (`background/scheduler.js`)

**Role:** Schedule management

**Responsibilities:**
- Schedule CRUD operations
- Next-run calculation
- Execution history
- Local overrides (user toggles)

**Key Functions:**
- `checkSchedules()` - Check if any schedules should run
- `calculateNextRun()` - Calculate next execution time
- `setScheduleLocalOverride()` - Store user toggle state
- `getEffectiveEnabled()` - Get effective enabled state (with overrides)

#### 8. Workbook Sync (`background/sheet_sync.js`)

**Role:** Command Center workbook sync

**Responsibilities:**
- Load workbook configuration
- Sync schedules from workbook
- Map sources to output workbooks
- Periodic background sync

**Key Functions:**
- `loadWorkbookConfig()` - Load and parse Command Center workbook
- `syncWorkbookConfig()` - Sync changes from workbook
- `getWorkbookConfig()` - Get current workbook config

#### 9. Notifications (`background/notifications.js`)

**Role:** Webhook notifications

**Responsibilities:**
- Send webhook notifications to Zapier
- Format notification payloads
- Error handling and retry

**Key Functions:**
- `notifyScheduleStarted()` - Send schedule start notification
- `notifyScheduleCompleted()` - Send completion notification
- `testWebhook()` - Test webhook connection

---

### BigQuery System Components

#### 1. Cloud Function (`big_query/cloud-functions/savvy-pirate-sync/index.js`)

**Role:** HTTP endpoint for Chrome Extension

**Actions:**
- `sync_profiles` - Upsert advisors and connections
- `get_or_create_recruiter` - Manage recruiter records
- `create_scrape_run` - Create scrape execution record
- `complete_scrape_run` - Update scrape run with results
- `record_observation` - Record single observation
- `record_observations_batch` - Batch record observations
- `sync_recruiters` - Sync recruiters from Google Sheets
- `test_connection` - Health check

#### 2. BigQuery Sync Module (`big_query/chrome-extension-integration/bigquery_sync.js`)

**Role:** Chrome extension → BigQuery bridge

**Functions:**
- `syncProfilesToBigQuery()` - Sync scraped profiles
- `recordSearchObservations()` - Record point-in-time observations
- `getOrCreateRecruiter()` - Manage recruiter in BigQuery
- `createScrapeRun()` - Create scrape run record
- `completeScrapeRun()` - Complete scrape run
- `initBigQueryConfig()` - Load Cloud Function URL
- `saveBigQueryConfig()` - Save Cloud Function URL

#### 3. SQL Scripts (`big_query/sql/`)

**Role:** BigQuery schema and queries

| File | Purpose |
|------|---------|
| `001_schema.sql` | All table, view, and function definitions |
| `002_monday_analysis_scheduled_query.sql` | Weekly automated analysis |
| `003_csv_export_queries.sql` | Export queries for sales team |

---

## 🔗 Integration Points

### Chrome Extension ↔ Google Sheets

**Integration:** Google Sheets API (via Service Account)

**Data Flow:**
- Extension reads Command Center workbook (`Searches` and `Mapping and Schedules` tabs)
- Extension writes scraped data to output workbooks
- Extension creates weekly tabs automatically
- Extension syncs schedules from workbook

**Key Files:**
- `background/sheets_api.js` - All Sheets API operations
- `background/sheet_sync.js` - Workbook sync logic

### Chrome Extension ↔ BigQuery

**Integration:** Google Cloud Function (HTTP)

**Data Flow:**
- Extension sends scraped profiles to Cloud Function
- Cloud Function upserts to BigQuery tables
- Extension records point-in-time observations
- Cloud Function handles recruiter management

**Key Files:**
- `big_query/chrome-extension-integration/bigquery_sync.js` - Extension side
- `big_query/cloud-functions/savvy-pirate-sync/index.js` - Cloud Function

### Google Sheets ↔ BigQuery

**Integration:** Cloud Function sync (`sync_recruiters` action)

**Data Flow:**
- Cloud Function reads Command Center workbook
- Cloud Function syncs recruiters to BigQuery
- Updates frequency groups, output sheet URLs
- Regenerates searches table

**Key Files:**
- `big_query/cloud-functions/savvy-pirate-sync/index.js` - `syncRecruitersFromSheets()` function

### BigQuery ↔ Salesforce

**Integration:** BigQuery views and matching logic

**Data Flow:**
- BigQuery views match advisors to Salesforce Lead/Opportunity
- Matching by LinkedIn URL (exact) or name (fuzzy)
- Results stored in `crm_match_results` table

**Key Files:**
- `big_query/SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md` - Phase 2 CRM matching

### BigQuery ↔ FINTRX

**Integration:** BigQuery view (`v_advisors_with_crd`)

**Data Flow:**
- View matches advisors to FINTRX `ria_contacts_current` table
- Matching by LinkedIn slug (primary) or exact name (secondary)
- Enriches advisors with CRD numbers and firm info

**Key Files:**
- `big_query/SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md` - Step 2.3 FINTRX enrichment

### BigQuery ↔ Looker Studio

**Integration:** BigQuery data source connections

**Data Flow:**
- Looker Studio connects to BigQuery views
- Dashboard auto-refreshes (configurable interval)
- Sales team views unified dashboard

**Key Files:**
- `big_query/SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md` - Phase 9 Looker Studio

---

## 📊 Data Models

### Chrome Extension Storage Schema

**Storage Keys (from `utils/constants.js`):**

```javascript
STORAGE_KEYS = {
    // Settings
    INPUT_SHEET_ID: 'inputSheetId',
    SAVED_WORKBOOKS: 'savedWorkbooks',
    SOURCE_MAPPING: 'sourceMapping',
    
    // Schedules
    SCHEDULES: 'schedules',
    EXECUTION_HISTORY: 'executionHistory',
    PENDING_SCHEDULES: 'pendingSchedules',
    SCHEDULE_LOCAL_OVERRIDES: 'scheduleLocalOverrides',
    
    // State
    SYNC_QUEUE: 'syncQueue',
    FAILED_ROWS: 'failedRows',
    AUTO_RUN_STATE: 'autoRunState',
    CURRENT_SEARCH_INDEX: 'searchIndex',
    DEDICATED_SCRAPE_TAB_ID: 'dedicatedScrapeTabId',
    
    // Notifications
    WEBHOOK_URL: 'webhookUrl',
    
    // Live workbook sync
    WORKBOOK_CONFIG: 'workbookConfig',
    SYNC_INTERVAL_MINUTES: 'syncIntervalMinutes',
    LAST_SYNC_CHANGES: 'lastSyncChanges',
    
    // Service Account
    SERVICE_ACCOUNT_KEY: 'serviceAccountKey',
    SERVICE_ACCOUNT_EMAIL: 'serviceAccountEmail',
    
    // BigQuery
    BIGQUERY_CONFIG: 'bigquery_config'
}
```

### Schedule Object Schema

```javascript
{
    id: string,                    // Unique schedule ID
    sourceName: string,           // Recruiter/source name
    dayOfWeek: number,            // 0-6 (Sunday-Saturday)
    hour: number,                 // 0-23
    minute: number,              // 0-59
    frequency: string,          // 'weekly', '1st_3rd_week', '2nd_4th_week'
    weekPattern: string | null, // 'odd' or 'even' (for biweekly)
    enabled: boolean,           // Base enabled state
    managedBy: string | null,  // 'workbookSync' if synced from workbook
    nextRun: timestamp,       // Next scheduled execution time
    lastRun: timestamp | null, // Last execution time
    createdAt: timestamp,
    updatedAt: timestamp
}
```

### Execution Record Schema

```javascript
{
    id: string,
    sourceName: string,
    startedAt: timestamp,
    completedAt: timestamp | null,
    status: string,              // 'running', 'completed', 'failed', 'aborted'
    profilesScraped: number,
    searchesCompleted: number,
    totalSearches: number,
    sheetUrl: string,           // Link to Google Sheets tab
    errorMessage: string | null
}
```

### Queue Item Schema

```javascript
{
    id: string,
    data: object,               // Profile data
    workbookId: string,
    tabName: string,
    retries: number,
    lastError: string | null,
    timestamp: timestamp
}
```

---

## 🔐 Security & Authentication

### Google Service Account Authentication

**Method:** JWT-based authentication (no user interaction)

**Flow:**
1. Extension loads service account JSON key (stored in `chrome.storage.local`)
2. Extension generates JWT signed with private key
3. Extension exchanges JWT for access token via Google OAuth endpoint
4. Extension caches token and auto-refreshes before expiry

**Key Files:**
- `background/auth.js` - JWT generation and token management
- `config/service-account-key.template.json` - Template (safe to commit)
- `config/savvy-pirate-extension-*.json` - Actual key (⚠️ NEVER commit)

**Security Notes:**
- Service account JSON key contains private key - **NEVER commit to git**
- Key is stored in Chrome's encrypted local storage
- Service account email is public and safe to share (for Sheet sharing)

### BigQuery Cloud Function Authentication

**Method:** HTTP endpoint (allow-unauthenticated for extension access)

**Security:**
- Cloud Function URL stored in extension storage
- No authentication required (public endpoint)
- Input validation in Cloud Function
- IAM permissions restrict BigQuery access to service account

---

## 🚀 Deployment

### Chrome Extension Deployment

**Local Development:**
1. Load extension from directory: `chrome://extensions` → Load unpacked
2. Make code changes
3. Click "Reload" on extension

**Raspberry Pi Deployment:**
1. Use `deploy-to-pi.sh` or `Deploy-to-Pi.bat`
2. Script copies files to Pi via SCP
3. Reload extension in Chromium on Pi

**Key Files:**
- `deploy-to-pi.sh` - Linux/Mac deployment script
- `Deploy-to-Pi.bat` - Windows wrapper

### BigQuery System Deployment

**Cloud Function:**
```bash
cd big_query/cloud-functions/savvy-pirate-sync
npm install
gcloud functions deploy savvy-pirate-sync --runtime nodejs18 --trigger-http
```

**BigQuery Schema:**
- Run SQL scripts from `big_query/sql/` in BigQuery Console
- Or use implementation guide (Phase 1)

**Key Files:**
- `big_query/cloud-functions/savvy-pirate-sync/` - Cloud Function code
- `big_query/sql/` - SQL schema and queries
- `big_query/SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md` - Complete setup guide

---

## 📈 Monitoring & Debugging

### Chrome Extension Logging

**Log Prefixes (from `utils/constants.js`):**
- `[SW]` - Service worker
- `[CS]` - Content script
- `[POPUP]` - Popup UI
- `[SHEETS]` - Sheets API
- `[QUEUE]` - Queue operations
- `[SCHEDULE]` - Scheduling
- `[NOTIFY]` - Webhooks
- `[SYNC]` - Workbook sync
- `[AUTH]` - Authentication
- `[BIGQUERY]` - BigQuery sync

**Debugging:**
- Service Worker Console: `chrome://extensions` → Service worker link
- Content Script Console: Browser console on LinkedIn pages
- Popup Console: Right-click popup → Inspect

### BigQuery Monitoring

**Cloud Function Logs:**
```bash
gcloud functions logs read savvy-pirate-sync --limit 50
```

**BigQuery Query History:**
- View in BigQuery Console → Job history

**Looker Studio:**
- Dashboard shows data freshness
- Auto-refresh configured per data source

---

## 🔄 Update History

### Version 2.0.0 (Current)

**Chrome Extension:**
- Service Account authentication (replaces OAuth)
- Live workbook sync (Command Center)
- Point-in-time observations
- Health checks for stuck scrapes
- Improved profile detection (multi-layer selectors)

**BigQuery System:**
- v4.4 - Point-in-time observations
- v4.3 - FINTRX CRD enrichment
- v4.0 - Initial BigQuery implementation

---

## 📚 Additional Documentation

| Document | Purpose |
|----------|---------|
| `README.md` | Main extension documentation and user guide |
| `SAVVY-PIRATE-V2-BUILD-GUIDE.md` | Build and deployment instructions |
| `auth-monitoring-plan.md` | Authentication monitoring strategy |
| `scheduling-plan.md` | Scheduling system design |
| `big_query/SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md` | Complete BigQuery setup guide (10 phases) |
| `big_query/README.md` | BigQuery system overview |

---

## 🎯 Quick Reference

### Key File Locations

| Need | File Location |
|------|---------------|
| Main extension logic | `background/service_worker.js` |
| LinkedIn scraping | `content/content.js` |
| UI code | `popup/popup.js` |
| Constants/config | `utils/constants.js` |
| BigQuery sync | `big_query/chrome-extension-integration/bigquery_sync.js` |
| Cloud Function | `big_query/cloud-functions/savvy-pirate-sync/index.js` |
| BigQuery schema | `big_query/sql/001_schema.sql` |

### Common Tasks

| Task | How To |
|------|--------|
| Update scraping selectors | Edit `content/content.js` → `SELECTORS` object |
| Change timing/delays | Edit `utils/constants.js` → `CONFIG` object |
| Add new message action | Add to `utils/constants.js` → `MESSAGE_ACTIONS` |
| Update BigQuery schema | Edit `big_query/sql/001_schema.sql` |
| Deploy to Pi | Run `Deploy-to-Pi.bat` or `./deploy-to-pi.sh --files-only` |

---

**Document Version:** 1.0  
**Last Updated:** December 2024  
**Maintainer:** Savvy Pirate Team

