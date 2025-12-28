-- ================================================================
-- EXPORT: Reconstruct a specific scrape
-- Replace the date and recruiter name to get exact point-in-time data
-- ⚠️ Uses v_observations_with_advisors to ensure correct advisor_id matching
-- ================================================================
-- INSTRUCTIONS:
-- 1. Replace 'RECRUITER_NAME_HERE' with actual recruiter name (e.g., 'Kylie Leone')
-- 2. Replace 'YYYY-MM-DD' with the scrape date (e.g., '2025-12-28')
-- 3. Run the query and download as CSV

SELECT 
  o.advisor_name AS `Name`,
  o.advisor_title AS `Title`,
  o.advisor_location AS `Location`,
  o.advisor_linkedin_url AS `LinkedIn URL`,
  o.search_job_title AS `Search Type`,
  o.observed_at AS `Observed At`,
  o.advisor_id AS `Advisor ID`,  -- Correct UUID (from view matching)
  o.match_status AS `Match Status`  -- Shows how advisor_id was determined
FROM `savvy-gtm-analytics.savvy_pirate.v_observations_with_advisors` o
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON o.recruiter_id = r.id
WHERE r.name = 'RECRUITER_NAME_HERE'
  AND DATE(o.observed_at) = 'YYYY-MM-DD'
ORDER BY o.search_job_title, o.advisor_name;

