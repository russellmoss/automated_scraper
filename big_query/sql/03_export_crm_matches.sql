-- ================================================================
-- EXPORT: CRM MATCH ALERTS (Re-Engagement Opportunities)
-- Run after Monday analysis, download as CSV
-- ================================================================

SELECT
  advisor_name AS `Advisor Name`,
  advisor_linkedin_url AS `LinkedIn URL`,
  match_type AS `Match Type`,
  match_confidence AS `Match Confidence`,
  alert_priority AS `Priority`,
  
  -- Lead info (if matched)
  lead_name AS `Lead Name`,
  lead_status AS `Lead Status`,
  lead_owner_name AS `Lead Owner - SGA`,
  lead_disposition AS `Disposition`,
  lead_closed_lost_reason AS `Lead Closed Lost Reason`,
  
  -- Opportunity info (if matched)
  opportunity_name AS `Opportunity Name`,
  opportunity_stage AS `Opportunity Stage`,
  opportunity_owner_name AS `Opportunity Owner - SGM`,
  opportunity_closed_lost_reason AS `Opp Closed Lost Reason`,
  CAST(opportunity_amount AS STRING) AS `Opportunity Amount`,
  
  -- Context
  found_via AS `Found Via`,
  ARRAY_TO_STRING(recruiter_names, ', ') AS `Recruiters`,
  CAST(first_seen_date AS STRING) AS `First Seen in Recruiter Network`,
  suggested_action AS `Suggested Action`
  
FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY alert_priority DESC, advisor_name;

