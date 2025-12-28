-- ================================================================
-- EXPORT: NEW ADVISORS
-- Run after Monday analysis, download as CSV
-- ================================================================

SELECT
  nar.advisor_name AS `Advisor Name`,
  nar.title AS `Title`,
  nar.location AS `Location`,
  nar.linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(nar.accreditations, '; ') AS `Accreditations`,
  nar.recruiter_name AS `Found By Recruiter`,
  nar.search_type AS `Search Type`,
  CAST(nar.first_seen_date AS STRING) AS `First Seen Date`,
  -- CRD enrichment
  ea.crd_number AS `CRD Number`,
  ea.lead_priority AS `Lead Priority`,
  ea.crd_firm_name AS `Firm Name`,
  ROUND(ea.crd_firm_aum / 1000000, 1) AS `Firm AUM - Millions`,
  CASE WHEN ea.crd_is_producing = TRUE THEN 'Yes' ELSE 'No' END AS `Is Producing Advisor`
FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` nar
LEFT JOIN `savvy-gtm-analytics.savvy_pirate.v_advisors_with_crd` ea
  ON nar.advisor_id = ea.advisor_id
WHERE nar.analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY 
  CASE ea.lead_priority 
    WHEN 'HIGH - Registered Producing Advisor' THEN 1
    WHEN 'MEDIUM - Registered RIA' THEN 2
    ELSE 3
  END,
  nar.first_seen_date DESC;

