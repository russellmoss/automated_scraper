-- ================================================================
-- VIEW: v_advisors_with_crd
-- Enriches advisors with CRD numbers from FINTRX
-- Match Priority: 1. LinkedIn slug, 2. Exact name
-- Conservative: Only matches high-confidence records
-- 
-- IMPORTANT: This view references datasets in different regions:
-- - savvy_pirate (US region)
-- - FinTrx_data_CA (northamerica-northeast2 region)
-- 
-- BigQuery views cannot reference cross-region datasets directly.
-- OPTIONS:
-- 1. Run this query manually in BigQuery Console (Toronto region)
-- 2. Use a scheduled query to materialize results into a table
-- 3. Create the view in the Toronto region dataset
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

