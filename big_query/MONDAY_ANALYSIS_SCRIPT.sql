-- ================================================================
-- SAVVY PIRATE - MONDAY WEEKLY ANALYSIS
-- ================================================================
-- Schedule: Every Monday at 06:00 AM ET (America/New_York)
-- This script performs the complete weekly analysis
-- ================================================================

-- Step 0: Declare variables
DECLARE analysis_id STRING;
DECLARE analysis_date DATE;
DECLARE active_frequency STRING;
DECLARE current_period_start DATE;
DECLARE current_period_end DATE;
DECLARE prev_period_start DATE;
DECLARE prev_period_end DATE;
DECLARE week_num INT64;

-- Initialize
SET analysis_date = CURRENT_DATE();
SET week_num = `savvy-gtm-analytics.savvy_pirate.get_week_of_month`(analysis_date);
SET active_frequency = `savvy-gtm-analytics.savvy_pirate.get_active_frequency`(analysis_date);
SET analysis_id = GENERATE_UUID();

-- Calculate date ranges (2-week windows)
SET current_period_end = DATE_SUB(analysis_date, INTERVAL 1 DAY);
SET current_period_start = DATE_SUB(current_period_end, INTERVAL 13 DAY);
SET prev_period_end = DATE_SUB(current_period_start, INTERVAL 1 DAY);
SET prev_period_start = DATE_SUB(prev_period_end, INTERVAL 13 DAY);

-- ================================================================
-- STEP 1: Log the analysis run
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
(id, analysis_date, frequency_group, current_period_start, current_period_end, 
 previous_period_start, previous_period_end, status, created_at)
VALUES
(analysis_id, analysis_date, active_frequency, current_period_start, current_period_end,
 prev_period_start, prev_period_end, 'running', CURRENT_TIMESTAMP());


-- ================================================================
-- STEP 2: Find NEW advisors
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.new_advisor_reports`
(id, analysis_id, analysis_date, advisor_id, advisor_name, linkedin_url, 
 title, location, accreditations, recruiter_id, recruiter_name, 
 search_type, first_seen_date, created_at)

WITH current_period_advisors AS (
  SELECT DISTINCT
    c.advisor_id,
    c.recruiter_id,
    c.search_type,
    c.first_seen_date
  FROM `savvy-gtm-analytics.savvy_pirate.connections` c
  JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE r.frequency = active_frequency
    AND r.is_active = TRUE
    AND c.first_seen_date BETWEEN current_period_start AND current_period_end
),
previous_period_advisors AS (
  SELECT DISTINCT c.advisor_id
  FROM `savvy-gtm-analytics.savvy_pirate.connections` c
  JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE r.frequency = active_frequency
    AND r.is_active = TRUE
    AND c.first_seen_date BETWEEN prev_period_start AND prev_period_end
),
new_advisors AS (
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
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a ON na.advisor_id = a.id
JOIN `savvy-gtm-analytics.savvy_pirate.recruiters` r ON na.recruiter_id = r.id;


-- ================================================================
-- STEP 3: Find ADVISORS ON THE MOVE
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
(id, analysis_date, advisor_id, advisor_name, linkedin_url, title, location,
 accreditations, recruiter_count, severity, recruiter_names, timeline_json,
 first_appearance, latest_appearance, days_between_first_last, why_flagged, created_at)

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
  days_spread AS days_between_first_last,
  CONCAT(
    advisor_name, ' has appeared in ', CAST(recruiter_count AS STRING),
    ' different recruiter', IF(recruiter_count = 1, '', 's'), ' network', IF(recruiter_count = 1, '', 's'), ': ',
    ARRAY_TO_STRING(recruiter_names, ' → '),
    '. First seen: ', CAST(first_appearance AS STRING),
    ', Latest: ', CAST(latest_appearance AS STRING),
    ' (', CAST(days_spread AS STRING), ' days span). ',
    'This indicates active job searching behavior.'
  ) AS why_flagged,
  CURRENT_TIMESTAMP() AS created_at
FROM `savvy-gtm-analytics.savvy_pirate.v_advisors_on_move`
WHERE advisor_id NOT IN (
  SELECT advisor_id 
  FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
  WHERE analysis_date = analysis_date
);


-- ================================================================
-- STEP 4: CRM Matching
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.crm_match_results`
(id, analysis_date, advisor_id, advisor_name, advisor_linkedin_url,
 match_type, match_confidence, lead_id, lead_name, lead_status, 
 lead_owner_name, lead_disposition, lead_closed_lost_reason, lead_last_activity_date,
 opportunity_id, opportunity_name, opportunity_stage, opportunity_owner_name,
 opportunity_closed_lost_reason, opportunity_amount, opportunity_close_date,
 found_via, recruiter_names, first_seen_date, alert_priority, suggested_action, created_at)

WITH todays_advisors AS (
  -- Advisors from today's new advisor reports
  SELECT DISTINCT 
    advisor_id, 
    'new_advisor' AS source,
    ARRAY_AGG(recruiter_name) AS recruiter_names,
    MIN(first_seen_date) AS first_seen_date
  FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports`
  WHERE analysis_date = analysis_date
  GROUP BY advisor_id
  
  UNION ALL
  
  -- Advisors from today's movement alerts
  SELECT DISTINCT
    advisor_id,
    'on_the_move' AS source,
    recruiter_names,
    first_appearance AS first_seen_date
  FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
  WHERE analysis_date = analysis_date
),
combined_advisors AS (
  SELECT 
    advisor_id,
    ARRAY_TO_STRING(ARRAY_AGG(DISTINCT source), ', ') AS found_via,
    ANY_VALUE(recruiter_names) AS recruiter_names,
    MIN(first_seen_date) AS first_seen_date
  FROM todays_advisors
  GROUP BY advisor_id
),
matched AS (
  SELECT 
    ca.advisor_id,
    ca.found_via AS found_via_from_ca,
    ca.recruiter_names AS recruiter_names_from_ca,
    ca.first_seen_date AS first_seen_date_from_ca,
    m.advisor_name,
    m.advisor_linkedin_url,
    m.match_type,
    m.match_confidence,
    m.lead_id,
    m.lead_name,
    m.lead_status,
    m.lead_owner_name,
    m.disposition,
    m.lead_closed_lost_reason,
    m.last_activity_date,
    m.opportunity_id,
    m.opportunity_name,
    m.opportunity_stage,
    m.opportunity_owner_name,
    m.opp_closed_lost_reason,
    m.amount,
    m.close_date,
    m.alert_priority
  FROM combined_advisors ca
  JOIN `savvy-gtm-analytics.savvy_pirate.v_crm_matches` m 
    ON ca.advisor_id = m.advisor_id
)
SELECT
  GENERATE_UUID() AS id,
  analysis_date,
  m.advisor_id,
  m.advisor_name,
  m.advisor_linkedin_url,
  m.match_type,
  m.match_confidence,
  m.lead_id,
  m.lead_name,
  m.lead_status,
  m.lead_owner_name,
  m.disposition AS lead_disposition,
  m.lead_closed_lost_reason,
  m.last_activity_date AS lead_last_activity_date,
  m.opportunity_id,
  m.opportunity_name,
  m.opportunity_stage,
  m.opportunity_owner_name,
  m.opp_closed_lost_reason AS opportunity_closed_lost_reason,
  m.amount AS opportunity_amount,
  m.close_date AS opportunity_close_date,
  m.found_via_from_ca AS found_via,
  m.recruiter_names_from_ca AS recruiter_names,
  m.first_seen_date_from_ca AS first_seen_date,
  m.alert_priority,
  CASE
    WHEN m.match_type = 'lead' AND m.lead_status IN ('Closed - Lost', 'Disqualified') 
      THEN CONCAT('RE-ENGAGE: ', m.advisor_name, ' was previously closed (', m.lead_status, ') but is now actively looking')
    WHEN m.match_type = 'opportunity' AND m.opportunity_stage LIKE '%Closed%Lost%'
      THEN CONCAT('RE-ENGAGE: ', m.advisor_name, ' opportunity was lost but they are back on the market')
    WHEN m.match_type = 'lead' 
      THEN CONCAT('EXISTING LEAD: ', m.advisor_name, ' is in your pipeline (', m.lead_status, ') - now showing activity with recruiters')
    WHEN m.match_type = 'opportunity'
      THEN CONCAT('EXISTING OPP: ', m.advisor_name, ' has opportunity (', m.opportunity_stage, ') - now showing recruiter activity')
    ELSE 'Review for action'
  END AS suggested_action,
  CURRENT_TIMESTAMP() AS created_at
FROM matched m;


-- ================================================================
-- STEP 5: Detect Job Changes
-- ================================================================
INSERT INTO `savvy-gtm-analytics.savvy_pirate.advisor_job_changes`
(id, advisor_id, change_type, previous_title, new_title, previous_location, 
 new_location, detected_date, previous_seen_date, is_likely_job_change, created_at)

WITH advisor_history AS (
  SELECT 
    a.id AS advisor_id,
    a.current_title AS new_title,
    a.current_location AS new_location,
    LAG(a.current_title) OVER (PARTITION BY a.id ORDER BY a.updated_at) AS previous_title,
    LAG(a.current_location) OVER (PARTITION BY a.id ORDER BY a.updated_at) AS previous_location,
    LAG(a.last_seen_at) OVER (PARTITION BY a.id ORDER BY a.updated_at) AS previous_seen_at,
    a.updated_at
  FROM `savvy-gtm-analytics.savvy_pirate.advisors` a
  WHERE a.times_seen > 1  -- Must have been seen at least twice
),
changes AS (
  SELECT 
    *,
    CASE
      WHEN previous_title IS NOT NULL AND new_title != previous_title THEN TRUE
      ELSE FALSE
    END AS title_changed,
    -- Extract company from title (common pattern: "Title at Company")
    REGEXP_EXTRACT(new_title, r' at (.+)$') AS new_company,
    REGEXP_EXTRACT(previous_title, r' at (.+)$') AS previous_company
  FROM advisor_history
  WHERE previous_title IS NOT NULL
    AND new_title IS NOT NULL
    AND new_title != previous_title
    AND DATE(updated_at) = analysis_date
)
SELECT
  GENERATE_UUID() AS id,
  advisor_id,
  CASE
    WHEN new_company != previous_company AND new_company IS NOT NULL THEN 'both'
    WHEN new_title != previous_title THEN 'title_change'
    ELSE 'title_change'
  END AS change_type,
  previous_title,
  new_title,
  previous_location,
  new_location,
  analysis_date AS detected_date,
  DATE(previous_seen_at) AS previous_seen_date,
  CASE WHEN new_company != previous_company THEN TRUE ELSE FALSE END AS is_likely_job_change,
  CURRENT_TIMESTAMP() AS created_at
FROM changes;


-- ================================================================
-- STEP 6: Update analysis record with counts
-- ================================================================
UPDATE `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
SET 
  total_new_advisors = (
    SELECT COUNT(DISTINCT advisor_id) 
    FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports`
    WHERE analysis_id = analysis_id
  ),
  total_advisors_on_move = (
    SELECT COUNT(*) 
    FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
    WHERE analysis_date = analysis_date
  ),
  total_crm_matches = (
    SELECT COUNT(*) 
    FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results`
    WHERE analysis_date = analysis_date
  ),
  recruiters_analyzed = (
    SELECT COUNT(*) 
    FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
    WHERE frequency = active_frequency AND is_active = TRUE
  ),
  status = 'completed'
WHERE id = analysis_id;


-- ================================================================
-- STEP 7: Summary output
-- ================================================================
SELECT 
  CONCAT(
    '✅ SAVVY PIRATE WEEKLY ANALYSIS COMPLETE\n',
    '==========================================\n',
    'Analysis Date: ', CAST(analysis_date AS STRING), '\n',
    'Week of Month: ', CAST(week_num AS STRING), '\n',
    'Frequency Group: ', active_frequency, '\n',
    'Period Analyzed: ', CAST(current_period_start AS STRING), ' to ', CAST(current_period_end AS STRING), '\n',
    '==========================================\n',
    'NEW ADVISORS: ', CAST((SELECT COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` WHERE analysis_id = analysis_id) AS STRING), '\n',
    'ON THE MOVE: ', CAST((SELECT COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts` WHERE analysis_date = analysis_date) AS STRING), '\n',
    'CRM MATCHES: ', CAST((SELECT COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results` WHERE analysis_date = analysis_date) AS STRING), '\n',
    '==========================================\n',
    'Reports ready for CSV export!'
  ) AS analysis_summary;

