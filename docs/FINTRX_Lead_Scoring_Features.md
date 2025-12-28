# FINTRX Lead Scoring Features Inventory

Curated list of fields relevant for building a Point-in-Time (PIT) lead scoring model for financial advisor recruitment.

**Last Updated**: December 2025

## Feature Categories

1. [Target Variable Candidates](#target-variable-candidates)
2. [Production/AUM Features](#productionaum-features)
3. [Experience Features](#experience-features)
4. [Quality Signals](#quality-signals)
5. [Engagement Signals](#engagement-signals)
6. [Firm Characteristics](#firm-characteristics)
7. [Team Characteristics](#team-characteristics)
8. [Compliance/Disqualifiers](#compliancedisqualifiers)

---

## Target Variable Candidates

These fields could be used as target variables (what we're trying to predict):

| Table | Field Name | Data Type | Coverage | Usage Notes |
|-------|------------|-----------|----------|-------------|
| `ria_contacts_current` | `PRODUCING_ADVISOR` | BOOLEAN | ~90% | Whether rep is a producing advisor - potential target |
| `ria_contacts_current` | `CONTACT_OWNERSHIP_PERCENTAGE` | STRING | ~95% | Ownership stake - higher ownership may indicate better fit |
| `ria_contacts_current` | `ACTIVE` | BOOLEAN | ~100% | Whether contact is currently active |

**Note**: Actual conversion data (contacted → MQL → SQL → SQO) would come from Salesforce, not FINTRX.

---

## Production/AUM Features

These features indicate the advisor's production level and assets under management.

### Rep-Level AUM

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_contacts_current` | `REP_AUM` | INT64 | **0.9%** | ❌ **NO** | ⚠️ **99.1% NULL** - essentially unusable |
| `private_wealth_teams_ps` | `AUM` | INT64 | **20.1%** | ❌ **NO** | ⚠️ Only 5,304 of 26,368 teams have AUM, current state only |

**Query Syntax**: 
```sql
-- Team AUM (current state only)
SELECT t.AUM
FROM private_wealth_teams_ps t
WHERE t.ID = contact.WEALTH_TEAM_ID_1
  AND t.AUM IS NOT NULL;
```

### Firm-Level AUM

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_firms_current` | `TOTAL_AUM` | INT64 | ~80-85% | ❌ **NO** | Current state only |
| `Firm_historicals` | `TOTAL_AUM` | INT64 | **92-93%** | ✅ **YES** | ✅ **BEST OPTION** - monthly snapshots available |
| `ria_firms_current` | `DISCRETIONARY_AUM` | INT64 | ~80% | ❌ **NO** | Current state only |
| `ria_firms_current` | `AUM_YOY` | INT64 | ~70% | ❌ **NO** | Pre-calculated growth, current state |
| `Firm_historicals` | `AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS` | INT64 | ~50-60% | ✅ **YES** | HNW AUM (indicates client quality) |

**Query Syntax for PIT**:
```sql
-- Get firm AUM as of specific date
SELECT TOTAL_AUM
FROM Firm_historicals
WHERE RIA_INVESTOR_CRD_ID = firm_crd
  AND YEAR = 2024
  AND MONTH = 6
  AND (YEAR < contact_year OR (YEAR = contact_year AND MONTH < contact_month));
```

### Client Quality Indicators

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_firms_current` | `NUM_OF_CLIENTS_HIGH_NET_WORTH_INDIVIDUALS` | INT64 | ~70% | ❌ **NO** | Current state only |
| `Firm_historicals` | `NUM_OF_CLIENTS_HIGH_NET_WORTH_INDIVIDUALS` | INT64 | ~50-60% | ✅ **YES** | Historical HNW count |
| `ria_firms_current` | `AVERAGE_ACCOUNT_SIZE` | INT64 | ~70% | ❌ **NO** | Current state only |

**Feature Engineering Recommendations**:
- ✅ **Use `Firm_historicals.TOTAL_AUM`** as primary AUM feature (best coverage, PIT available)
- ⚠️ Use `private_wealth_teams_ps.AUM` when available (only 4.1% of contacts), fall back to firm AUM
- ❌ Do NOT use `REP_AUM` (99.1% NULL)
- Calculate AUM growth rate: `(current_AUM - historical_AUM) / historical_AUM`
- Create HNW ratio: `HNW_AUM / TOTAL_AUM`

---

## Experience Features

These features indicate the advisor's experience level and qualifications.

### Tenure & Experience

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_contacts_current` | `INDUSTRY_TENURE_MONTHS` | INT64 | 93.9% | ⚠️ **PARTIAL** | Current state, but can calculate from employment history |
| `contact_registered_employment_history` | `PREVIOUS_REGISTRATION_COMPANY_START_DATE` | DATE | ~100% | ✅ **YES** | Calculate tenure at current firm |
| `contact_registered_employment_history` | `PREVIOUS_REGISTRATION_COMPANY_END_DATE` | DATE | ~50% | ✅ **YES** | NULL if current employment |
| `ria_contacts_current` | `PRIMARY_FIRM_START_DATE` | DATE | ~85% | ❌ **NO** | Current state only |

**Query Syntax for PIT**:
```sql
-- Calculate tenure at current firm as of contact date
SELECT 
  DATE_DIFF(
    contact_date,
    MAX(PREVIOUS_REGISTRATION_COMPANY_START_DATE),
    MONTH
  ) as tenure_at_firm_months
FROM contact_registered_employment_history
WHERE RIA_CONTACT_CRD_ID = rep_crd
  AND PREVIOUS_REGISTRATION_COMPANY_START_DATE <= contact_date
  AND (PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL 
       OR PREVIOUS_REGISTRATION_COMPANY_END_DATE >= contact_date);
```

**Feature Engineering Recommendations**:
- Calculate tenure at current firm from employment history (more accurate than stored field)
- Calculate total industry tenure (sum of all employment periods)
- Count number of previous firms (job hopper indicator)
- Calculate average tenure per firm

### Licenses & Qualifications

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_contacts_current` | `REP_LICENSES` | **STRING** | 100% | ❌ **NO** | ⚠️ **STRING not ARRAY** - JSON format, current state only |
| `ria_contacts_current` | `INDUSTRY_EXAMS` | **STRING** | ~90% | ❌ **NO** | ⚠️ **STRING not ARRAY** - current state only |
| `industry_exam_bd_historicals` | `contact_passed_industry_exam_date` | DATE | ~60% | ✅ **YES** | BD exam history with dates |
| `industry_exams_ia_historicals` | `contact_passed_industry_exam_date` | DATE | ~50% | ✅ **YES** | IA exam history with dates |

**Query Syntax**:
```sql
-- Check if contact has Series 7 (current state only)
SELECT * FROM ria_contacts_current
WHERE REP_LICENSES LIKE '%Series 7%';

-- Extract licenses as array
SELECT JSON_EXTRACT_ARRAY(REP_LICENSES) as licenses_array
FROM ria_contacts_current
WHERE REP_LICENSES IS NOT NULL;

-- Count licenses
SELECT ARRAY_LENGTH(JSON_EXTRACT_ARRAY(REP_LICENSES)) as num_licenses
FROM ria_contacts_current
WHERE REP_LICENSES IS NOT NULL;
```

**Feature Engineering Recommendations**:
- Count number of licenses held (use `ARRAY_LENGTH(JSON_EXTRACT_ARRAY(REP_LICENSES))`)
- Create binary flags: `has_series_7`, `has_series_65`, etc. (use `LIKE '%Series 7%'`)
- Check for advanced licenses (Series 24, Series 9, etc.)
- ⚠️ **Note**: Licenses are current state only - creates small data leakage risk

### Registrations

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_contacts_current` | `RIA_REGISTERED_LOCATIONS` | **STRING** | ~80% | ❌ **NO** | ⚠️ **STRING not ARRAY** - JSON format, current state only |
| `ria_contacts_current` | `BD_REGISTERED_LOCATIONS` | **STRING** | ~70% | ❌ **NO** | ⚠️ **STRING not ARRAY** - current state only |
| `contact_state_registrations_historicals` | `registerations_regulator` | STRING | ~100% | ✅ **YES** | Historical state registrations |
| `contact_broker_dealer_state_historicals` | `state` | STRING | ~80% | ✅ **YES** | Historical BD state registrations |

**Query Syntax for PIT**:
```sql
-- Get state registrations as of specific date
SELECT DISTINCT registerations_regulator as state
FROM contact_state_registrations_historicals
WHERE contact_crd_id = rep_crd
  AND period <= '2024-07'
  AND registerations_registeration_date <= contact_date
  AND active = TRUE;
```

**Feature Engineering Recommendations**:
- Count number of states registered in (from historical table for PIT)
- Create binary flags for key states (CA, NY, TX, FL, etc.)
- Check for multi-state registration (indicates larger practice)

---

## Quality Signals

These features indicate advisor quality and prestige.

### Accolades & Recognition

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `contact_accolades_historicals` | `OUTLET` | STRING | **1.8%** | ✅ **YES** | Only 14,501 contacts have accolades |
| `contact_accolades_historicals` | `DESCRIPTION` | STRING | 1.8% | ✅ **YES** | e.g., "Top 250 Wealth Advisors" |
| `contact_accolades_historicals` | `YEAR` | INT64 | 1.8% | ✅ **YES** | Use for PIT filtering |
| `firm_accolades_historicals` | (similar) | - | ~6.5% | ✅ **YES** | Firm-level awards |

**Distribution**:
- Forbes: 27,880 accolades (13,064 unique contacts), years 2021-2025
- Barron's: 7,290 accolades (1,925 unique contacts), years 2020-2025
- AdvisorHub: 2,654 accolades (1,741 unique contacts), years 2023-2025

**Query Syntax for PIT**:
```sql
-- Get accolades as of contact date
SELECT *
FROM contact_accolades_historicals
WHERE RIA_CONTACT_CRD_ID = rep_crd
  AND YEAR <= contact_year;
```

**Feature Engineering Recommendations**:
- Count total accolades (higher = better)
- Create binary flags: `has_forbes_accolade`, `has_barrons_accolade`, etc.
- Check for recent accolades (within last 2-3 years)
- Weight by outlet prestige (Forbes > Barron's > AdvisorHub)
- ⚠️ **Low coverage**: Only 1.8% of contacts have accolades

### Education

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_contacts_current` | `UNIVERSITY_NAMES` | **STRING** | ~60% | ❌ **NO** | ⚠️ **STRING not ARRAY** - JSON format, current state only |

**Feature Engineering Recommendations**:
- Count number of degrees (use `JSON_EXTRACT_ARRAY()`)
- Create binary flags for top-tier universities
- Check for MBA or advanced degrees

### Roles & Responsibilities

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_contacts_current` | `CONTACT_ROLES` | **STRING** | ~80% | ❌ **NO** | ⚠️ **STRING not ARRAY** - JSON format, current state only |
| `ria_contacts_current` | `TITLE_NAME` | STRING | ~85% | ❌ **NO** | Job title, current state only |
| `ria_contacts_current` | `INVESTMENT_COMMITTEE_MEMBER` | BOOLEAN | ~95% | ❌ **NO** | Whether on investment committee, current state only |

**Query Syntax**:
```sql
-- Extract roles as array
SELECT JSON_EXTRACT_ARRAY(CONTACT_ROLES) as roles_array
FROM ria_contacts_current
WHERE CONTACT_ROLES IS NOT NULL;
```

**Feature Engineering Recommendations**:
- Create binary flags: `is_executive`, `is_senior`, `is_committee_member`
- Check for leadership roles (Director, VP, Managing Partner, etc.)
- ⚠️ **Note**: Current state only - creates small data leakage risk

---

## Engagement Signals

These features indicate recent activity or engagement that might signal openness to new opportunities.

### News Mentions

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_contact_news` | (links to news_ps) | - | **4.8%** | ⚠️ **PARTIAL** | Only 38,189 contact-news links |
| `news_ps` | `written_at` | DATE | 4.8% | ✅ **YES** | Article date (if available) |
| `news_ps` | `type` | STRING | 4.8% | ✅ **YES** | News type (e.g., "Mergers & Acquisitions") |

**Feature Engineering Recommendations**:
- Count news mentions in last 6/12 months before contact date
- Check for specific news types (M&A, awards, moves)
- Recent news may indicate change/opportunity
- ⚠️ **Low coverage**: Only 4.8% of contacts have news mentions

### Employment Changes

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `contact_registered_employment_history` | `PREVIOUS_REGISTRATION_COMPANY_END_DATE` | DATE | ~50% | ✅ **YES** | Recent end dates may indicate moves |
| `ria_contacts_current` | `LATEST_REGISTERED_EMPLOYMENT_END_DATE` | DATE | ~50% | ❌ **NO** | Current state only |

**Feature Engineering Recommendations**:
- Flag if recent employment change (within last 6 months before contact)
- Check for short tenure at current firm (< 2 years)
- Multiple recent moves may indicate job hopper

---

## Firm Characteristics

These features describe the advisor's current firm and may indicate fit or opportunity.

### Firm Size & Type

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_firms_current` | `NUM_OF_EMPLOYEES` | INT64 | ~75% | ❌ **NO** | Current state only |
| `ria_firms_current` | `ENTITY_CLASSIFICATION` | **STRING** | ~90% | ❌ **NO** | ⚠️ **STRING not ARRAY** - JSON format, current state only |
| `ria_firms_current` | `TYPE_ENTITY` | STRING | ~95% | ❌ **NO** | Entity type, current state only |

**Query Syntax**:
```sql
-- Extract entity classifications
SELECT JSON_EXTRACT_ARRAY(ENTITY_CLASSIFICATION) as classifications
FROM ria_firms_current
WHERE ENTITY_CLASSIFICATION IS NOT NULL;
```

**Feature Engineering Recommendations**:
- Create binary flags: `is_independent_ria`, `is_wirehouse`, `is_broker_dealer`
- Categorize firm size: small (<50), medium (50-500), large (>500)
- Check for specific firm types that may be better targets

### Firm Growth

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_firms_current` | `AUM_YOY` | INT64 | ~70% | ❌ **NO** | Pre-calculated, current state only |
| `Firm_historicals` | `TOTAL_AUM` | INT64 | 92-93% | ✅ **YES** | Calculate growth from historical snapshots |

**Feature Engineering Recommendations**:
- Calculate AUM growth rate from historical snapshots (more accurate)
- Flag declining firms (negative growth)
- Flag high-growth firms (may indicate opportunity or stability)

### Technology Stack

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_firms_current` | `CUSTODIAN_PRIMARY_BUSINESS_NAME` | STRING | ~50-60% | ❌ **NO** | Current state only |
| `custodians_historicals` | `PRIMARY_BUSINESS_NAME` | STRING | ~60% | ✅ **YES** | Historical custodian data |
| `ria_firms_current` | `TAMP_AND_TECH_USED` | **STRING** | ~40% | ❌ **NO** | ⚠️ **STRING not ARRAY** - current state only |

**Query Syntax for PIT**:
```sql
-- Get custodian as of specific date
SELECT PRIMARY_BUSINESS_NAME
FROM custodians_historicals
WHERE RIA_INVESTOR_CRD_ID = firm_crd
  AND period <= '2024-07'
  AND CURRENT_DATA = TRUE
ORDER BY period DESC
LIMIT 1;
```

**Feature Engineering Recommendations**:
- Create binary flags for major custodians: `uses_schwab`, `uses_fidelity`, etc.
- Check for tech stack alignment with your platform
- Multiple custodians may indicate complexity or opportunity

### Investment Strategy

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_firms_current` | `INVESTMENTS_UTILIZED` | **STRING** | ~70% | ❌ **NO** | ⚠️ **STRING not ARRAY** - current state only |
| `ria_firms_current` | `ALTERNATIVES` | **STRING** | ~60% | ❌ **NO** | ⚠️ **STRING not ARRAY** - current state only |
| `ria_firms_current` | `FEE_STRUCTURE` | **STRING** | ~80% | ❌ **NO** | ⚠️ **STRING not ARRAY** - current state only |
| `ria_firms_current` | `ACTIVE_ESG_INVESTOR` | BOOLEAN | ~95% | ❌ **NO** | ESG focus, current state only |

**Feature Engineering Recommendations**:
- Create binary flags for investment types (use `JSON_EXTRACT_ARRAY()`)
- Check for alternative investments (may indicate sophistication)
- Check fee structure (AUM-based vs. fixed fees)

---

## Team Characteristics

These features describe the advisor's team structure.

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `private_wealth_teams_ps` | `AUM` | INT64 | **20.1%** | ❌ **NO** | ⚠️ Only 5,304 of 26,368 teams have AUM, current state only |
| `private_wealth_teams_ps` | `MINIMUM_ACCOUNT_SIZE` | INT64 | 20.1% | ❌ **NO** | Current state only |
| `private_wealth_teams_ps` | `MEMBERS` | **STRING** | ~70% | ❌ **NO** | ⚠️ **STRING not ARRAY** - JSON format, current state only |
| `wealth_team_members` | (various) | - | ~14% | ❌ **NO** | Team membership details, current state only |

**Coverage Analysis**:
- Total teams: 26,368
- Teams with AUM: 5,304 (20.1%)
- Contacts on teams: 102,814 (13% of contacts)
- Contacts with team AUM: 32,456 (4.1% of all contacts)

**Feature Engineering Recommendations**:
- Count team members (use `JSON_EXTRACT_ARRAY(MEMBERS)`)
- Use team AUM as primary production proxy when available (only 4.1% of contacts)
- Fall back to firm AUM when team AUM unavailable
- Check if contact is team lead (may be harder to recruit)

---

## Compliance/Disqualifiers

These features may indicate advisors to avoid or filter out.

| Table | Field Name | Data Type | Coverage | PIT Possible? | Usage Notes |
|-------|------------|-----------|----------|---------------|-------------|
| `ria_contacts_current` | `CONTACT_HAS_DISCLOSED_*` | BOOLEAN | ~95% | ❌ **NO** | 9 different disclosure flags, current state only |
| `Historical_Disclosure_data` | `TYPE` | STRING | **24%** | ✅ **YES** | Detailed disclosure records with dates |
| `Historical_Disclosure_data` | `EVENT_DATE` | TIMESTAMP | 24% | ✅ **YES** | Disclosure date |

**Disclosure Types**:
- `CONTACT_HAS_DISCLOSED_BANKRUPT` - Bankruptcy
- `CONTACT_HAS_DISCLOSED_CRIMINAL` - Criminal events
- `CONTACT_HAS_DISCLOSED_REGULATORY_EVENT` - Regulatory issues
- `CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE` - Customer complaints
- `CONTACT_HAS_DISCLOSED_INVESTIGATION` - Investigations
- `CONTACT_HAS_DISCLOSED_TERMINATION` - Terminations
- `CONTACT_HAS_DISCLOSED_BOND` - Bond issues
- `CONTACT_HAS_DISCLOSED_CIVIL_EVENT` - Civil events
- `CONTACT_HAS_DISCLOSED_JUDGMENT_OR_LIEN` - Judgments/liens

**Query Syntax for PIT**:
```sql
-- Check for disclosures before contact date
SELECT COUNT(*) as disclosure_count
FROM Historical_Disclosure_data
WHERE CONTACT_CRD_ID = rep_crd
  AND EVENT_DATE < contact_date;
```

**Feature Engineering Recommendations**:
- Create binary flag: `has_any_disclosure`
- Weight by severity (criminal > regulatory > customer dispute)
- Filter out contacts with serious disclosures
- Use `Historical_Disclosure_data` for PIT queries (more detailed than boolean flags)

---

## Feature Engineering Best Practices

### 1. Point-in-Time (PIT) Queries
Always filter historical tables by date to avoid data leakage:
```sql
-- Firm AUM
WHERE YEAR <= contact_year AND (YEAR < contact_year OR MONTH <= contact_month)

-- Accolades
WHERE YEAR <= contact_year

-- Employment
WHERE start_date <= contact_date AND (end_date IS NULL OR end_date >= contact_date)
```

### 2. Handling NULLs
- **AUM Features**: Use firm-level AUM when rep/team AUM is NULL (priority: Firm Historical > Firm Current > Team AUM)
- **Tenure Features**: Calculate from employment history when `INDUSTRY_TENURE_MONTHS` is NULL
- **Enrichment Features**: Use 0 or FALSE as default for missing data

### 3. JSON String Fields
Many fields are STRING type containing JSON arrays. Use:
```sql
-- Extract as array
JSON_EXTRACT_ARRAY(field_name)

-- Count elements
ARRAY_LENGTH(JSON_EXTRACT_ARRAY(field_name))

-- Check for value
field_name LIKE '%value%'
```

### 4. Feature Selection Priority

**High Priority (High Coverage, PIT Available)**:
1. ✅ Firm AUM (`Firm_historicals.TOTAL_AUM`) - 92-93% coverage, PIT available
2. ✅ Industry Tenure (calculated from employment history) - ~100% coverage, PIT available
3. ✅ Firm Type (`ENTITY_CLASSIFICATION`) - ~90% coverage, current state only
4. ✅ Licenses (`REP_LICENSES` count) - 100% coverage, current state only

**Medium Priority (Moderate Coverage)**:
5. ⚠️ Team AUM (`private_wealth_teams_ps.AUM`) - 20.1% coverage, current state only
6. ⚠️ Accolades (binary flag) - 1.8% coverage, PIT available
7. ⚠️ Custodian (`custodians_historicals`) - ~60% coverage, PIT available

**Low Priority (Low Coverage or Quality Concerns)**:
8. ❌ Rep AUM (`REP_AUM`) - 0.9% coverage, essentially unusable
9. ⚠️ News Mentions - 4.8% coverage
10. ⚠️ Passions/Interests - for rapport, not scoring

### 5. Data Leakage Considerations

**Acceptable (Small Risk)**:
- Licenses (current state only) - unlikely to change frequently
- Contact roles/title (current state only) - relatively stable
- Firm type (current state only) - relatively stable

**Unacceptable (High Risk)**:
- Rep AUM (99% NULL anyway, so not usable)
- Team AUM (only 4.1% coverage, current state only)
- Contact info (email, phone) - changes frequently

**Mitigation**: Document which features are current state only and accept small data leakage risk for stable features.

---

## Recommended Feature Set for Initial Model

### Core Features (Must Have)
1. `firm_aum` - From `Firm_historicals` (log transformed, PIT available)
2. `industry_tenure_months` - Calculated from employment history (normalized, PIT available)
3. `has_accolade` - Binary flag from `contact_accolades_historicals` (PIT available)
4. `firm_type` - From `ENTITY_CLASSIFICATION` (one-hot encoded, current state only)
5. `num_licenses` - Count from `REP_LICENSES` (current state only)

### Extended Features (Nice to Have)
6. `aum_growth_rate` - Calculated from `Firm_historicals` (PIT available)
7. `num_states_registered` - Count from `contact_state_registrations_historicals` (PIT available)
8. `has_recent_news` - Binary flag from `ria_contact_news` (last 6 months, PIT available)
9. `custodian_type` - From `custodians_historicals` (one-hot encoded, PIT available)
10. `is_executive` - Binary flag from `CONTACT_ROLES` (current state only)

### Enrichment Features (Optional)
11. `num_interests` - Count from `passions_and_interests` (for rapport, not scoring)
12. `has_high_value_interest` - Binary flag (e.g., golf, wine, cooking)

---

## Data Availability by Feature

| Feature Category | Coverage | PIT Available | Notes |
|-----------------|----------|---------------|-------|
| AUM (Firm Historical) | 92-93% | ✅ Yes | Best option |
| AUM (Team) | 20.1% | ❌ No | Only 4.1% of contacts can get |
| AUM (Rep) | 0.9% | ❌ No | Essentially unusable |
| Accolades | 1.8% | ✅ Yes | Only 14,501 contacts |
| Passions/Interests | 100% | ❌ No | All contacts have row (may be all FALSE) |
| Employment History | ~100% | ✅ Yes | Average 2.8 records per contact |
| News Mentions | 4.8% | ⚠️ Partial | Only 38,189 contact-news links |
| Disclosures | 24% | ✅ Yes | 187,392 disclosure records |
| Licenses | 100% | ❌ No | Current state only |

**Recommendation**: Build model with features that have high coverage and PIT availability first, then add enrichment features as optional inputs.

---

## Query Examples

### Extracting JSON Array Fields

```sql
-- Count licenses
SELECT 
  RIA_CONTACT_CRD_ID,
  ARRAY_LENGTH(JSON_EXTRACT_ARRAY(REP_LICENSES)) as num_licenses
FROM ria_contacts_current
WHERE REP_LICENSES IS NOT NULL;

-- Check for specific license
SELECT *
FROM ria_contacts_current
WHERE REP_LICENSES LIKE '%Series 7%';

-- Extract entity classifications
SELECT 
  CRD_ID,
  JSON_EXTRACT_ARRAY(ENTITY_CLASSIFICATION) as classifications
FROM ria_firms_current
WHERE ENTITY_CLASSIFICATION IS NOT NULL;
```

### PIT Feature Extraction

```sql
-- Get firm AUM as of date
SELECT TOTAL_AUM
FROM Firm_historicals
WHERE RIA_INVESTOR_CRD_ID = firm_crd
  AND YEAR = 2024
  AND MONTH = 6;

-- Get accolades as of date
SELECT COUNT(*) as num_accolades
FROM contact_accolades_historicals
WHERE RIA_CONTACT_CRD_ID = rep_crd
  AND YEAR <= 2024;

-- Calculate tenure at firm as of date
SELECT 
  DATE_DIFF(
    DATE('2024-07-01'),
    MAX(PREVIOUS_REGISTRATION_COMPANY_START_DATE),
    MONTH
  ) as tenure_months
FROM contact_registered_employment_history
WHERE RIA_CONTACT_CRD_ID = rep_crd
  AND PREVIOUS_REGISTRATION_COMPANY_START_DATE <= '2024-07-01'
  AND (PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL 
       OR PREVIOUS_REGISTRATION_COMPANY_END_DATE >= '2024-07-01');
```

