-- ================================================================
-- SAVVY PIRATE - CSV EXPORT QUERIES
-- ================================================================
-- Run these queries on Monday after the scheduled analysis runs
-- Export results to CSV for your sales team
-- 
-- In BigQuery Console:
-- 1. Run the query
-- 2. Click "Save Results" → "CSV (local file)"
-- ================================================================


-- ================================================================
-- EXPORT 1: NEW ADVISORS THIS WEEK
-- ================================================================
-- Use this query to download the New Advisors CSV

SELECT
  advisor_name AS `Advisor Name`,
  title AS `Title`,
  location AS `Location`,
  linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(accreditations, '; ') AS `Accreditations`,
  recruiter_name AS `Found By Recruiter`,
  search_type AS `Search Type`,
  CAST(first_seen_date AS STRING) AS `First Seen Date`
FROM `YOUR_PROJECT_ID.savvy_pirate.new_advisor_reports`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `YOUR_PROJECT_ID.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY recruiter_name, advisor_name;


-- ================================================================
-- EXPORT 2: ADVISORS ON THE MOVE
-- ================================================================
-- Use this query to download the Advisors on the Move CSV

SELECT
  advisor_name AS `Advisor Name`,
  title AS `Title`,
  location AS `Location`,
  linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(accreditations, '; ') AS `Accreditations`,
  recruiter_count AS `Number of Recruiters`,
  severity AS `Severity`,
  ARRAY_TO_STRING(recruiter_names, ', ') AS `Recruiter Names`,
  CAST(first_appearance AS STRING) AS `First Appearance`,
  CAST(latest_appearance AS STRING) AS `Latest Appearance`,
  why_flagged AS `Why Flagged`
FROM `YOUR_PROJECT_ID.savvy_pirate.advisor_movement_alerts`
WHERE analysis_date = (
  SELECT MAX(analysis_date) 
  FROM `YOUR_PROJECT_ID.savvy_pirate.weekly_analyses`
  WHERE status = 'completed'
)
ORDER BY recruiter_count DESC, advisor_name;


-- ================================================================
-- EXPORT 3: NEW ADVISORS FOR SPECIFIC DATE
-- ================================================================
-- Replace '2025-01-27' with the Monday date you want

SELECT
  advisor_name AS `Advisor Name`,
  title AS `Title`,
  location AS `Location`,
  linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(accreditations, '; ') AS `Accreditations`,
  recruiter_name AS `Found By Recruiter`,
  search_type AS `Search Type`,
  CAST(first_seen_date AS STRING) AS `First Seen Date`
FROM `YOUR_PROJECT_ID.savvy_pirate.new_advisor_reports`
WHERE analysis_date = DATE('2025-01-27')  -- Change this date
ORDER BY recruiter_name, advisor_name;


-- ================================================================
-- EXPORT 4: ALL CONNECTIONS (Full Export)
-- ================================================================
-- Use this for a complete data dump

SELECT
  a.name AS `Advisor Name`,
  a.current_title AS `Title`,
  a.current_location AS `Location`,
  a.linkedin_url AS `LinkedIn URL`,
  ARRAY_TO_STRING(a.accreditations, '; ') AS `Accreditations`,
  r.name AS `Recruiter Name`,
  r.frequency AS `Recruiter Group`,
  c.search_type AS `Search Type`,
  CAST(c.first_seen_date AS STRING) AS `First Seen`,
  CAST(c.last_seen_date AS STRING) AS `Last Seen`
FROM `YOUR_PROJECT_ID.savvy_pirate.connections` c
JOIN `YOUR_PROJECT_ID.savvy_pirate.advisors` a ON c.advisor_id = a.id
JOIN `YOUR_PROJECT_ID.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
ORDER BY c.first_seen_date DESC, r.name, a.name;


-- ================================================================
-- WEEKLY SUMMARY QUERY
-- ================================================================
-- Quick check on analysis status

SELECT
  analysis_date,
  frequency_group,
  total_new_advisors,
  total_advisors_on_move,
  recruiters_analyzed,
  status,
  created_at
FROM `YOUR_PROJECT_ID.savvy_pirate.weekly_analyses`
ORDER BY analysis_date DESC
LIMIT 10;
