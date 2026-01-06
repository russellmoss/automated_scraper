-- ============================================================================
-- PIRATE LIST SCORING - FULL V3 METHODOLOGY
-- ============================================================================
-- 
-- Scores LinkedIn connections ("Pirate List") using V3 lead scoring tiers
-- by joining to FINTRX data for tenure, mobility, firm bleeding, etc.
--
-- INPUT TABLE: savvy-gtm-analytics.ml_features.pirate_list_jan2026
--
-- TABLES USED:
-- - FinTrx_data_CA.ria_contacts_current (advisor profile)
-- - FinTrx_data_CA.contact_registered_employment_history (tenure, mobility)
-- - FinTrx_data_CA.ria_firms_current (firm info)
-- - SavvyGTMData.Lead (existing leads)
-- - SavvyGTMData.Opportunity (existing opps)
--
-- OUTPUT: Ranked list with V3 tiers, expected conversion rates, and narratives
--
-- ============================================================================

-- ============================================================================
-- STEP 0: INPUT - PIRATE LIST FROM BQ TABLE
-- ============================================================================

WITH pirate_list_input AS (
    -- Pirate List uploaded to BigQuery
    SELECT 
        SAFE_CAST(crd_number AS INT64) as crd,
        recruiter_name,
        advisor_name as pirate_advisor_name,
        linkedin_url as pirate_linkedin_url,
        match_type,
        -- Pass through existing SF data from your pirate list
        opportunity_id as existing_opp_id,
        opportunity_stage_name as existing_opp_stage,
        lead_id as existing_lead_id,
        lead_stage_name as existing_lead_stage,
        lead_disposition as existing_lead_disposition,
        sga as existing_sga,
        days_since_last_task_activity
    FROM `savvy-gtm-analytics.ml_features.pirate_list_jan2026`
    WHERE crd_number IS NOT NULL
),

-- ============================================================================
-- STEP 1: ADVISOR PROFILE FROM FINTRX
-- ============================================================================
advisor_profile AS (
    SELECT 
        c.RIA_CONTACT_CRD_ID as crd,
        c.CONTACT_FIRST_NAME as first_name,
        c.CONTACT_LAST_NAME as last_name,
        c.EMAIL as email,
        c.MOBILE_PHONE_NUMBER as mobile_phone,
        c.OFFICE_PHONE_NUMBER as office_phone,
        c.LINKEDIN_PROFILE_URL as linkedin_url,
        c.TITLE_NAME as job_title,
        c.PRIMARY_FIRM_NAME as firm_name,
        SAFE_CAST(c.PRIMARY_FIRM AS INT64) as firm_crd,
        c.PRIMARY_FIRM_START_DATE as current_firm_start_date,
        c.PRODUCING_ADVISOR as producing_advisor,
        c.REP_TYPE as rep_type,
        c.REP_LICENSES as rep_licenses,
        c.INDUSTRY_TENURE_MONTHS as industry_tenure_months,
        c.CONTACT_BIO as contact_bio,
        
        -- CFP Detection (from bio and title)
        CASE WHEN (
            UPPER(COALESCE(c.CONTACT_BIO, '')) LIKE '%CFP%'
            OR UPPER(COALESCE(c.CONTACT_BIO, '')) LIKE '%CERTIFIED FINANCIAL PLANNER%'
            OR UPPER(COALESCE(c.TITLE_NAME, '')) LIKE '%CFP%'
        ) THEN 1 ELSE 0 END as has_cfp,
        
        -- Series 65 Only (no Series 7) - Pure RIA
        CASE WHEN (
            c.REP_LICENSES LIKE '%Series 65%'
            AND c.REP_LICENSES NOT LIKE '%Series 7%'
        ) THEN 1 ELSE 0 END as has_series_65_only,
        
        -- High-Value Wealth Title Detection
        CASE WHEN (
            UPPER(c.TITLE_NAME) LIKE '%MANAGING DIRECTOR%'
            OR UPPER(c.TITLE_NAME) LIKE '%SENIOR VICE PRESIDENT%'
            OR UPPER(c.TITLE_NAME) LIKE '%PARTNER%'
            OR UPPER(c.TITLE_NAME) LIKE '%PRINCIPAL%'
            OR UPPER(c.TITLE_NAME) LIKE '%PRESIDENT%'
            OR UPPER(c.TITLE_NAME) LIKE '%FOUNDER%'
            OR UPPER(c.TITLE_NAME) LIKE '%OWNER%'
            OR UPPER(c.TITLE_NAME) LIKE '%CEO%'
            OR UPPER(c.TITLE_NAME) LIKE '%MANAGING MEMBER%'
        ) THEN 1 ELSE 0 END as is_hv_wealth_title,
        
        -- Wirehouse Detection
        CASE WHEN (
            UPPER(c.PRIMARY_FIRM_NAME) LIKE '%MORGAN STANLEY%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%MERRILL%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%WELLS FARGO%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%UBS %'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%UBS,%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%EDWARD JONES%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%GOLDMAN SACHS%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%J.P. MORGAN%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%JPMORGAN%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%CITIGROUP%'
        ) THEN 1 ELSE 0 END as is_wirehouse,
        
        -- Large IBD Detection
        CASE WHEN (
            UPPER(c.PRIMARY_FIRM_NAME) LIKE '%LPL FINANCIAL%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%AMERIPRISE%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%RAYMOND JAMES%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%COMMONWEALTH FINANCIAL%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%CETERA%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%CAMBRIDGE INVESTMENT%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%OSAIC%'
        ) THEN 1 ELSE 0 END as is_large_ibd,
        
        -- Insurance Firm Detection
        CASE WHEN (
            UPPER(c.PRIMARY_FIRM_NAME) LIKE '%NORTHWESTERN MUTUAL%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%PRUDENTIAL%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%NEW YORK LIFE%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%MASS MUTUAL%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%TRANSAMERICA%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%STATE FARM%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%ALLSTATE%'
            OR UPPER(c.PRIMARY_FIRM_NAME) LIKE '%INSURANCE%'
        ) THEN 1 ELSE 0 END as is_insurance_firm,
        
        -- Excluded Title Detection
        CASE WHEN (
            UPPER(c.TITLE_NAME) LIKE '%FINANCIAL SOLUTIONS ADVISOR%'
            OR UPPER(c.TITLE_NAME) LIKE '%FIRST VICE PRESIDENT%'
            OR UPPER(c.TITLE_NAME) LIKE '%OPERATIONS MANAGER%'
            OR UPPER(c.TITLE_NAME) LIKE '%CHIEF OPERATING OFFICER%'
            OR UPPER(c.TITLE_NAME) LIKE '%PARAPLANNER%'
            OR UPPER(c.TITLE_NAME) LIKE '%WHOLESALER%'
            OR UPPER(c.TITLE_NAME) LIKE '%COMPLIANCE OFFICER%'
            OR UPPER(c.TITLE_NAME) LIKE '%RECRUITER%'
        ) THEN 1 ELSE 0 END as is_excluded_title
        
    FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    WHERE c.RIA_CONTACT_CRD_ID IS NOT NULL
),

-- ============================================================================
-- STEP 2: TENURE CALCULATION (Current Firm)
-- ============================================================================
advisor_tenure AS (
    SELECT 
        crd,
        -- Tenure in months at current firm
        CASE 
            WHEN current_firm_start_date IS NOT NULL 
            THEN DATE_DIFF(CURRENT_DATE(), current_firm_start_date, MONTH)
            ELSE NULL
        END as current_firm_tenure_months,
        
        -- Tenure in years (for tier logic)
        CASE 
            WHEN current_firm_start_date IS NOT NULL 
            THEN DATE_DIFF(CURRENT_DATE(), current_firm_start_date, MONTH) / 12.0
            ELSE NULL
        END as tenure_years,
        
        -- Industry tenure in years
        COALESCE(industry_tenure_months, 0) / 12.0 as industry_tenure_years
        
    FROM advisor_profile
),

-- ============================================================================
-- STEP 3: MOBILITY - COUNT PRIOR FIRMS
-- ============================================================================
advisor_mobility AS (
    SELECT 
        RIA_CONTACT_CRD_ID as crd,
        COUNT(DISTINCT PREVIOUS_REGISTRATION_COMPANY_CRD_ID) as num_prior_firms,
        COUNT(DISTINCT CASE 
            WHEN PREVIOUS_REGISTRATION_COMPANY_START_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 YEAR)
            THEN PREVIOUS_REGISTRATION_COMPANY_CRD_ID 
        END) as moves_3yr,
        MIN(PREVIOUS_REGISTRATION_COMPANY_START_DATE) as career_start_date
    FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history`
    GROUP BY RIA_CONTACT_CRD_ID
),

-- ============================================================================
-- STEP 4: FIRM HEADCOUNT & BLEEDING
-- ============================================================================
firm_headcount AS (
    SELECT 
        SAFE_CAST(PRIMARY_FIRM AS INT64) as firm_crd,
        COUNT(DISTINCT RIA_CONTACT_CRD_ID) as firm_rep_count
    FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
    WHERE PRIMARY_FIRM IS NOT NULL
    GROUP BY PRIMARY_FIRM
),

-- Departures in last 12 months (advisors who LEFT this firm)
firm_departures AS (
    SELECT
        SAFE_CAST(PREVIOUS_REGISTRATION_COMPANY_CRD_ID AS INT64) as firm_crd,
        COUNT(DISTINCT RIA_CONTACT_CRD_ID) as departures_12mo
    FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history`
    WHERE PREVIOUS_REGISTRATION_COMPANY_END_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
      AND PREVIOUS_REGISTRATION_COMPANY_END_DATE <= CURRENT_DATE()
    GROUP BY PREVIOUS_REGISTRATION_COMPANY_CRD_ID
),

-- Arrivals in last 12 months (advisors who JOINED this firm)
firm_arrivals AS (
    SELECT 
        SAFE_CAST(PRIMARY_FIRM AS INT64) as firm_crd,
        COUNT(DISTINCT RIA_CONTACT_CRD_ID) as arrivals_12mo
    FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
    WHERE PRIMARY_FIRM_START_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
      AND PRIMARY_FIRM_START_DATE <= CURRENT_DATE()
    GROUP BY PRIMARY_FIRM
),

-- Combine firm stability metrics
firm_stability AS (
    SELECT 
        fh.firm_crd,
        fh.firm_rep_count,
        COALESCE(fd.departures_12mo, 0) as departures_12mo,
        COALESCE(fa.arrivals_12mo, 0) as arrivals_12mo,
        COALESCE(fa.arrivals_12mo, 0) - COALESCE(fd.departures_12mo, 0) as firm_net_change_12mo
    FROM firm_headcount fh
    LEFT JOIN firm_departures fd ON fh.firm_crd = fd.firm_crd
    LEFT JOIN firm_arrivals fa ON fh.firm_crd = fa.firm_crd
),

-- ============================================================================
-- STEP 5: SALESFORCE STATUS CHECK
-- ============================================================================
sf_opportunities AS (
    SELECT 
        SAFE_CAST(REGEXP_REPLACE(CAST(FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64) as crd,
        Id as opp_id,
        StageName as opp_stage,
        Closed_Lost_Reason__c as opp_closed_reason,
        SGA__c as opp_sga,
        ROW_NUMBER() OVER (PARTITION BY FA_CRD__c ORDER BY LastModifiedDate DESC) as rn
    FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
    WHERE IsDeleted = FALSE
      AND FA_CRD__c IS NOT NULL
),

sf_leads AS (
    SELECT 
        SAFE_CAST(REGEXP_REPLACE(CAST(FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64) as crd,
        Id as lead_id,
        Status as lead_status,
        Disposition__c as lead_disposition,
        SGA_Owner_Name__c as lead_sga,
        ROW_NUMBER() OVER (PARTITION BY FA_CRD__c ORDER BY LastModifiedDate DESC) as rn
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE IsDeleted = FALSE
      AND FA_CRD__c IS NOT NULL
),

-- ============================================================================
-- STEP 6: COMBINE ALL FEATURES
-- ============================================================================
enriched_advisors AS (
    SELECT 
        p.crd,
        p.recruiter_name,
        p.pirate_advisor_name,
        p.pirate_linkedin_url,
        
        -- Advisor Profile
        ap.first_name,
        ap.last_name,
        ap.email,
        ap.mobile_phone,
        ap.office_phone,
        ap.linkedin_url,
        ap.job_title,
        ap.firm_name,
        ap.firm_crd,
        ap.producing_advisor,
        ap.rep_type,
        
        -- Certifications & Signals
        ap.has_cfp,
        ap.has_series_65_only,
        ap.is_hv_wealth_title,
        
        -- Exclusion Flags
        ap.is_wirehouse,
        ap.is_large_ibd,
        ap.is_insurance_firm,
        ap.is_excluded_title,
        
        -- Tenure Features
        aten.current_firm_tenure_months,
        aten.tenure_years,
        aten.industry_tenure_years,
        
        -- Mobility Features
        COALESCE(am.num_prior_firms, 0) as num_prior_firms,
        COALESCE(am.moves_3yr, 0) as moves_3yr,
        
        -- Firm Features
        fs.firm_rep_count,
        fs.firm_net_change_12mo,
        fs.departures_12mo,
        fs.arrivals_12mo,
        
        -- Salesforce Status
        COALESCE(p.existing_opp_id, o.opp_id) as sf_opp_id,
        COALESCE(p.existing_opp_stage, o.opp_stage) as sf_opp_stage,
        COALESCE(p.existing_lead_id, l.lead_id) as sf_lead_id,
        COALESCE(p.existing_lead_stage, l.lead_status) as sf_lead_status,
        COALESCE(p.existing_lead_disposition, l.lead_disposition) as sf_lead_disposition,
        COALESCE(p.existing_sga, o.opp_sga, l.lead_sga) as sf_sga,
        p.days_since_last_task_activity
        
    FROM pirate_list_input p
    LEFT JOIN advisor_profile ap ON p.crd = ap.crd
    LEFT JOIN advisor_tenure aten ON p.crd = aten.crd
    LEFT JOIN advisor_mobility am ON p.crd = am.crd
    LEFT JOIN firm_stability fs ON ap.firm_crd = fs.firm_crd
    LEFT JOIN sf_opportunities o ON p.crd = o.crd AND o.rn = 1
    LEFT JOIN sf_leads l ON p.crd = l.crd AND l.rn = 1
),

-- ============================================================================
-- STEP 7: APPLY V3 TIER LOGIC
-- ============================================================================
scored_advisors AS (
    SELECT 
        *,
        
        -- EXCLUSION LOGIC
        CASE 
            WHEN producing_advisor = FALSE OR producing_advisor IS NULL THEN 'Non-Producing Advisor'
            WHEN is_wirehouse = 1 THEN 'Wirehouse'
            WHEN is_large_ibd = 1 THEN 'Large IBD'
            WHEN is_insurance_firm = 1 THEN 'Insurance Firm'
            WHEN is_excluded_title = 1 THEN 'Excluded Title'
            WHEN first_name IS NULL THEN 'No FINTRX Match'
            ELSE NULL
        END as exclusion_reason,
        
        -- V3 TIER ASSIGNMENT (Full Logic)
        CASE
            -- ============================================================
            -- TIER 1A: PRIME MOVER + CFP (16.44% conversion, 4.30x lift)
            -- ============================================================
            WHEN tenure_years BETWEEN 1 AND 4
                 AND industry_tenure_years >= 5
                 AND firm_net_change_12mo < 0
                 AND has_cfp = 1
                 AND is_wirehouse = 0
                 AND producing_advisor = TRUE
            THEN 'TIER_1A_PRIME_MOVER_CFP'
            
            -- ============================================================
            -- TIER 1B: PRIME MOVER + SERIES 65 ONLY (16.48% conversion, 4.31x lift)
            -- Pure RIA (no broker-dealer ties)
            -- ============================================================
            WHEN (
                (tenure_years BETWEEN 1 AND 3
                 AND industry_tenure_years BETWEEN 5 AND 15
                 AND firm_net_change_12mo < 0
                 AND firm_rep_count <= 50
                 AND is_wirehouse = 0)
                OR
                (tenure_years BETWEEN 1 AND 3
                 AND firm_rep_count <= 10
                 AND is_wirehouse = 0)
                OR
                (tenure_years BETWEEN 1 AND 4
                 AND industry_tenure_years BETWEEN 5 AND 15
                 AND firm_net_change_12mo < 0
                 AND is_wirehouse = 0)
            )
            AND has_series_65_only = 1
            AND producing_advisor = TRUE
            THEN 'TIER_1B_PRIME_MOVER_SERIES65'
            
            -- ============================================================
            -- TIER 1D: SMALL FIRM (14.42% conversion, 3.94x lift)
            -- Very small firms convert well
            -- ============================================================
            WHEN tenure_years BETWEEN 1 AND 3
                 AND firm_rep_count <= 10
                 AND is_wirehouse = 0
                 AND producing_advisor = TRUE
            THEN 'TIER_1D_SMALL_FIRM'
            
            -- ============================================================
            -- TIER 1E: PRIME MOVER - STANDARD (13.21% conversion, 3.46x lift)
            -- ============================================================
            WHEN tenure_years BETWEEN 1 AND 4
                 AND industry_tenure_years BETWEEN 5 AND 15
                 AND firm_net_change_12mo < 0
                 AND is_wirehouse = 0
                 AND producing_advisor = TRUE
            THEN 'TIER_1E_PRIME_MOVER'
            
            -- ============================================================
            -- TIER 1F: HV WEALTH TITLE + BLEEDING (12.78% conversion, 3.35x lift)
            -- ============================================================
            WHEN is_hv_wealth_title = 1
                 AND firm_net_change_12mo < 0
                 AND is_wirehouse = 0
                 AND producing_advisor = TRUE
            THEN 'TIER_1F_HV_WEALTH_BLEEDER'
            
            -- ============================================================
            -- TIER 2: PROVEN MOVER (8.59% conversion, 2.50x lift)
            -- Career changers with 3+ prior firms
            -- ============================================================
            WHEN num_prior_firms >= 3
                 AND industry_tenure_years >= 5
                 AND is_wirehouse = 0
                 AND producing_advisor = TRUE
            THEN 'TIER_2_PROVEN_MOVER'
            
            -- ============================================================
            -- TIER 3: MODERATE BLEEDER (9.52% conversion, 2.77x lift)
            -- ============================================================
            WHEN firm_net_change_12mo BETWEEN -10 AND -1
                 AND industry_tenure_years >= 5
                 AND is_wirehouse = 0
                 AND producing_advisor = TRUE
            THEN 'TIER_3_MODERATE_BLEEDER'
            
            -- ============================================================
            -- TIER 4: EXPERIENCED MOVER (11.54% conversion, 3.35x lift)
            -- Veterans who recently moved
            -- ============================================================
            WHEN tenure_years BETWEEN 1 AND 4
                 AND industry_tenure_years >= 20
                 AND producing_advisor = TRUE
            THEN 'TIER_4_EXPERIENCED_MOVER'
            
            -- ============================================================
            -- TIER 5: HEAVY BLEEDER (7.27% conversion, 2.11x lift)
            -- ============================================================
            WHEN firm_net_change_12mo < -10
                 AND industry_tenure_years >= 5
                 AND is_wirehouse = 0
                 AND producing_advisor = TRUE
            THEN 'TIER_5_HEAVY_BLEEDER'
            
            -- ============================================================
            -- STANDARD
            -- ============================================================
            WHEN producing_advisor = TRUE
            THEN 'STANDARD'
            
            ELSE 'UNSCORED'
        END as score_tier,
        
        -- SF Status Category
        CASE 
            WHEN sf_opp_id IS NOT NULL AND sf_opp_stage IN ('Closed Won', 'Closed Lost') THEN 'CLOSED_OPP'
            WHEN sf_opp_id IS NOT NULL THEN 'ACTIVE_OPP'
            WHEN sf_lead_id IS NOT NULL AND sf_lead_status = 'Closed' THEN 
                CASE 
                    WHEN sf_lead_disposition LIKE '%Auto-Closed%' THEN 'AUTO_CLOSED'
                    WHEN sf_lead_disposition IN ('Not Interested in Moving', 'Not a Fit', 'Bad Contact Info - Uncontacted') THEN 'CLOSED_NOT_FIT'
                    ELSE 'CLOSED_OTHER'
                END
            WHEN sf_lead_id IS NOT NULL AND sf_lead_status IN ('Contacting', 'Nurture') THEN 'ACTIVE_LEAD'
            WHEN sf_lead_id IS NOT NULL THEN 'LEAD_OTHER'
            ELSE 'NET_NEW'
        END as sf_status
        
    FROM enriched_advisors
),

-- ============================================================
-- STEP 8: ADD EXPECTED CONVERSION RATES & PRIORITIZE
-- ============================================================
final_scored AS (
    SELECT 
        *,
        
        -- Expected conversion rate by tier
        CASE score_tier
            WHEN 'TIER_1A_PRIME_MOVER_CFP' THEN 16.44
            WHEN 'TIER_1B_PRIME_MOVER_SERIES65' THEN 16.48
            WHEN 'TIER_1D_SMALL_FIRM' THEN 14.42
            WHEN 'TIER_1E_PRIME_MOVER' THEN 13.21
            WHEN 'TIER_1F_HV_WEALTH_BLEEDER' THEN 12.78
            WHEN 'TIER_4_EXPERIENCED_MOVER' THEN 11.54
            WHEN 'TIER_3_MODERATE_BLEEDER' THEN 9.52
            WHEN 'TIER_2_PROVEN_MOVER' THEN 8.59
            WHEN 'TIER_5_HEAVY_BLEEDER' THEN 7.27
            WHEN 'STANDARD' THEN 3.82
            ELSE 0
        END as expected_conversion_pct,
        
        -- Tier priority for ranking
        CASE score_tier
            WHEN 'TIER_1A_PRIME_MOVER_CFP' THEN 1
            WHEN 'TIER_1B_PRIME_MOVER_SERIES65' THEN 2
            WHEN 'TIER_1D_SMALL_FIRM' THEN 3
            WHEN 'TIER_1E_PRIME_MOVER' THEN 4
            WHEN 'TIER_1F_HV_WEALTH_BLEEDER' THEN 5
            WHEN 'TIER_4_EXPERIENCED_MOVER' THEN 6
            WHEN 'TIER_3_MODERATE_BLEEDER' THEN 7
            WHEN 'TIER_2_PROVEN_MOVER' THEN 8
            WHEN 'TIER_5_HEAVY_BLEEDER' THEN 9
            WHEN 'STANDARD' THEN 10
            ELSE 99
        END as tier_priority,
        
        -- SF Status priority (Net New is best)
        CASE sf_status
            WHEN 'NET_NEW' THEN 1
            WHEN 'AUTO_CLOSED' THEN 2
            WHEN 'LEAD_OTHER' THEN 3
            WHEN 'CLOSED_OTHER' THEN 4
            WHEN 'ACTIVE_LEAD' THEN 5
            WHEN 'CLOSED_NOT_FIT' THEN 6
            WHEN 'ACTIVE_OPP' THEN 7
            WHEN 'CLOSED_OPP' THEN 8
            ELSE 9
        END as sf_priority,
        
        -- Tier narrative explanation
        CASE score_tier
            WHEN 'TIER_1A_PRIME_MOVER_CFP' THEN 
                CONCAT(first_name, ' is a CFP® with ', CAST(ROUND(industry_tenure_years, 1) AS STRING), 
                       ' years experience at a bleeding firm (-', CAST(ABS(firm_net_change_12mo) AS STRING), 
                       ' advisors). Highest conversion potential at 16.44%.')
            WHEN 'TIER_1B_PRIME_MOVER_SERIES65' THEN 
                CONCAT(first_name, ' is a pure fee-only RIA (Series 65 only) meeting Prime Mover criteria. ',
                       'No broker-dealer ties makes transitions easier. 16.48% expected conversion.')
            WHEN 'TIER_1D_SMALL_FIRM' THEN 
                CONCAT(first_name, ' is at a very small firm (', CAST(firm_rep_count AS STRING), 
                       ' reps). Small firm advisors have highly portable client relationships. 14.42% conversion.')
            WHEN 'TIER_1E_PRIME_MOVER' THEN 
                CONCAT(first_name, ' has ', CAST(ROUND(tenure_years, 1) AS STRING), ' years at ', firm_name,
                       ' which has lost ', CAST(ABS(firm_net_change_12mo) AS STRING), ' advisors. ',
                       'Mid-career advisor at unstable firm. 13.21% conversion.')
            WHEN 'TIER_1F_HV_WEALTH_BLEEDER' THEN 
                CONCAT(first_name, ' holds a senior title (', job_title, ') at a firm losing advisors. ',
                       'Seniority indicates book ownership. 12.78% conversion.')
            WHEN 'TIER_2_PROVEN_MOVER' THEN 
                CONCAT(first_name, ' has worked at ', CAST(num_prior_firms + 1 AS STRING), ' firms over ',
                       CAST(ROUND(industry_tenure_years, 0) AS STRING), ' years. ',
                       'Proven willingness to change. 8.59% conversion.')
            WHEN 'TIER_3_MODERATE_BLEEDER' THEN 
                CONCAT(firm_name, ' has lost ', CAST(ABS(firm_net_change_12mo) AS STRING), 
                       ' advisors (moderate bleeding). ', first_name, 
                       ' is likely hearing about opportunities. 9.52% conversion.')
            WHEN 'TIER_4_EXPERIENCED_MOVER' THEN 
                CONCAT(first_name, ' is a ', CAST(ROUND(industry_tenure_years, 0) AS STRING), 
                       '-year veteran who moved to ', firm_name, ' recently. ',
                       'Veterans who recently moved will move again. 11.54% conversion.')
            WHEN 'TIER_5_HEAVY_BLEEDER' THEN 
                CONCAT(firm_name, ' is in crisis, losing ', CAST(ABS(firm_net_change_12mo) AS STRING), 
                       '+ advisors. High volume opportunity. 7.27% conversion.')
            WHEN 'STANDARD' THEN 
                CONCAT(first_name, ' does not currently meet priority tier criteria. ',
                       'Standard baseline conversion of 3.82%.')
            ELSE 'Excluded from scoring.'
        END as tier_narrative
        
    FROM scored_advisors
)

-- ============================================================
-- FINAL OUTPUT
-- ============================================================
SELECT 
    -- Ranking
    ROW_NUMBER() OVER (ORDER BY tier_priority, sf_priority, expected_conversion_pct DESC) as rank,
    
    -- Tier Info
    score_tier,
    expected_conversion_pct,
    tier_narrative,
    
    -- Exclusion (if any)
    exclusion_reason,
    
    -- Advisor Info
    recruiter_name,
    first_name,
    last_name,
    COALESCE(pirate_advisor_name, CONCAT(first_name, ' ', last_name)) as advisor_name,
    job_title,
    firm_name,
    
    -- Contact Info
    email,
    mobile_phone,
    office_phone,
    COALESCE(linkedin_url, pirate_linkedin_url) as linkedin_url,
    
    -- Key Features (for verification)
    rep_type,
    has_cfp,
    has_series_65_only,
    is_hv_wealth_title,
    ROUND(tenure_years, 1) as tenure_years,
    ROUND(industry_tenure_years, 1) as industry_tenure_years,
    num_prior_firms,
    firm_rep_count,
    firm_net_change_12mo,
    
    -- Salesforce Status
    sf_status,
    sf_sga,
    sf_opp_id,
    sf_lead_id,
    days_since_last_task_activity,
    
    -- ID
    crd
    
FROM final_scored
WHERE exclusion_reason IS NULL  -- Remove this line to see all including excluded
ORDER BY rank;


-- ============================================================
-- SUMMARY QUERY (Run separately to see tier distribution)
-- ============================================================
/*
SELECT 
    score_tier,
    COUNT(*) as count,
    ROUND(AVG(expected_conversion_pct), 2) as expected_rate,
    COUNTIF(sf_status = 'NET_NEW') as net_new,
    COUNTIF(sf_status = 'AUTO_CLOSED') as recyclable,
    COUNTIF(sf_status = 'ACTIVE_LEAD') as active_leads
FROM final_scored
WHERE exclusion_reason IS NULL
GROUP BY score_tier
ORDER BY MIN(tier_priority);
*/

-- ============================================================
-- EXCLUSION SUMMARY (Run separately)
-- ============================================================
/*
SELECT 
    exclusion_reason,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct
FROM final_scored
WHERE exclusion_reason IS NOT NULL
GROUP BY exclusion_reason
ORDER BY count DESC;
*/