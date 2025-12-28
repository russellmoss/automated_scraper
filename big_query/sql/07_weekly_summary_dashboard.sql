-- ================================================================
-- DASHBOARD: Weekly Analysis Summary
-- Use this to see the overall results of each Monday analysis
-- ================================================================

SELECT
  analysis_date AS `Analysis Date`,
  frequency_group AS `Frequency Group`,
  CONCAT(CAST(current_period_start AS STRING), ' to ', CAST(current_period_end AS STRING)) AS `Period Analyzed`,
  total_new_advisors AS `New Advisors`,
  total_advisors_on_move AS `On The Move`,
  total_crm_matches AS `CRM Matches`,
  recruiters_analyzed AS `Recruiters Analyzed`,
  status AS `Status`
FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
ORDER BY analysis_date DESC
LIMIT 20;

