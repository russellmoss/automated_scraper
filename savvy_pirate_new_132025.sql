-- ================================================================
-- ENRICHED NEW CONNECTIONS - FIXED (No cartesian explosion)
-- LinkedIn match only, one row per new connection
-- ================================================================

WITH date_pairs AS (
  SELECT 'rec_13be8c03cbde1f515c8e2fdb6d447280' AS recruiter_id, 'Louis Diamond' AS recruiter_name, DATE('2025-12-16') AS before_date, DATE('2025-12-30') AS after_date UNION ALL
  SELECT 'rec_477d828c44c9e6253f039ddbd0bfb129', 'Jeff Nash', DATE('2025-12-17'), DATE('2025-12-30') UNION ALL
  SELECT 'rec_a58a6412ec35c742717719a48cfa6b29', 'Jesse Papike', DATE('2025-12-17'), DATE('2025-12-31') UNION ALL
  SELECT 'rec_f8edf631e0aa7deae32ac791e31f7ca1', 'Patrick Kelly', DATE('2025-12-19'), DATE('2025-12-31') UNION ALL
  SELECT 'rec_ea96c45a50714de0f328dc1e94eaec59', 'Jon Bartick', DATE('2025-12-27'), DATE('2025-12-31') UNION ALL
  SELECT 'rec_9386ca86f6abcff8f04e202ebfa19568', 'Taylor Newman', DATE('2025-12-19'), DATE('2026-01-03') UNION ALL
  SELECT 'rec_383b3d012c947722a8daa046e34dad4f', 'Kate Little', DATE('2025-12-20'), DATE('2025-12-29') UNION ALL
  SELECT 'rec_8be80e69d20526c751937abd08ef20ae', 'Kaitlin Wickenheiser', DATE('2025-12-20'), DATE('2026-01-03') UNION ALL
  SELECT 'rec_43c823df02538341a757e0239defeeae', 'Scott Briganti', DATE('2025-12-16'), DATE('2025-12-26') UNION ALL
  SELECT 'rec_c7545b1e9763af6291d14f8cce0c0aa1', 'Morgan Cirotto', DATE('2025-12-17'), DATE('2025-12-29') UNION ALL
  SELECT 'rec_4a1301a277a92160a187619aac2bf424', 'Nicole Owens', DATE('2025-12-16'), DATE('2025-12-29')
),

before_urls AS (
  SELECT DISTINCT
    dp.recruiter_id,
    LOWER(REGEXP_EXTRACT(o.advisor_linkedin_url, r'linkedin\.com/in/([^/?#]+)')) AS linkedin_slug
  FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o
  JOIN date_pairs dp ON o.recruiter_id = dp.recruiter_id
  WHERE DATE(o.observed_at) = dp.before_date
    AND o.advisor_linkedin_url IS NOT NULL
    AND o.advisor_linkedin_url != ''
),

after_profiles AS (
  SELECT DISTINCT
    dp.recruiter_id,
    dp.recruiter_name,
    dp.before_date,
    dp.after_date,
    LOWER(REGEXP_EXTRACT(o.advisor_linkedin_url, r'linkedin\.com/in/([^/?#]+)')) AS linkedin_slug,
    FIRST_VALUE(o.advisor_name) OVER (
      PARTITION BY dp.recruiter_id, LOWER(REGEXP_EXTRACT(o.advisor_linkedin_url, r'linkedin\.com/in/([^/?#]+)'))
      ORDER BY o.observed_at DESC
    ) AS advisor_name,
    FIRST_VALUE(o.advisor_title) OVER (
      PARTITION BY dp.recruiter_id, LOWER(REGEXP_EXTRACT(o.advisor_linkedin_url, r'linkedin\.com/in/([^/?#]+)'))
      ORDER BY o.observed_at DESC
    ) AS advisor_title,
    FIRST_VALUE(o.advisor_location) OVER (
      PARTITION BY dp.recruiter_id, LOWER(REGEXP_EXTRACT(o.advisor_linkedin_url, r'linkedin\.com/in/([^/?#]+)'))
      ORDER BY o.observed_at DESC
    ) AS advisor_location,
    FIRST_VALUE(o.advisor_linkedin_url) OVER (
      PARTITION BY dp.recruiter_id, LOWER(REGEXP_EXTRACT(o.advisor_linkedin_url, r'linkedin\.com/in/([^/?#]+)'))
      ORDER BY o.observed_at DESC
    ) AS linkedin_url
  FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o
  JOIN date_pairs dp ON o.recruiter_id = dp.recruiter_id
  WHERE DATE(o.observed_at) = dp.after_date
    AND o.advisor_linkedin_url IS NOT NULL
    AND o.advisor_linkedin_url != ''
),

-- Deduplicate to one row per recruiter + linkedin_slug
after_deduped AS (
  SELECT 
    recruiter_id,
    recruiter_name,
    before_date,
    after_date,
    linkedin_slug,
    advisor_name,
    advisor_title,
    advisor_location,
    linkedin_url,
    ROW_NUMBER() OVER (PARTITION BY recruiter_id, linkedin_slug ORDER BY linkedin_url) AS rn
  FROM after_profiles
  WHERE linkedin_slug IS NOT NULL
),

after_unique AS (
  SELECT * FROM after_deduped WHERE rn = 1
),

-- Find NEW connections
new_connections AS (
  SELECT 
    a.recruiter_name,
    a.before_date,
    a.after_date,
    a.advisor_name,
    a.advisor_title,
    a.advisor_location,
    a.linkedin_url,
    a.linkedin_slug
  FROM after_unique a
  LEFT JOIN before_urls b 
    ON a.recruiter_id = b.recruiter_id 
    AND a.linkedin_slug = b.linkedin_slug
  WHERE b.linkedin_slug IS NULL
),

-- FINTRX lookup - deduplicated by LinkedIn slug (pick one if duplicates exist)
fintrx_deduped AS (
  SELECT 
    LOWER(REGEXP_EXTRACT(LINKEDIN_PROFILE_URL, r'linkedin\.com/in/([^/?#]+)')) AS fintrx_linkedin_slug,
    CAST(RIA_CONTACT_CRD_ID AS STRING) AS crd_number,
    CONTACT_FIRST_NAME,
    CONTACT_LAST_NAME,
    PRIMARY_FIRM_NAME AS firm_name,
    PRIMARY_FIRM_TOTAL_AUM AS firm_aum,
    OFFICE_PHONE_NUMBER,
    MOBILE_PHONE_NUMBER,
    EMAIL,
    PRODUCING_ADVISOR,
    REP_TYPE,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(REGEXP_EXTRACT(LINKEDIN_PROFILE_URL, r'linkedin\.com/in/([^/?#]+)'))
      ORDER BY PRODUCING_ADVISOR DESC, PRIMARY_FIRM_TOTAL_AUM DESC NULLS LAST
    ) AS rn
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
  WHERE LINKEDIN_PROFILE_URL IS NOT NULL
    AND REGEXP_EXTRACT(LINKEDIN_PROFILE_URL, r'linkedin\.com/in/([^/?#]+)') IS NOT NULL
),

fintrx_unique AS (
  SELECT * FROM fintrx_deduped WHERE rn = 1
),

-- Salesforce Opportunity lookup by FA_CRD__c
sf_opportunity AS (
  SELECT 
    FA_CRD__c AS crd_number,
    Id AS opportunity_id,
    StageName AS opp_stage_name,
    Closed_Lost_Details__c AS opp_closed_lost_details,
    Closed_Lost_Reason__c AS opp_closed_lost_reason,
    SGA__c AS opp_sga,
    ROW_NUMBER() OVER (PARTITION BY FA_CRD__c ORDER BY LastModifiedDate DESC) AS rn
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND FA_CRD__c IS NOT NULL
    AND FA_CRD__c != ''
),

sf_opportunity_unique AS (
  SELECT * FROM sf_opportunity WHERE rn = 1
),

-- Salesforce Lead lookup by FA_CRD__c (only if not in Opportunity)
sf_lead AS (
  SELECT 
    l.FA_CRD__c AS crd_number,
    l.Id AS lead_id,
    l.Full_Prospect_ID__c AS lead_prospect_id,
    l.Disposition__c AS lead_disposition,
    l.Status AS lead_stage_name,
    l.SGA_Owner_Name__c AS lead_sga,
    ROW_NUMBER() OVER (PARTITION BY l.FA_CRD__c ORDER BY l.LastModifiedDate DESC) AS rn
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
  LEFT JOIN sf_opportunity_unique o ON l.FA_CRD__c = o.crd_number
  WHERE l.IsDeleted = FALSE
    AND l.FA_CRD__c IS NOT NULL
    AND l.FA_CRD__c != ''
    AND o.crd_number IS NULL  -- Only leads that don't have an opportunity
),

sf_lead_unique AS (
  SELECT * FROM sf_lead WHERE rn = 1
),

-- Task activity lookup - find most recent task for Opportunity or Lead
task_activity AS (
  SELECT 
    COALESCE(t.WhatId, t.WhoId) AS sf_record_id,
    MAX(t.ActivityDate) AS last_task_date
  FROM `savvy-gtm-analytics.SavvyGTMData.Task` t
  WHERE t.IsDeleted = FALSE
    AND t.ActivityDate IS NOT NULL
    AND (t.WhatId IS NOT NULL OR t.WhoId IS NOT NULL)
  GROUP BY COALESCE(t.WhatId, t.WhoId)
)

-- Final output: one row per new connection
SELECT 
  nc.recruiter_name,
  nc.before_date,
  nc.after_date,
  nc.advisor_name,
  nc.advisor_title,
  nc.advisor_location,
  nc.linkedin_url,
  
  -- FINTRX enrichment (LinkedIn match only)
  CASE WHEN f.crd_number IS NOT NULL THEN 'LinkedIn Match' ELSE 'No Match' END AS match_type,
  f.crd_number,
  f.firm_name AS fintrx_firm_name,
  ROUND(f.firm_aum / 1000000, 1) AS firm_aum_millions,
  f.OFFICE_PHONE_NUMBER AS office_phone,
  f.MOBILE_PHONE_NUMBER AS mobile_phone,
  f.EMAIL AS email,
  f.PRODUCING_ADVISOR AS producing_advisor,
  f.REP_TYPE AS rep_type,
  
  -- Salesforce Opportunity fields (if found)
  opp.opportunity_id,
  opp.opp_stage_name AS opportunity_stage_name,
  opp.opp_closed_lost_details AS opportunity_closed_lost_details,
  opp.opp_closed_lost_reason AS opportunity_closed_lost_reason,
  opp.opp_sga AS opportunity_sga,
  
  -- Salesforce Lead fields (if found, and not in Opportunity)
  lead.lead_id,
  lead.lead_prospect_id AS lead_prospect_id,
  lead.lead_disposition AS lead_disposition,
  lead.lead_stage_name AS lead_stage_name,
  lead.lead_sga AS lead_sga,
  
  -- Combined SGA (from Opportunity or Lead)
  COALESCE(opp.opp_sga, lead.lead_sga) AS sga,
  
  -- Salesforce record type indicator
  CASE 
    WHEN opp.opportunity_id IS NOT NULL THEN 'Opportunity'
    WHEN lead.lead_id IS NOT NULL THEN 'Lead'
    ELSE NULL
  END AS sf_record_type,
  
  -- Days since last Task activity
  CASE 
    WHEN ta.last_task_date IS NOT NULL THEN 
      DATE_DIFF(CURRENT_DATE(), ta.last_task_date, DAY)
    ELSE NULL
  END AS days_since_last_task_activity

FROM new_connections nc
LEFT JOIN fintrx_unique f 
  ON nc.linkedin_slug = f.fintrx_linkedin_slug
LEFT JOIN sf_opportunity_unique opp
  ON f.crd_number = opp.crd_number
LEFT JOIN sf_lead_unique lead
  ON f.crd_number = lead.crd_number
LEFT JOIN task_activity ta
  ON ta.sf_record_id = COALESCE(opp.opportunity_id, lead.lead_id)

ORDER BY 
  nc.recruiter_name,
  CASE WHEN f.PRODUCING_ADVISOR = TRUE THEN 0 ELSE 1 END,
  CASE WHEN f.crd_number IS NOT NULL THEN 0 ELSE 1 END,
  nc.advisor_name;