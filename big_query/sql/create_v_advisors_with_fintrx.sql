-- ============================================================================
-- VIEW: v_advisors_with_fintrx
-- Enhanced FINTRX enrichment view with lead scoring tiers
-- Joins Savvy Pirate advisors to FINTRX via LinkedIn URL (most reliable)
-- 
-- Features:
-- - Wirehouse exclusion logic
-- - Advisor mobility tracking (firm moves)
-- - License detection (Series 65, Series 7)
-- - Certification detection (CFP, CFA)
-- - Experience metrics (industry tenure, firm tenure)
-- - Lead priority tiers (TIER 1-5)
-- ============================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_pirate.v_advisors_with_fintrx` AS

WITH 
-- Wirehouses to exclude
excluded_firms AS (
    SELECT firm_pattern FROM UNNEST([
        '%J.P. MORGAN%', '%MORGAN STANLEY%', '%MERRILL%', '%WELLS FARGO%', 
        '%UBS %', '%UBS,%', '%EDWARD JONES%', '%AMERIPRISE%', 
        '%NORTHWESTERN MUTUAL%', '%PRUDENTIAL%', '%RAYMOND JAMES%',
        '%FIDELITY%', '%SCHWAB%', '%VANGUARD%', '%GOLDMAN SACHS%', '%CITIGROUP%',
        '%LPL FINANCIAL%', '%COMMONWEALTH%', '%CETERA%', '%CAMBRIDGE%',
        '%OSAIC%', '%PRIMERICA%',
        '%STATE FARM%', '%ALLSTATE%', '%NEW YORK LIFE%', '%NYLIFE%',
        '%TRANSAMERICA%', '%FARM BUREAU%', '%NATIONWIDE%',
        '%LINCOLN FINANCIAL%', '%MASS MUTUAL%', '%MASSMUTUAL%'
    ]) as firm_pattern
),

-- Advisor employment history for moves
advisor_moves AS (
    SELECT 
        RIA_CONTACT_CRD_ID as crd,
        COUNT(DISTINCT PREVIOUS_REGISTRATION_COMPANY_CRD_ID) as total_firms,
        COUNT(DISTINCT PREVIOUS_REGISTRATION_COMPANY_CRD_ID) - 1 as num_prior_firms
    FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history`
    GROUP BY RIA_CONTACT_CRD_ID
),

-- FINTRX contacts with LinkedIn normalization
fintrx_contacts AS (
    SELECT 
        c.RIA_CONTACT_CRD_ID as crd,
        c.CONTACT_FIRST_NAME as fintrx_first_name,
        c.CONTACT_LAST_NAME as fintrx_last_name,
        c.PRIMARY_FIRM_NAME as firm_name,
        SAFE_CAST(c.PRIMARY_FIRM AS INT64) as firm_crd,
        c.PRIMARY_FIRM_TOTAL_AUM as firm_aum,
        c.PRIMARY_FIRM_EMPLOYEE_COUNT as firm_rep_count,
        c.PRIMARY_FIRM_CLASSIFICATION as firm_classification,
        c.LINKEDIN_PROFILE_URL as fintrx_linkedin_url,
        RTRIM(LOWER(TRIM(c.LINKEDIN_PROFILE_URL)), '/') as linkedin_normalized,
        
        -- Licenses
        c.REP_LICENSES,
        CASE WHEN c.REP_LICENSES LIKE '%Series 65%' THEN 1 ELSE 0 END as has_series_65,
        CASE WHEN c.REP_LICENSES LIKE '%Series 65%' AND c.REP_LICENSES NOT LIKE '%Series 7%' THEN 1 ELSE 0 END as has_series_65_only,
        CASE WHEN c.REP_LICENSES LIKE '%Series 7%' THEN 1 ELSE 0 END as has_series_7,
        
        -- Certifications (from bio and title)
        CASE WHEN c.CONTACT_BIO LIKE '%CFP%' OR c.CONTACT_BIO LIKE '%Certified Financial Planner%' OR c.TITLE_NAME LIKE '%CFP%' THEN 1 ELSE 0 END as has_cfp,
        CASE WHEN c.CONTACT_BIO LIKE '%CFA%' OR c.CONTACT_BIO LIKE '%Chartered Financial Analyst%' OR c.TITLE_NAME LIKE '%CFA%' THEN 1 ELSE 0 END as has_cfa,
        
        -- Producing advisor (already a BOOL in FINTRX)
        c.PRODUCING_ADVISOR as is_producing_advisor,
        
        -- Experience - FINTRX has this pre-calculated!
        c.INDUSTRY_TENURE_MONTHS,
        CAST(FLOOR(c.INDUSTRY_TENURE_MONTHS / 12) AS INT64) as industry_tenure_years,
        
        -- Current firm tenure
        c.PRIMARY_FIRM_START_DATE,
        DATE_DIFF(CURRENT_DATE(), c.PRIMARY_FIRM_START_DATE, YEAR) as current_firm_tenure_years,
        
        -- Title
        c.TITLE_NAME as job_title,
        
        -- Rep type
        c.REP_TYPE
        
    FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    WHERE c.LINKEDIN_PROFILE_URL IS NOT NULL AND TRIM(c.LINKEDIN_PROFILE_URL) != ''
)

SELECT 
    a.id as advisor_id,
    a.name as advisor_name,
    a.linkedin_url as advisor_linkedin_url,
    a.current_title,
    a.current_location,
    a.accreditations,
    
    -- Match info
    f.crd as crd_number,
    '1. LinkedIn URL Match' as match_type,
    f.fintrx_first_name,
    f.fintrx_last_name,
    
    -- Firm info
    f.firm_name as crd_firm_name,
    f.firm_crd,
    f.firm_aum as crd_firm_aum,
    f.firm_rep_count,
    f.firm_classification,
    
    -- Job title from FINTRX
    f.job_title as fintrx_job_title,
    f.REP_TYPE as rep_type,
    
    -- KEY FLAGS FOR LEAD SCORING
    CASE WHEN f.is_producing_advisor = TRUE THEN 1 ELSE 0 END as is_producing_advisor,
    CASE WHEN EXISTS (SELECT 1 FROM excluded_firms ef WHERE UPPER(f.firm_name) LIKE ef.firm_pattern) THEN 1 ELSE 0 END as is_wirehouse,
    CASE WHEN NOT EXISTS (SELECT 1 FROM excluded_firms ef WHERE UPPER(f.firm_name) LIKE ef.firm_pattern) THEN 1 ELSE 0 END as is_independent,
    f.has_series_65,
    f.has_series_65_only,
    f.has_series_7,
    f.has_cfp,
    f.has_cfa,
    f.REP_LICENSES as rep_licenses,
    
    -- Experience & mobility
    f.industry_tenure_years,
    f.INDUSTRY_TENURE_MONTHS as industry_tenure_months,
    f.current_firm_tenure_years,
    COALESCE(am.num_prior_firms, 0) as num_prior_firms,
    CASE WHEN f.industry_tenure_years >= 7 THEN 1 ELSE 0 END as has_7plus_years_experience,
    CASE WHEN COALESCE(am.num_prior_firms, 0) >= 1 THEN 1 ELSE 0 END as has_moved_firms,
    CASE WHEN COALESCE(am.num_prior_firms, 0) >= 2 THEN 1 ELSE 0 END as has_moved_firms_2plus,
    
    -- Lead priority (aligned with your V3.2 model)
    CASE 
        WHEN f.is_producing_advisor = TRUE 
             AND NOT EXISTS (SELECT 1 FROM excluded_firms ef WHERE UPPER(f.firm_name) LIKE ef.firm_pattern)
             AND f.industry_tenure_years >= 7
             AND COALESCE(am.num_prior_firms, 0) >= 1
        THEN 'TIER 1 - Independent Producing 7+ Yrs + Has Moved'
        WHEN f.is_producing_advisor = TRUE 
             AND NOT EXISTS (SELECT 1 FROM excluded_firms ef WHERE UPPER(f.firm_name) LIKE ef.firm_pattern)
             AND f.industry_tenure_years >= 7
        THEN 'TIER 2 - Independent Producing 7+ Yrs'
        WHEN f.is_producing_advisor = TRUE 
             AND NOT EXISTS (SELECT 1 FROM excluded_firms ef WHERE UPPER(f.firm_name) LIKE ef.firm_pattern)
        THEN 'TIER 3 - Independent Producing Advisor'
        WHEN f.has_series_65_only = 1 
        THEN 'TIER 4 - Fee-Only RIA (Series 65 Only)'
        WHEN f.crd IS NOT NULL 
        THEN 'TIER 5 - Registered Advisor'
        ELSE 'NOT IN FINTRX'
    END as lead_priority

FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
LEFT JOIN fintrx_contacts f 
    ON RTRIM(LOWER(TRIM(a.linkedin_url)), '/') = f.linkedin_normalized
LEFT JOIN advisor_moves am ON f.crd = am.crd;

