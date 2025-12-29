-- ================================================================
-- EXPORT: NEW ADVISORS (Enhanced - Compares Recent Scrapes)
-- Finds advisors who appeared in the most recent scrape but NOT in the previous scrape
-- Uses enhanced FINTRX enrichment (v_advisors_with_fintrx) for lead scoring
-- ================================================================

WITH 
-- Find all completed scrapes with actual observation counts
scrape_counts AS (
  SELECT 
    sr.recruiter_id,
    r.name as recruiter_name,
    r.company as recruiter_company,
    DATE(sr.started_at) as scrape_date,
    sr.profiles_scraped,
    COUNT(DISTINCT RTRIM(LOWER(TRIM(co.advisor_linkedin_url)), '/')) as unique_advisors
  FROM `savvy-gtm-analytics.savvy_pirate.scrape_runs` sr
  JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON sr.recruiter_id = r.id
  LEFT JOIN `savvy-gtm-analytics.savvy_pirate.connection_observations` co
    ON co.recruiter_id = sr.recruiter_id
    AND DATE(co.observed_at) = DATE(sr.started_at)
  WHERE sr.status = 'completed'
  GROUP BY sr.recruiter_id, r.name, r.company, DATE(sr.started_at), sr.profiles_scraped
  HAVING COUNT(DISTINCT RTRIM(LOWER(TRIM(co.advisor_linkedin_url)), '/')) >= 100
),

-- Rank scrapes per recruiter (most recent first)
ranked_scrapes AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (PARTITION BY recruiter_id ORDER BY scrape_date DESC) as scrape_rank
  FROM scrape_counts
),

-- Get the two most recent scrapes per recruiter
scrape_pairs AS (
  SELECT 
    r1.recruiter_id,
    r1.recruiter_name,
    r1.recruiter_company,
    r2.scrape_date as archive_date,
    r2.unique_advisors as archive_count,
    r1.scrape_date as new_date,
    r1.unique_advisors as new_count
  FROM ranked_scrapes r1
  JOIN ranked_scrapes r2 
    ON r1.recruiter_id = r2.recruiter_id
    AND r1.scrape_rank = 1
    AND r2.scrape_rank = 2
  WHERE DATE_DIFF(r1.scrape_date, r2.scrape_date, DAY) >= 5
),

-- Build archive observations (older scrape)
archive_observations AS (
  SELECT DISTINCT
    sp.recruiter_id,
    sp.recruiter_name,
    RTRIM(LOWER(TRIM(co.advisor_linkedin_url)), '/') as url
  FROM scrape_pairs sp
  JOIN `savvy-gtm-analytics.savvy_pirate.connection_observations` co
    ON co.recruiter_id = sp.recruiter_id
    AND DATE(co.observed_at) = sp.archive_date
  WHERE co.advisor_linkedin_url IS NOT NULL
    AND TRIM(co.advisor_linkedin_url) != ''
),

-- Get new scrape observations (newer scrape, deduplicated)
new_observations AS (
  SELECT 
    sp.recruiter_id,
    sp.recruiter_name,
    sp.recruiter_company,
    sp.archive_date,
    sp.new_date,
    RTRIM(LOWER(TRIM(co.advisor_linkedin_url)), '/') as url,
    co.advisor_linkedin_url,
    co.advisor_name,
    co.advisor_title,
    co.advisor_location,
    ROW_NUMBER() OVER (
      PARTITION BY sp.recruiter_id, RTRIM(LOWER(TRIM(co.advisor_linkedin_url)), '/')
      ORDER BY co.observed_at
    ) as rn
  FROM scrape_pairs sp
  JOIN `savvy-gtm-analytics.savvy_pirate.connection_observations` co
    ON co.recruiter_id = sp.recruiter_id
    AND DATE(co.observed_at) = sp.new_date
  WHERE co.advisor_linkedin_url IS NOT NULL
    AND TRIM(co.advisor_linkedin_url) != ''
),

new_deduped AS (
  SELECT * FROM new_observations WHERE rn = 1
),

-- Find NEW advisors (in new but NOT in archive)
new_connections AS (
  SELECT nd.*
  FROM new_deduped nd
  LEFT JOIN archive_observations ao
    ON nd.recruiter_id = ao.recruiter_id
    AND nd.url = ao.url
  WHERE ao.url IS NULL
),

-- Match to Salesforce Leads by CRD number
crm_leads AS (
  SELECT 
    CAST(FA_CRD__c AS STRING) as crd_number,
    Id as lead_id,
    Name as lead_name,
    Status as lead_status,
    SGA_Owner_Name__c as lead_owner_sga,
    Disposition__c as lead_disposition
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL
    AND IsDeleted = FALSE
    AND TRIM(CAST(FA_CRD__c AS STRING)) != ''
),

-- Match to Salesforce Opportunities by CRD number
crm_opportunities AS (
  SELECT 
    CAST(FA_CRD__c AS STRING) as crd_number,
    Id as opportunity_id,
    Name as opportunity_name,
    StageName as opportunity_stage,
    Opportunity_Owner_Name__c as opportunity_owner_sgm,
    Closed_Lost_Reason__c as opportunity_closed_lost_reason,
    Amount as opportunity_amount
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE FA_CRD__c IS NOT NULL
    AND IsDeleted = FALSE
    AND TRIM(CAST(FA_CRD__c AS STRING)) != ''
),

-- Combine CRM matches (prefer Opportunity over Lead)
-- Match by CRD number, preferring Opportunity if both exist
crm_matches AS (
  SELECT 
    COALESCE(opp.crd_number, lead.crd_number) as crd_number,
    -- Prefer Opportunity if exists, otherwise Lead
    COALESCE(opp.opportunity_id, lead.lead_id) as crm_record_id,
    CASE WHEN opp.opportunity_id IS NOT NULL THEN 'Opportunity' ELSE 'Lead' END as crm_record_type,
    -- Opportunity fields (if exists)
    opp.opportunity_name,
    opp.opportunity_stage,
    opp.opportunity_owner_sgm,
    opp.opportunity_closed_lost_reason,
    opp.opportunity_amount,
    -- Lead fields (only if no Opportunity)
    CASE WHEN opp.opportunity_id IS NULL THEN lead.lead_name END as lead_name,
    CASE WHEN opp.opportunity_id IS NULL THEN lead.lead_status END as lead_status,
    CASE WHEN opp.opportunity_id IS NULL THEN lead.lead_owner_sga END as lead_owner_sga,
    CASE WHEN opp.opportunity_id IS NULL THEN lead.lead_disposition END as lead_disposition
  FROM crm_opportunities opp
  FULL OUTER JOIN crm_leads lead ON opp.crd_number = lead.crd_number
  WHERE opp.opportunity_id IS NOT NULL OR lead.lead_id IS NOT NULL
)

-- FINAL OUTPUT
SELECT 
  nc.recruiter_name AS Found_By_Recruiter,
  nc.recruiter_company AS Recruiter_Company,
  nc.advisor_name AS Name,
  nc.advisor_title AS Title_from_LinkedIn,
  nc.advisor_location AS Location,
  nc.advisor_linkedin_url AS LinkedIn_URL,
  CAST(nc.archive_date AS STRING) AS Compared_To_Scrape,
  CAST(nc.new_date AS STRING) AS Found_In_Scrape,
  
  -- FINTRX match status
  CASE WHEN f.crd_number IS NOT NULL THEN 'Yes' ELSE 'No' END AS In_FINTRX,
  f.crd_number AS CRD_Number,
  f.match_type AS CRD_Match_Type,
  
  -- LEAD PRIORITY
  f.lead_priority AS Lead_Priority,
  
  -- KEY FLAGS
  CASE WHEN f.is_producing_advisor = 1 THEN 'Yes' ELSE 'No' END AS Producing_Advisor,
  CASE WHEN f.is_independent = 1 THEN 'Yes' ELSE 'No' END AS Independent_Not_Wirehouse,
  CASE WHEN f.has_series_65 = 1 THEN 'Yes' ELSE 'No' END AS Has_Series_65,
  CASE WHEN f.has_series_65_only = 1 THEN 'Yes' ELSE 'No' END AS Fee_Only_RIA_65_Only,
  CASE WHEN f.has_series_7 = 1 THEN 'Yes' ELSE 'No' END AS Has_Series_7,
  CASE WHEN f.has_cfp = 1 THEN 'Yes' ELSE 'No' END AS Has_CFP,
  CASE WHEN f.has_cfa = 1 THEN 'Yes' ELSE 'No' END AS Has_CFA,
  
  -- Experience & Mobility
  f.industry_tenure_years AS Industry_Experience_Years,
  CASE WHEN f.has_7plus_years_experience = 1 THEN 'Yes' ELSE 'No' END AS Has_7plus_Years_Experience,
  f.num_prior_firms AS Prior_Firms,
  CASE WHEN f.has_moved_firms = 1 THEN 'Yes' ELSE 'No' END AS Has_Moved_Firms_1plus,
  CASE WHEN f.has_moved_firms_2plus = 1 THEN 'Yes' ELSE 'No' END AS Has_Moved_Firms_2plus,
  
  -- Firm info
  f.crd_firm_name AS FINTRX_Firm_Name,
  f.firm_rep_count AS Firm_Size_Reps,
  ROUND(f.crd_firm_aum / 1000000, 1) AS Firm_AUM_Millions,
  f.firm_classification AS Firm_Classification,
  f.fintrx_job_title AS FINTRX_Job_Title,
  f.rep_type AS Rep_Type,
  f.rep_licenses AS Licenses,
  
  -- CRM MATCH INFORMATION (by CRD number)
  CASE WHEN crm.crm_record_id IS NOT NULL THEN 'Yes' ELSE 'No' END AS In_Salesforce_CRM,
  crm.crm_record_type AS CRM_Record_Type,
  
  -- Lead fields (if matched to Lead, not Opportunity)
  crm.lead_name AS Salesforce_Lead_Name,
  crm.lead_status AS Lead_Status,
  crm.lead_owner_sga AS Lead_Owner_SGA,
  crm.lead_disposition AS Lead_Disposition,
  
  -- Opportunity fields (if matched to Opportunity - preferred)
  crm.opportunity_name AS Salesforce_Opportunity_Name,
  crm.opportunity_stage AS Opportunity_Stage,
  crm.opportunity_owner_sgm AS Opportunity_Owner_SGM,
  crm.opportunity_closed_lost_reason AS Opportunity_Closed_Lost_Reason,
  CAST(crm.opportunity_amount AS STRING) AS Opportunity_Amount

FROM new_connections nc
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_with_fintrx` f
  ON nc.url = RTRIM(LOWER(TRIM(f.advisor_linkedin_url)), '/')
LEFT JOIN crm_matches crm
  ON CAST(f.crd_number AS STRING) = crm.crd_number
  
ORDER BY 
  CASE 
    WHEN f.is_producing_advisor = 1 AND f.is_independent = 1 AND f.has_7plus_years_experience = 1 AND f.has_moved_firms = 1 THEN 1
    WHEN f.is_producing_advisor = 1 AND f.is_independent = 1 AND f.has_7plus_years_experience = 1 THEN 2
    WHEN f.is_producing_advisor = 1 AND f.is_independent = 1 THEN 3
    WHEN f.has_series_65_only = 1 THEN 4
    WHEN f.crd_number IS NOT NULL THEN 5
    ELSE 6
  END,
  nc.recruiter_name,
  nc.advisor_name;
