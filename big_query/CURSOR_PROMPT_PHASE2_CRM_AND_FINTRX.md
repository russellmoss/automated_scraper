# Cursor.ai Prompt: Update Phase 2 + Add FINTRX CRD Enrichment

## Instructions for Cursor

Copy and paste this entire prompt into Cursor.ai chat while you have the implementation guide open.

---

## PROMPT START

I'm working on this file: `C:\Users\russe\automated_scraper\big_query\SAVVY_PIRATE_BIGQUERY_IMPLEMENTATION_GUIDE.md`

I need you to make TWO updates:

### UPDATE 1: Pre-fill CRM Column Names in Phase 2

Based on our existing Salesforce integration code, we KNOW the actual column names. Update the "Human Confirmation Required" section in Phase 2 (around Step 2.1) to pre-fill these known column names instead of blank placeholders.

### UPDATE 2: Add FINTRX CRD Enrichment (New Step 2.3)

Add a new step after Phase 2's CRM matching setup to enrich our advisors with CRD numbers from FINTRX data. This is critical because:
- CRD numbers identify registered investment advisors
- Advisors with CRDs are automatically high-value leads
- The Janitor script already uses CRD to auto-keep leads

**IMPORTANT REQUIREMENTS:**
1. First use MCP BigQuery tools to explore `savvy-gtm-analytics.FinTrx_data_CA` and discover the actual table names and schema
2. Use CONSERVATIVE matching - no false positives, no false negatives
3. Match priority: LinkedIn slug match first (most reliable), then exact name match
4. Only enrich with CRD - we're not pulling all FINTRX fields, just the CRD number

---

## PART 1: Update Phase 2 Human Confirmation Section

Find the section that says:

```markdown
## 🛑 STOP: Human Confirmation Required

### ⚠️ DO NOT PROCEED TO STEP 2.2 UNTIL YOU COMPLETE THIS FORM
```

REPLACE the blank form with pre-filled values based on our known Salesforce schema:

```markdown
## 🛑 STOP: Human Confirmation Required

### ⚠️ VERIFY THESE PRE-FILLED VALUES MATCH YOUR SALESFORCE SCHEMA

Based on our existing Salesforce integration, here are the expected column names.
**Review and confirm these are correct for your instance before proceeding.**

**LEAD TABLE MAPPING (SavvyGTMData.Lead):**
```
LinkedIn URL Column:     LinkedIn_Profile_URL__c   ← VERIFY: May vary by org
Name Column:            Name                       ← Standard field
Status Column:          Status                     ← Standard field
Owner ID Column:        OwnerId                    ← Standard field
Disposition Column:     Disposition__c             ← Custom field
CRD Number Column:      FA_CRD__c                  ← Custom field
Last Activity Date:     LastActivityDate           ← Standard field
Full Prospect ID:       Full_Prospect_ID__c        ← Custom field (for SF links)
```

**OPPORTUNITY TABLE MAPPING (SavvyGTMData.Opportunity):**
```
LinkedIn URL Column:     (May not exist - set to NULL if missing)
Name Column:            Name                       ← Standard field
Stage Column:           StageName                  ← Standard field
Owner ID Column:        OwnerId                    ← Standard field
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
```

---

## PART 2: Add FINTRX CRD Enrichment Step

After Phase 2's CRM matching setup (after Step 2.2), add a new Step 2.3 for FINTRX enrichment.

**First, use MCP to explore the FINTRX data:**

```
Use your BigQuery MCP tools to run these exploration queries:

1. List all tables in the FINTRX dataset:
   SELECT table_name 
   FROM `savvy-gtm-analytics.FinTrx_data_CA.INFORMATION_SCHEMA.TABLES`
   ORDER BY table_name;

2. Get the schema of the contacts table (likely ria_contacts_current):
   SELECT column_name, data_type
   FROM `savvy-gtm-analytics.FinTrx_data_CA.INFORMATION_SCHEMA.COLUMNS`
   WHERE table_name = 'ria_contacts_current'
   ORDER BY ordinal_position;

3. Sample LinkedIn URL format:
   SELECT LINKEDIN_PROFILE_URL
   FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
   WHERE LINKEDIN_PROFILE_URL IS NOT NULL
   LIMIT 5;
```

**Then add this new step:**

---

## Step 2.3: FINTRX CRD Enrichment

### Why This Step Matters

FINTRX contains CRD (Central Registration Depository) numbers for ~788,000 registered investment advisors. A CRD number is definitive proof someone is a registered RIA - these are your highest-value leads.

This step enriches your advisors table by matching scraped profiles to FINTRX data to discover their CRD numbers.

### 🤖 CURSOR PROMPT 2.3

```
Create a FINTRX enrichment system that:
1. Matches advisors to FINTRX ria_contacts_current by LinkedIn URL slug (primary) or exact name (secondary)
2. Extracts their CRD number (RIA_CONTACT_CRD_ID)
3. Uses CONSERVATIVE matching - prefer no match over false match
4. Creates a view that enriches advisors with CRD and basic firm info
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

## Step 2.3.1: Update Monday Analysis to Use CRD Priority

Update the Monday analysis query (in Phase 3) to use the CRD enrichment for lead prioritization.

Find the new_advisor_reports INSERT query and add the priority field:

```sql
-- In the new_advisor_reports INSERT, add:
SELECT 
  -- existing fields...
  ea.crd_number,
  ea.lead_priority,
  ea.crd_firm_name,
  ea.crd_firm_aum
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` ea
-- rest of query...
```

---

## PART 3: Update Export Queries to Include CRD

In Phase 4 (Export Queries), update the New Advisors export to include CRD information:

Find the "Export - New Advisors" query and add CRD fields:

```sql
-- Updated New Advisors Export with CRD
SELECT 
  nar.advisor_name,
  nar.linkedin_url,
  nar.title,
  nar.location,
  ARRAY_TO_STRING(nar.accreditations, ', ') as accreditations,
  nar.recruiter_name,
  nar.search_type,
  nar.first_seen_date,
  -- CRD enrichment
  ea.crd_number,
  ea.lead_priority,
  ea.crd_firm_name,
  ROUND(ea.crd_firm_aum / 1000000, 1) as firm_aum_millions,
  ea.crd_is_producing
FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` nar
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` ea
  ON nar.advisor_id = ea.advisor_id
WHERE nar.analysis_date = CURRENT_DATE()
ORDER BY 
  CASE ea.lead_priority 
    WHEN 'HIGH - Registered Producing Advisor' THEN 1
    WHEN 'MEDIUM - Registered RIA' THEN 2
    ELSE 3
  END,
  nar.first_seen_date DESC;
```

---

## PART 4: Update Implementation Checklist

Add these items to the Phase 2 checklist at the end of the document:

```markdown
## Phase 2: CRM Matching
- [ ] Salesforce column names confirmed by human
- [ ] v_crm_matches view created with correct columns
- [ ] Test query returns no errors
- [ ] FINTRX slug extraction function created (NEW)
- [ ] v_advisors_with_crd view created (NEW)
- [ ] CRD match statistics verified (NEW)
```

---

## PART 5: Update Success Metrics

In the Success Metrics table, add:

```markdown
| CRD matches per analysis | 10-30% of new advisors | Check `v_advisors_with_crd` WHERE is_registered_ria = TRUE |
```

---

After applying these changes:
1. Verify Step 2.3 appears after Step 2.2
2. Verify the Human Confirmation form has pre-filled values
3. Verify the export queries include CRD fields
4. Test the CRD enrichment view by running the verification queries

---

## PROMPT END

---

## Notes for Implementation

### FINTRX Schema Summary (from documentation)

**Table:** `ria_contacts_current` (~788,154 rows)

| Field | Type | Description |
|-------|------|-------------|
| `RIA_CONTACT_CRD_ID` | INT64 | CRD number (unique identifier) |
| `CONTACT_FIRST_NAME` | STRING | First name |
| `CONTACT_LAST_NAME` | STRING | Last name |
| `LINKEDIN_PROFILE_URL` | STRING | LinkedIn URL (~30-40% NULL) |
| `PRIMARY_FIRM_NAME` | STRING | Firm name |
| `PRIMARY_FIRM_TOTAL_AUM` | INT64 | Firm AUM (~30% NULL) |
| `REP_TYPE` | STRING | "DR", "BD", "IA", "NA" |
| `PRODUCING_ADVISOR` | BOOLEAN | Whether actively producing |

### Matching Strategy Rationale

1. **LinkedIn Slug Match (Priority 1):** Most reliable because:
   - LinkedIn slugs are unique identifiers
   - Even if URLs have different formats (http/https, www, trailing slash), slug is consistent
   - False positive rate: ~0%

2. **Exact Name Match (Priority 2):** Secondary because:
   - Names can be common (multiple "John Smith")
   - Requires exact match (UPPER + TRIM)
   - Only used when no LinkedIn match found
   - Additional filter: name must have first + last (2+ parts)
   - False positive rate: Low but not zero

3. **What we're NOT doing:**
   - Fuzzy name matching (too many false positives)
   - Location-based matching (not reliable enough)
   - Title matching (changes frequently)
