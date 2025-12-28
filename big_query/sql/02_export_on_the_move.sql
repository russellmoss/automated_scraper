-- ================================================================
-- EXPORT: ADVISORS ON THE MOVE
-- Run after Monday analysis, download as CSV
-- ================================================================

SELECT
  advisor_name AS `Advisor Name`,
  title AS `Title`,
  location AS `Location`,
  linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(accreditations, '; ') AS `Accreditations`,
  recruiter_count AS `Number of Recruiters`,
  severity AS `Severity`,
  ARRAY_TO_STRING(recruiter_names, ' → ') AS `Recruiter Trail`,
  CAST(first_appearance AS STRING) AS `First Appearance`,
  CAST(latest_appearance AS STRING) AS `Latest Appearance`,
  days_between_first_last AS `Days Span`,
  why_flagged AS `Why Flagged`
FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY recruiter_count DESC, advisor_name;

