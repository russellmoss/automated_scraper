-- ================================================================
-- SAVVY PIRATE - MONDAY WEEKLY ANALYSIS
-- ================================================================
-- This is a BigQuery Scheduled Query
-- Schedule it to run every Monday at 6:00 AM ET
-- 
-- To create the schedule:
-- 1. Go to BigQuery Console
-- 2. Click "Scheduled queries" in the left menu
-- 3. Click "Create scheduled query"
-- 4. Paste this query
-- 5. Set schedule: Every Monday at 06:00 (Eastern)
-- 6. Set destination table (optional) or run as script
-- ================================================================

DECLARE analysis_id STRING;
DECLARE analysis_date DATE;
DECLARE active_frequency STRING;
DECLARE current_period_start DATE;
DECLARE current_period_end DATE;
DECLARE prev_period_start DATE;
DECLARE prev_period_end DATE;
DECLARE week_num INT64;

-- Determine today's context
SET analysis_date = CURRENT_DATE();
SET week_num = `YOUR_PROJECT_ID.savvy_pirate.get_week_of_month`(analysis_date);
SET active_frequency = `YOUR_PROJECT_ID.savvy_pirate.get_active_frequency`(analysis_date);

-- Calculate date ranges
-- Current period: last 2 weeks ending yesterday
-- Previous period: 2 weeks before that
SET current_period_end = DATE_SUB(analysis_date, INTERVAL 1 DAY);
SET current_period_start = DATE_SUB(current_period_end, INTERVAL 13 DAY);
SET prev_period_end = DATE_SUB(current_period_start, INTERVAL 1 DAY);
SET prev_period_start = DATE_SUB(prev_period_end, INTERVAL 13 DAY);

-- Generate unique ID for this analysis
SET analysis_id = GENERATE_UUID();

-- Log the analysis run
INSERT INTO `YOUR_PROJECT_ID.savvy_pirate.weekly_analyses`
(id, analysis_date, frequency_group, current_period_start, current_period_end, 
 previous_period_start, previous_period_end, status, created_at)
VALUES
(analysis_id, analysis_date, active_frequency, current_period_start, current_period_end,
 prev_period_start, prev_period_end, 'running', CURRENT_TIMESTAMP());


-- ================================================================
-- STEP 1: Find NEW advisors for this frequency group
-- Advisors seen in current period but NOT in previous period
-- ================================================================

INSERT INTO `YOUR_PROJECT_ID.savvy_pirate.new_advisor_reports`
(id, analysis_id, analysis_date, advisor_id, advisor_name, linkedin_url, 
 title, location, accreditations, recruiter_id, recruiter_name, 
 search_type, first_seen_date, created_at)

WITH current_period_advisors AS (
  -- Advisors seen in current 2-week period for active frequency recruiters
  SELECT DISTINCT
    c.advisor_id,
    c.recruiter_id,
    c.search_type,
    c.first_seen_date
  FROM `YOUR_PROJECT_ID.savvy_pirate.connections` c
  JOIN `YOUR_PROJECT_ID.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE r.frequency = active_frequency
    AND r.is_active = TRUE
    AND c.first_seen_date BETWEEN current_period_start AND current_period_end
),
previous_period_advisors AS (
  -- Advisors seen in previous 2-week period for active frequency recruiters
  SELECT DISTINCT c.advisor_id
  FROM `YOUR_PROJECT_ID.savvy_pirate.connections` c
  JOIN `YOUR_PROJECT_ID.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE r.frequency = active_frequency
    AND r.is_active = TRUE
    AND c.first_seen_date BETWEEN prev_period_start AND prev_period_end
),
new_advisors AS (
  -- Advisors in current but NOT in previous
  SELECT *
  FROM current_period_advisors
  WHERE advisor_id NOT IN (SELECT advisor_id FROM previous_period_advisors)
)
SELECT
  GENERATE_UUID() AS id,
  analysis_id,
  analysis_date,
  a.id AS advisor_id,
  a.name AS advisor_name,
  a.linkedin_url,
  a.current_title AS title,
  a.current_location AS location,
  a.accreditations,
  r.id AS recruiter_id,
  r.name AS recruiter_name,
  na.search_type,
  na.first_seen_date,
  CURRENT_TIMESTAMP() AS created_at
FROM new_advisors na
JOIN `YOUR_PROJECT_ID.savvy_pirate.advisors` a ON na.advisor_id = a.id
JOIN `YOUR_PROJECT_ID.savvy_pirate.recruiters` r ON na.recruiter_id = r.id;


-- ================================================================
-- STEP 2: Find ADVISORS ON THE MOVE
-- Advisors appearing in 2+ recruiter networks (any frequency)
-- ================================================================

INSERT INTO `YOUR_PROJECT_ID.savvy_pirate.advisor_movement_alerts`
(id, analysis_date, advisor_id, advisor_name, linkedin_url, title, location,
 accreditations, recruiter_count, severity, recruiter_names, timeline_json,
 first_appearance, latest_appearance, why_flagged, created_at)

WITH on_move AS (
  SELECT * FROM `YOUR_PROJECT_ID.savvy_pirate.v_advisors_on_move`
)
SELECT
  GENERATE_UUID() AS id,
  analysis_date,
  advisor_id,
  advisor_name,
  linkedin_url,
  current_title AS title,
  current_location AS location,
  accreditations,
  recruiter_count,
  severity,
  recruiter_names,
  TO_JSON_STRING(recruiter_timeline) AS timeline_json,
  first_appearance,
  latest_appearance,
  CONCAT(
    advisor_name, ' has appeared in ', CAST(recruiter_count AS STRING),
    ' different recruiters'' networks: ',
    ARRAY_TO_STRING(recruiter_names, ' → '),
    '. Timeline: ',
    ARRAY_TO_STRING(
      ARRAY(
        SELECT CONCAT(t.recruiter_name, ' (', CAST(t.first_seen_date AS STRING), ')')
        FROM UNNEST(recruiter_timeline) t
        ORDER BY t.first_seen_date
      ),
      ' → '
    ),
    '. This indicates active job searching behavior.'
  ) AS why_flagged,
  CURRENT_TIMESTAMP() AS created_at
FROM on_move
-- Only include if not already alerted today
WHERE advisor_id NOT IN (
  SELECT advisor_id 
  FROM `YOUR_PROJECT_ID.savvy_pirate.advisor_movement_alerts`
  WHERE analysis_date = analysis_date
);


-- ================================================================
-- STEP 3: Update analysis record with counts
-- ================================================================

UPDATE `YOUR_PROJECT_ID.savvy_pirate.weekly_analyses`
SET 
  total_new_advisors = (
    SELECT COUNT(DISTINCT advisor_id) 
    FROM `YOUR_PROJECT_ID.savvy_pirate.new_advisor_reports`
    WHERE analysis_id = analysis_id
  ),
  total_advisors_on_move = (
    SELECT COUNT(*) 
    FROM `YOUR_PROJECT_ID.savvy_pirate.advisor_movement_alerts`
    WHERE analysis_date = analysis_date
  ),
  recruiters_analyzed = (
    SELECT COUNT(*) 
    FROM `YOUR_PROJECT_ID.savvy_pirate.recruiters`
    WHERE frequency = active_frequency AND is_active = TRUE
  ),
  status = 'completed'
WHERE id = analysis_id;


-- ================================================================
-- STEP 4: Log completion
-- ================================================================

SELECT 
  CONCAT(
    '✅ Weekly Analysis Complete for ', analysis_date, '\n',
    'Frequency Group: ', active_frequency, '\n',
    'Period Analyzed: ', CAST(current_period_start AS STRING), ' to ', CAST(current_period_end AS STRING), '\n',
    'New Advisors Found: ', CAST((
      SELECT COUNT(DISTINCT advisor_id) 
      FROM `YOUR_PROJECT_ID.savvy_pirate.new_advisor_reports`
      WHERE analysis_id = analysis_id
    ) AS STRING), '\n',
    'Advisors on the Move: ', CAST((
      SELECT COUNT(*) 
      FROM `YOUR_PROJECT_ID.savvy_pirate.advisor_movement_alerts`
      WHERE analysis_date = analysis_date
    ) AS STRING)
  ) AS analysis_summary;
