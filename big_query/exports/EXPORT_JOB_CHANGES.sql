-- ================================================================
-- EXPORT: Advisor Job Changes (Strong Transition Signal)
-- ================================================================

SELECT
  a.name AS `Advisor Name`,
  jc.previous_title AS `Previous Title`,
  jc.new_title AS `New Title`,
  jc.previous_location AS `Previous Location`,
  jc.new_location AS `New Location`,
  CASE WHEN jc.is_likely_job_change THEN 'Yes' ELSE 'Maybe' END AS `Likely Job Change`,
  a.linkedin_url AS `LinkedIn URL`,
  CAST(jc.detected_date AS STRING) AS `Detected Date`
  
FROM `savvy-gtm-analytics.savvy_pirate.advisor_job_changes` jc
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON jc.advisor_id = a.id
WHERE jc.detected_date = (
  SELECT MAX(analysis_date) 
  FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY jc.is_likely_job_change DESC, a.name;

