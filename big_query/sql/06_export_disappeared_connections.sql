-- ================================================================
-- EXPORT: Connections that disappeared from recruiter networks
-- These people may have changed privacy settings or unfriended
-- ================================================================

SELECT 
  recruiter_name AS `Recruiter`,
  advisor_name AS `Advisor Name`,
  advisor_title AS `Last Known Title`,
  advisor_linkedin_url AS `LinkedIn URL`,
  last_seen_date AS `Last Seen`,
  checked_date AS `Checked On`,
  days_since_seen AS `Days Gone`
FROM `savvy-gtm-analytics.savvy_pirate.v_disappeared_connections`
ORDER BY recruiter_name, days_since_seen DESC;

