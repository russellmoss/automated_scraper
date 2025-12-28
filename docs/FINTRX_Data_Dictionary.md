# FINTRX Data Dictionary

Complete field-level documentation for all 25 tables in `savvy-gtm-analytics.FinTrx_data`.

**Last Updated**: December 2025  
**Dataset**: `savvy-gtm-analytics.FinTrx_data`

## Table of Contents
1. [Core Contact & Firm Tables](#core-contact--firm-tables)
2. [Historical Snapshot Tables](#historical-snapshot-tables)
3. [Enrichment Tables](#enrichment-tables)
4. [News & Signal Tables](#news--signal-tables)
5. [Compliance & Regulatory Tables](#compliance--regulatory-tables)
6. [Relationship & Association Tables](#relationship--association-tables)

---

## Important Data Type Notes

⚠️ **CRITICAL**: Many fields that appear to contain arrays are actually **STRING** type containing JSON array format. Examples:
- `REP_LICENSES`: STRING containing `["Series 7", "Series 65"]` (JSON array format)
- `RIA_REGISTERED_LOCATIONS`: STRING containing `["CA", "NY"]` (JSON array format)
- `ENTITY_CLASSIFICATION`: STRING containing `["Independent RIA", "Wirehouse"]` (JSON array format)

**Query Syntax**: Use `JSON_EXTRACT_ARRAY()` or `LIKE '%value%'` to query these fields.

---

## Core Contact & Firm Tables

### ria_contacts_current
**Purpose**: Current state of all RIA contacts/reps (advisors)  
**Row Count**: 788,154  
**Primary Key**: `ID` (FINTRX internal ID)  
**Unique Key**: `RIA_CONTACT_CRD_ID` (CRD number)  
**Size**: 2,871.29 MB

#### Key Fields

| Field Name | Data Type | Null Rate | Description | Notes |
|------------|-----------|-----------|-------------|-------|
| `ID` | INT64 | 0% | FINTRX internal identifier | Primary key |
| `RIA_CONTACT_CRD_ID` | INT64 | 0% | Central Registration Depository ID | Unique identifier for rep |
| `RIA_CONTACT_PREFERRED_NAME` | STRING | <1% | Preferred display name | |
| `CONTACT_FIRST_NAME` | STRING | <5% | First name | |
| `CONTACT_LAST_NAME` | STRING | <1% | Last name | |
| `EMAIL` | STRING | 41.12% | Primary email address | |
| `MOBILE_PHONE_NUMBER` | STRING | 97.6% | Mobile phone | Very high NULL rate |
| `OFFICE_PHONE_NUMBER` | STRING | ~60% | Office phone | |
| `LINKEDIN_PROFILE_URL` | STRING | ~30-40% | LinkedIn profile URL | |
| `REP_AUM` | INT64 | **99.1%** | Rep-level assets under management | ⚠️ **Essentially unusable** - use team/firm AUM |
| `INDUSTRY_TENURE_MONTHS` | INT64 | 6.1% | Months of industry experience | Can calculate from employment history |
| `REP_LICENSES` | **STRING** | 0% | **JSON array string** of licenses | ⚠️ **NOT ARRAY** - use `JSON_EXTRACT_ARRAY()` or `LIKE '%Series 7%'` |
| `REP_TYPE` | STRING | ~5% | Rep type | Values: "DR", "BD", "IA", "NA" |
| `PRODUCING_ADVISOR` | BOOLEAN | ~10% | Whether rep is a producing advisor | |
| `PRIMARY_FIRM` | INT64 | 0% | Primary firm CRD ID | Foreign key to ria_firms_current.CRD_ID |
| `PRIMARY_RIA` | INT64 | ~20% | Primary RIA CRD ID | |
| `PRIMARY_BD` | INT64 | ~30% | Primary Broker-Dealer CRD ID | |
| `PRIMARY_FIRM_NAME` | STRING | <1% | Name of primary firm | |
| `PRIMARY_FIRM_TOTAL_AUM` | INT64 | **30.21%** | Total AUM of primary firm | ⚠️ Moderate NULL rate |
| `PRIMARY_FIRM_EMPLOYEE_COUNT` | INT64 | ~25% | Employee count of primary firm | |
| `PRIMARY_FIRM_START_DATE` | DATE | ~15% | Start date at primary firm | |
| `LATEST_REGISTERED_EMPLOYMENT_COMPANY` | STRING | ~10% | Latest employment company name | |
| `LATEST_REGISTERED_EMPLOYMENT_START_DATE` | DATE | ~10% | Latest employment start date | |
| `LATEST_REGISTERED_EMPLOYMENT_END_DATE` | DATE | ~50% | Latest employment end date | NULL if current |
| `CONTACT_OWNERSHIP_PERCENTAGE` | STRING | ~5% | Ownership percentage | e.g., "less than 5%", "No Ownership" |
| `RIA_REGISTERED_LOCATIONS` | **STRING** | ~20% | **JSON array string** of states | ⚠️ **NOT ARRAY** - format: `["CA", "NY"]` |
| `BD_REGISTERED_LOCATIONS` | **STRING** | ~30% | **JSON array string** of BD states | ⚠️ **NOT ARRAY** |
| `CONTACT_HAS_DISCLOSED_*` | BOOLEAN | ~5% | Various disclosure flags | 9 different disclosure types |
| `WEALTH_TEAM_ID_1` | INT64 | **86.96%** | First wealth team ID | ⚠️ High NULL rate - only 13% on teams |
| `WEALTH_TEAM_ID_2` | INT64 | ~98% | Second wealth team ID | |
| `WEALTH_TEAM_ID_3` | INT64 | ~99% | Third wealth team ID | |
| `ACCOLADES` | **STRING** | ~95% | **JSON array string** of accolades | Denormalized from contact_accolades_historicals |
| `PASSIONS_AND_INTERESTS` | **STRING** | ~80% | **JSON array string** of interests | Denormalized from passions_and_interests |
| `NEWS_INFO` | **STRING** | ~95% | **JSON array string** of news mentions | Denormalized from ria_contact_news |
| `LATEST_UPDATE` | TIMESTAMP | <1% | Last update timestamp | |

#### Disclosure Flags (All BOOLEAN)
- `CONTACT_HAS_DISCLOSED_BANKRUPT`
- `CONTACT_HAS_DISCLOSED_BOND`
- `CONTACT_HAS_DISCLOSED_CIVIL_EVENT`
- `CONTACT_HAS_DISCLOSED_CRIMINAL`
- `CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE`
- `CONTACT_HAS_DISCLOSED_INVESTIGATION`
- `CONTACT_HAS_DISCLOSED_JUDGMENT_OR_LIEN`
- `CONTACT_HAS_DISCLOSED_REGULATORY_EVENT`
- `CONTACT_HAS_DISCLOSED_TERMINATION`

#### JSON String Field Examples
```sql
-- REP_LICENSES format: ["Series 63", "Series 65", "SIE", "Series 7"]
-- Query examples:
SELECT * FROM ria_contacts_current 
WHERE REP_LICENSES LIKE '%Series 7%';

SELECT * FROM ria_contacts_current 
WHERE 'Series 7' IN UNNEST(JSON_EXTRACT_ARRAY(REP_LICENSES));
```

---

### ria_firms_current
**Purpose**: Current state of all RIA firms  
**Row Count**: 45,233  
**Primary Key**: `ID` (FINTRX internal ID)  
**Unique Key**: `CRD_ID` (CRD number)  
**Size**: 129.02 MB

#### Key Fields

| Field Name | Data Type | Null Rate | Description | Notes |
|------------|-----------|-----------|-------------|-------|
| `ID` | INT64 | 0% | FINTRX internal identifier | Primary key |
| `CRD_ID` | INT64 | 0% | Central Registration Depository ID | Unique identifier for firm |
| `NAME` | STRING | <1% | Firm name | |
| `ENTITY_CLASSIFICATION` | **STRING** | ~10% | **JSON array string** of classifications | ⚠️ **NOT ARRAY** - format: `["Independent RIA", "Wirehouse"]` |
| `TYPE_ENTITY` | STRING | ~5% | Entity type | Values: "RIA", "BD", etc. |
| `TOTAL_AUM` | INT64 | ~15-20% | Total assets under management | |
| `DISCRETIONARY_AUM` | INT64 | ~20% | Discretionary AUM | |
| `NON_DISCRETIONARY_AUM` | INT64 | ~20% | Non-discretionary AUM | |
| `TOTAL_ACCOUNTS` | INT64 | ~20% | Total number of accounts | |
| `NUM_OF_EMPLOYEES` | INT64 | ~25-30% | Total employee count | |
| `EMPLOYEE_PERFORM_INVESTMENT_ADVISORY_FUNCTIONS_AND_RESEARCH` | INT64 | ~30% | Advisory employees | |
| `CUSTODIAN_PRIMARY_BUSINESS_NAME` | STRING | ~40-50% | Primary custodian name | e.g., "Charles Schwab", "Fidelity" |
| `MAIN_OFFICE_CITY_NAME` | STRING | ~10% | HQ city | |
| `MAIN_OFFICE_STATE` | STRING | ~10% | HQ state | |
| `AUM_YOY` | INT64 | ~30% | Year-over-year AUM change | |
| `AUM_3YOY` | INT64 | ~35% | 3-year AUM change | |
| `AUM_5YOY` | INT64 | ~40% | 5-year AUM change | |
| `CAPITAL_ALLOCATOR` | BOOLEAN | ~5% | Whether firm is a capital allocator | |
| `ACTIVE_ESG_INVESTOR` | BOOLEAN | ~5% | ESG investment focus | |
| `FEE_STRUCTURE` | **STRING** | ~20% | **JSON array string** of fee types | ⚠️ **NOT ARRAY** - format: `["Percentage of AUM", "Fixed Fees"]` |
| `INVESTMENTS_UTILIZED` | **STRING** | ~30% | **JSON array string** of investment types | ⚠️ **NOT ARRAY** |
| `ALTERNATIVES` | **STRING** | ~40% | **JSON array string** of alternative investments | ⚠️ **NOT ARRAY** |
| `LATEST_UPDATE` | TIMESTAMP | <1% | Last update timestamp | |

#### Client Type Breakdown Fields
- `NUM_OF_CLIENTS_HIGH_NET_WORTH_INDIVIDUALS`
- `NUM_OF_CLIENTS_NON_HIGH_NET_WORTH_INDIVIDUALS`
- `AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS`
- `AMT_OF_AUM_NON_HIGH_NET_WORTH_INDIVIDUALS`
- (Similar fields for other client types: Banking/Thrift, Investment Companies, etc.)

---

## Historical Snapshot Tables

### Firm_historicals
**Purpose**: Monthly snapshots of firm-level metrics (AUM, client counts, etc.)  
**Row Count**: 926,712  
**Primary Key**: `RIA_INVESTOR_CRD_ID`, `YEAR`, `MONTH`  
**Date Range**: January 2024 to November 2025 (23 snapshots)  
**Unique Firms**: 49,645  
**Size**: 251.23 MB

#### Key Fields

| Field Name | Data Type | Description | Notes |
|------------|-----------|-------------|-------|
| `RIA_INVESTOR_CRD_ID` | INT64 | Firm CRD ID | Foreign key to ria_firms_current.CRD_ID |
| `YEAR` | INT64 | Snapshot year | Part of composite key |
| `MONTH` | INT64 | Snapshot month (1-12) | Part of composite key |
| `QUARTER` | INT64 | Snapshot quarter (1-4) | |
| `TOTAL_AUM` | INT64 | Total AUM for this snapshot | **92-93% coverage** per month |
| `DISCRETIONARY_AUM` | INT64 | Discretionary AUM | |
| `NON_DISCRETIONARY_AUM` | INT64 | Non-discretionary AUM | |
| `TOTAL_ACCOUNTS` | INT64 | Total accounts | |
| `NUM_OF_CLIENTS_HIGH_NET_WORTH_INDIVIDUALS` | INT64 | HNW client count | |
| `AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS` | INT64 | HNW AUM amount | |
| (Similar client type fields as ria_firms_current) | | | |

**Coverage by Month**:
- January 2024: 39,229 firms, 92.3% AUM coverage
- November 2025: 45,349 firms, 93.7% AUM coverage
- Average: ~40,000 firms per month, 92-93% AUM coverage

**Usage**: Use this table for point-in-time queries. Filter by `YEAR` and `MONTH` to get firm state as of a specific date.

⚠️ **IMPORTANT**: This is the **ONLY** table with monthly snapshots. There are **NO contact-level historical snapshots**.

---

### contact_registered_employment_history
**Purpose**: Historical employment records for contacts  
**Row Count**: 2,204,074  
**Primary Key**: `RIA_CONTACT_CRD_ID`, `PREVIOUS_REGISTRATION_COMPANY_CRD_ID`  
**Size**: 162.11 MB

#### Key Fields

| Field Name | Data Type | Description | Notes |
|------------|-----------|-------------|-------|
| `RIA_CONTACT_CRD_ID` | INT64 | Contact CRD ID | Foreign key to ria_contacts_current |
| `PREVIOUS_REGISTRATION_COMPANY_CRD_ID` | INT64 | Company CRD ID | Foreign key to ria_firms_current |
| `PREVIOUS_REGISTRATION_COMPANY_NAME` | STRING | Company name | |
| `PREVIOUS_REGISTRATION_COMPANY_START_DATE` | DATE | Employment start date | |
| `PREVIOUS_REGISTRATION_COMPANY_END_DATE` | DATE | Employment end date | NULL if current |
| `PREVIOUS_REGISTRATION_COMPANY_CITY` | STRING | Employment city | |
| `PREVIOUS_REGISTRATION_COMPANY_STATE` | STRING | Employment state | |

**Usage**: Use this to determine where a rep worked at any point in time. Filter by date ranges to get employment as of a specific date.

**Average Records per Contact**: 2.8

---

### contact_state_registrations_historicals
**Purpose**: Historical state registration records for contacts  
**Row Count**: 19,111,888  
**Primary Key**: Composite (CRD + State + Date)  
**Size**: 956.93 MB

#### Key Fields

| Field Name | Data Type | Description | Notes |
|------------|-----------|-------------|-------|
| `contact_crd_id` | INT64 | Contact CRD ID | |
| `period` | STRING | Snapshot period | Format: "YYYY-MM" |
| `registerations_regulator` | STRING | State code | |
| `registerations_registeration` | STRING | Registration type | e.g., "RA" |
| `registerations_registeration_status` | STRING | Status | e.g., "APPROVED" |
| `registerations_registeration_date` | DATE | Registration date | |
| `active` | BOOLEAN | Whether active | |

**Usage**: Determine what states a rep was registered in at a specific point in time. Filter by `period` and `registerations_registeration_date`.

---

### contact_broker_dealer_state_historicals
**Purpose**: Historical BD state registration records  
**Row Count**: 85,642  
**Size**: 3.27 MB

#### Key Fields

| Field Name | Data Type | Description | Notes |
|------------|-----------|-------------|-------|
| `contact_crd_id` | INT64 | Contact CRD ID | |
| `registration_date` | DATE | Registration date | |
| `registration_scope` | STRING | Registration scope | |
| `state` | STRING | State code | |
| `period` | STRING | Snapshot period | Format: "YYYY-MM" |

Similar structure to `contact_state_registrations_historicals` but for Broker-Dealer registrations.

---

### custodians_historicals
**Purpose**: Historical custodian relationships for firms  
**Row Count**: 652,232  
**Snapshot Field**: `period` (format: "YYYY-MM")  
**Size**: 75.20 MB

#### Key Fields

| Field Name | Data Type | Description | Notes |
|------------|-----------|-------------|-------|
| `RIA_INVESTOR_CRD_ID` | INT64 | Firm CRD ID | Foreign key to ria_firms_current |
| `PRIMARY_BUSINESS_NAME` | STRING | Custodian name | e.g., "Charles Schwab", "Fidelity" |
| `LEGAL_NAME` | STRING | Legal custodian name | |
| `AMOUNT_HELD` | INT64 | Amount held at custodian | |
| `period` | STRING | Snapshot period | Format: "YYYY-MM" |
| `CURRENT_DATA` | BOOLEAN | Whether this is current data | |

**Usage**: Track which custodians firms use over time. Useful for understanding tech stack and potential recruiting targets.

---

### affiliates_historicals
**Purpose**: Historical firm affiliate relationships  
**Row Count**: 1,981,989  
**Size**: 268.32 MB

#### Key Fields

| Field Name | Data Type | Description | Notes |
|------------|-----------|-------------|-------|
| `RIA_INVESTOR_CRD_ID` | INT64 | Firm CRD ID | |
| `RELATED_ENTITY_CRD` | INT64 | Related entity CRD ID | |
| `RELATED_ENTITY_LEGAL_NAME` | STRING | Related entity name | |
| `MONTH_YEAR` | TIMESTAMP | Snapshot timestamp | |
| (Various boolean flags for entity types) | BOOLEAN | Entity type indicators | |

Tracks firm subsidiaries, affiliates, and related entities over time.

---

## Enrichment Tables

### passions_and_interests
**Purpose**: Personal interests/hobbies for rapport building ("Donut Test")  
**Row Count**: 788,154 (one row per contact)  
**Primary Key**: `RIA_CONTACT_CRD_ID`  
**Size**: 111.43 MB

#### Key Fields
- `RIA_CONTACT_CRD_ID` - Contact identifier
- `RIA_CONTACT_PREFERRED_NAME` - Contact name
- `PRIMARY_FIRM_NAME` - Firm name

#### Interest Flags (All BOOLEAN)
Over 80 interest flags including:
- Sports: `INTEREST_GOLF`, `INTEREST_TENNIS`, `INTEREST_SKIING`, `INTEREST_FOOTBALL`, etc.
- Activities: `INTEREST_COOKING`, `INTEREST_WINE`, `INTEREST_TRAVELING`, `INTEREST_READING`, etc.
- Hobbies: `INTEREST_PHOTOGRAPHY`, `INTEREST_MUSIC`, `INTEREST_ART`, etc.
- Fitness: `INTEREST_RUNNING`, `INTEREST_YOGA`, `INTEREST_WEIGHT_LIFTING`, etc.

**Usage**: Use for rapport building in outreach. Check which interests are TRUE for a contact.

**Note**: All contacts have a row, but many have all flags = FALSE (no interests recorded).

---

### contact_accolades_historicals
**Purpose**: Historical awards and recognition for contacts  
**Row Count**: 37,900  
**Primary Key**: `RIA_CONTACT_CRD_ID`, `ACCOLADE_ID`  
**Unique Contacts**: 14,501 (1.8% of contacts)  
**Size**: 4.05 MB

#### Key Fields

| Field Name | Data Type | Description | Notes |
|------------|-----------|-------------|-------|
| `RIA_CONTACT_CRD_ID` | INT64 | Contact CRD ID | Foreign key to ria_contacts_current |
| `ACCOLADE_ID` | INT64 | Accolade identifier | |
| `OUTLET` | STRING | Awarding publication | Top: Forbes (27,880), Barron's (7,290), AdvisorHub (2,654) |
| `DESCRIPTION` | STRING | Accolade description | e.g., "Top 250 Wealth Advisors" |
| `YEAR` | INT64 | Year awarded | Use for PIT filtering |
| `ACCOLADE_AND_YEAR` | STRING | Combined accolade and year | e.g., "Forbes Top 250 Wealth Advisors 2021" |

**Distribution by Outlet**:
- Forbes: 27,880 accolades (13,064 unique contacts), years 2021-2025
- Barron's: 7,290 accolades (1,925 unique contacts), years 2020-2025
- AdvisorHub: 2,654 accolades (1,741 unique contacts), years 2023-2025

**Usage**: High-value recruiting trigger. Filter by `YEAR <= contact_year` for point-in-time queries.

---

### firm_accolades_historicals
**Purpose**: Historical awards and recognition for firms  
**Row Count**: 2,963  
**Size**: 0.26 MB

Similar structure to `contact_accolades_historicals` but for firm-level awards.

---

### private_wealth_teams_ps
**Purpose**: Team-level data including TEAM_AUM  
**Row Count**: 26,368  
**Primary Key**: `ID`  
**Size**: 48.11 MB

⚠️ **CRITICAL COVERAGE ISSUE**: Only **20.1%** of teams have AUM data (5,304 of 26,368 teams)

#### Key Fields

| Field Name | Data Type | Null Rate | Description | Notes |
|------------|-----------|-----------|-------------|-------|
| `ID` | INT64 | 0% | Team identifier | Primary key |
| `TEAM_NAME` | STRING | 0% | Team name | |
| `CRD_ID` | INT64 | 0% | Firm CRD ID | Foreign key to ria_firms_current |
| `AUM` | INT64 | **79.9%** | Team-level AUM | ⚠️ **Only 20.1% have AUM** - HIGH VALUE when available |
| `MINIMUM_ACCOUNT_SIZE` | INT64 | 80.1% | Minimum account size | |
| `MEMBERS` | **STRING** | ~30% | **JSON array string** of member CRD IDs | ⚠️ **NOT ARRAY** |
| `INVESTMENTS_UTILIZED` | **STRING** | ~40% | **JSON array string** | ⚠️ **NOT ARRAY** |
| `CLIENTS_SERVED` | **STRING** | ~40% | **JSON array string** | ⚠️ **NOT ARRAY** |
| `SERVICES_PROVIDED` | **STRING** | ~40% | **JSON array string** | ⚠️ **NOT ARRAY** |

**Coverage Analysis**:
- Total teams: 26,368
- Teams with AUM: 5,304 (20.1%)
- Teams with firm CRD: 26,368 (100%)
- Contacts on teams with AUM: 32,456 (4.1% of all contacts)

**Usage**: Use `AUM` field as proxy for rep production when rep is on a team. Join via `ria_contacts_current.WEALTH_TEAM_ID_1/2/3`.

⚠️ **Recommendation**: Always check if AUM is NULL before using. Fall back to firm AUM when team AUM unavailable.

---

## News & Signal Tables

### news_ps
**Purpose**: News articles/mentions  
**Row Count**: 53,127  
**Size**: 191.36 MB

#### Key Fields
- `ID` - Article identifier
- `TITLE` - Article title
- `SOURCE_URL` - Source URL
- (Additional metadata fields)

Contains news articles with metadata (outlet, date, type, etc.).

---

### ria_contact_news
**Purpose**: Links news articles to contacts  
**Row Count**: 38,189  
**Size**: 0.58 MB

Junction table linking `news_ps` to `ria_contacts_current`.

**Coverage**: ~4.8% of contacts have news mentions

---

### ria_investors_news
**Purpose**: Links news articles to firms  
**Row Count**: 171,359  
**Size**: 2.61 MB

Junction table linking `news_ps` to `ria_firms_current`.

**Coverage**: ~3.8 news mentions per firm (on average)

---

## Compliance & Regulatory Tables

### Historical_Disclosure_data
**Purpose**: Regulatory disclosures and violations  
**Row Count**: 187,392  
**Size**: 40.26 MB

#### Key Fields

| Field Name | Data Type | Description | Notes |
|------------|-----------|-------------|-------|
| `CONTACT_CRD_ID` | INT64 | Contact CRD ID | |
| `TYPE` | STRING | Disclosure type | Criminal, regulatory, customer complaints, etc. |
| `EVENT_DATE` | TIMESTAMP | Disclosure date | |
| `RESOLUTION` | STRING | Resolution details | |
| `REGULATORY_BAR` | BOOLEAN | Regulatory bar | |
| `REGULATORY_SUSPENSION` | BOOLEAN | Suspension | |
| `REGULATORY_REVOCATION` | BOOLEAN | Revocation | |
| `CUSTOMER_DISPUTE_SETTLEMENT_AMT` | FLOAT64 | Settlement amount | |
| (Many other regulatory-specific fields) | | | |

**Usage**: Filter out problematic reps. Check for any disclosures before contact date.

**Coverage**: ~24% of contacts have at least one disclosure

---

### industry_exam_bd_historicals
**Purpose**: Broker-Dealer exam history  
**Row Count**: 1,048,575  
**Size**: 82.17 MB

#### Key Fields
- `contact_crd_id` - Contact CRD ID
- `contact_passed_industry_exam_id` - Exam ID
- `contact_passed_industry_exam_date` - Exam date
- `contact_passed_industry_exam_name` - Exam name (e.g., "Series 7")

Contains BD exam records (Series 7, Series 63, etc.) with dates.

---

### industry_exams_ia_historicals
**Purpose**: Investment Advisor exam history  
**Row Count**: 754,878  
**Size**: 52.61 MB

#### Key Fields
- `ria_contact_crd_id` - Contact CRD ID
- `contact_passed_industry_exam_id` - Exam ID
- `contact_passed_industry_exam_date` - Exam date
- `contact_passed_industry_exam_name` - Exam name (e.g., "Series 65")

Contains IA exam records (Series 65, etc.) with dates.

---

### schedule_d_section_A_historicals
**Purpose**: SEC Form ADV Schedule D Section A data  
**Row Count**: 646,418  
**Size**: 129.34 MB

Regulatory filing data from SEC Form ADV Schedule D Section A.

---

### schedule_d_section_B_historicals
**Purpose**: SEC Form ADV Schedule D Section B data  
**Row Count**: 646,418  
**Size**: 76.82 MB

Additional regulatory filing data from SEC Form ADV Schedule D Section B.

---

## Relationship & Association Tables

### ria_contact_firm_relationships
**Purpose**: Contact-to-firm relationships  
**Row Count**: 914,394  
**Size**: 13.95 MB

Defines how contacts relate to firms (employee, owner, etc.).

---

### wealth_team_members
**Purpose**: Team membership  
**Row Count**: 108,919  
**Size**: 1.66 MB

Links contacts to teams (many-to-many relationship).

---

### contact_branch_data
**Purpose**: Branch office information  
**Row Count**: 1,424,507  
**Size**: 229.86 MB

#### Key Fields
- `RIA_CONTACT_CRD_ID` - Contact CRD ID
- `RIA_INVESTOR_CRD_ID` - Firm CRD ID
- `STREET_1`, `CITY`, `STATE`, `POSTAL` - Address fields
- `LATITUDE`, `LONGITUDE` - Geographic coordinates
- `BRANCH_START_DATE` - Branch start date
- `PRIMARY_LOCATION` - Whether this is primary location

Branch office locations and details for contacts.

---

### private_fund_data
**Purpose**: Private fund information  
**Row Count**: 101,125  
**Size**: 13.65 MB

Data about private funds.

---

### ria_investors_private_fund_relationships
**Purpose**: Firm-to-private fund relationships  
**Row Count**: 132,447  
**Size**: 4.04 MB

Links firms to private funds they advise.

---

## Join Key Reference

### Primary Join Keys

| From Table | Join Field | To Table | Join Field | Relationship | Match Rate |
|------------|------------|----------|------------|--------------|------------|
| `ria_contacts_current` | `PRIMARY_FIRM` | `ria_firms_current` | `CRD_ID` | Many-to-One | 100% (no orphans) |
| `ria_contacts_current` | `RIA_CONTACT_CRD_ID` | `contact_registered_employment_history` | `RIA_CONTACT_CRD_ID` | One-to-Many | ~100% |
| `ria_contacts_current` | `RIA_CONTACT_CRD_ID` | `contact_accolades_historicals` | `RIA_CONTACT_CRD_ID` | One-to-Many | ~100% |
| `ria_contacts_current` | `RIA_CONTACT_CRD_ID` | `passions_and_interests` | `RIA_CONTACT_CRD_ID` | One-to-One | 100% |
| `ria_contacts_current` | `WEALTH_TEAM_ID_1/2/3` | `private_wealth_teams_ps` | `ID` | Many-to-One | ~100% |
| `ria_firms_current` | `CRD_ID` | `Firm_historicals` | `RIA_INVESTOR_CRD_ID` | One-to-Many | ~100% |
| `ria_firms_current` | `CRD_ID` | `custodians_historicals` | `RIA_INVESTOR_CRD_ID` | One-to-Many | ~100% |
| `private_wealth_teams_ps` | `CRD_ID` | `ria_firms_current` | `CRD_ID` | Many-to-One | ~100% |

---

## Data Quality Summary

### Critical Findings

1. **REP_AUM**: 99.1% NULL - essentially unusable
2. **Team AUM**: Only 20.1% of teams have AUM data
3. **Contact AUM Coverage**: Only 4.1% of contacts can get team AUM
4. **Accolades**: Only 1.8% of contacts have accolades (14,501 of 788,154)
5. **No Contact Snapshots**: There are NO contact-level historical snapshots - only firm-level
6. **JSON String Fields**: Many "array" fields are actually STRING containing JSON arrays

### Recommendations

1. **AUM Features**: Use firm-level AUM as primary feature (more complete than rep/team)
2. **Team AUM**: Check for NULL before using - fall back to firm AUM
3. **JSON Fields**: Use `JSON_EXTRACT_ARRAY()` or `LIKE` queries for STRING fields containing JSON
4. **PIT Queries**: Only possible for firm-level data, employment history, accolades, and registrations
5. **Contact Data**: `ria_contacts_current` is current state ONLY - no historical snapshots

---

## Query Examples

### Querying JSON String Fields

```sql
-- Check if contact has Series 7 license
SELECT * FROM ria_contacts_current
WHERE REP_LICENSES LIKE '%Series 7%';

-- Extract licenses as array
SELECT 
  RIA_CONTACT_CRD_ID,
  JSON_EXTRACT_ARRAY(REP_LICENSES) as licenses_array
FROM ria_contacts_current
WHERE REP_LICENSES IS NOT NULL;

-- Count licenses
SELECT 
  RIA_CONTACT_CRD_ID,
  ARRAY_LENGTH(JSON_EXTRACT_ARRAY(REP_LICENSES)) as num_licenses
FROM ria_contacts_current
WHERE REP_LICENSES IS NOT NULL;
```

### Point-in-Time Queries

```sql
-- Get firm AUM as of June 2024
SELECT *
FROM Firm_historicals
WHERE RIA_INVESTOR_CRD_ID = 12345
  AND YEAR = 2024
  AND MONTH = 6;

-- Get employment as of specific date
SELECT *
FROM contact_registered_employment_history
WHERE RIA_CONTACT_CRD_ID = 12345
  AND PREVIOUS_REGISTRATION_COMPANY_START_DATE <= '2024-07-01'
  AND (PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL 
       OR PREVIOUS_REGISTRATION_COMPANY_END_DATE >= '2024-07-01');
```

