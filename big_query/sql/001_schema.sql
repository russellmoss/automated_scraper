-- ================================================================
-- SAVVY PIRATE ANALYTICS - BIGQUERY SCHEMA
-- ================================================================
-- Run this in BigQuery console to create the dataset and tables
-- Replace YOUR_PROJECT_ID with your actual GCP project ID
-- ================================================================

-- Create dataset
CREATE SCHEMA IF NOT EXISTS `YOUR_PROJECT_ID.savvy_pirate`
OPTIONS(
  description = 'LinkedIn recruiter connection intelligence',
  location = 'US'
);

-- ================================================================
-- TABLE: recruiters
-- The people whose LinkedIn connections you monitor
-- ================================================================
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.savvy_pirate.recruiters` (
  id STRING NOT NULL,  -- UUID
  name STRING NOT NULL,
  linkedin_url STRING,
  company STRING,
  title STRING,
  
  -- Group: "1st_3rd_week" or "2nd_4th_week"
  frequency STRING NOT NULL,
  
  -- Output Google Sheet
  output_sheet_url STRING,
  output_sheet_id STRING,
  
  is_active BOOL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ================================================================
-- TABLE: advisors
-- The financial advisors being tracked
-- ================================================================
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.savvy_pirate.advisors` (
  id STRING NOT NULL,  -- UUID
  linkedin_url STRING NOT NULL,
  linkedin_id STRING,  -- Extracted from URL
  name STRING NOT NULL,
  current_title STRING,
  current_location STRING,
  accreditations ARRAY<STRING>,
  
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  times_seen INT64 DEFAULT 1,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ================================================================
-- TABLE: connections
-- When an advisor was seen in a recruiter's network
-- ================================================================
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.savvy_pirate.connections` (
  id STRING NOT NULL,
  advisor_id STRING NOT NULL,
  recruiter_id STRING NOT NULL,
  
  first_seen_date DATE NOT NULL,
  last_seen_date DATE NOT NULL,
  
  search_type STRING,  -- "Financial Advisor", "Wealth Manager", etc.
  scrape_run_id STRING,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ================================================================
-- TABLE: scrape_runs
-- Track each scraping execution
-- ================================================================
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.savvy_pirate.scrape_runs` (
  id STRING NOT NULL,
  recruiter_id STRING,
  recruiter_name STRING,
  
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  status STRING DEFAULT 'running',  -- running, completed, failed
  
  profiles_scraped INT64 DEFAULT 0,
  new_connections_found INT64 DEFAULT 0,
  searches_completed INT64 DEFAULT 0,
  total_searches INT64 DEFAULT 0,
  
  error_message STRING,
  
  -- Week tracking
  scrape_week DATE,  -- Monday of the week
  week_of_month INT64,  -- 1, 2, 3, 4, or 5
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ================================================================
-- TABLE: weekly_analyses
-- Results of Monday morning analysis runs
-- ================================================================
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.savvy_pirate.weekly_analyses` (
  id STRING NOT NULL,
  
  analysis_date DATE NOT NULL,  -- The Monday this ran
  frequency_group STRING NOT NULL,  -- "1st_3rd_week" or "2nd_4th_week"
  
  -- Date range analyzed
  current_period_start DATE,
  current_period_end DATE,
  previous_period_start DATE,
  previous_period_end DATE,
  
  -- Counts
  total_new_advisors INT64 DEFAULT 0,
  total_advisors_on_move INT64 DEFAULT 0,
  recruiters_analyzed INT64 DEFAULT 0,
  
  status STRING DEFAULT 'completed',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ================================================================
-- TABLE: new_advisor_reports
-- Each new advisor found in weekly analysis
-- ================================================================
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.savvy_pirate.new_advisor_reports` (
  id STRING NOT NULL,
  analysis_id STRING NOT NULL,
  analysis_date DATE NOT NULL,
  
  -- Advisor info
  advisor_id STRING,
  advisor_name STRING,
  linkedin_url STRING,
  title STRING,
  location STRING,
  accreditations ARRAY<STRING>,
  
  -- Discovery info
  recruiter_id STRING,
  recruiter_name STRING,
  search_type STRING,
  first_seen_date DATE,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ================================================================
-- TABLE: advisor_movement_alerts
-- Advisors detected in multiple recruiter networks
-- ================================================================
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.savvy_pirate.advisor_movement_alerts` (
  id STRING NOT NULL,
  analysis_date DATE NOT NULL,
  
  -- Advisor info
  advisor_id STRING NOT NULL,
  advisor_name STRING,
  linkedin_url STRING,
  title STRING,
  location STRING,
  accreditations ARRAY<STRING>,
  
  -- Movement info
  recruiter_count INT64 NOT NULL,
  severity STRING,  -- normal, high, critical
  recruiter_names ARRAY<STRING>,
  
  -- Timeline as JSON string (BigQuery doesn't have native JSONB like Postgres)
  timeline_json STRING,
  
  first_appearance DATE,
  latest_appearance DATE,
  
  -- Explanation for sales team
  why_flagged STRING,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- ================================================================
-- INDEXES (BigQuery uses clustering instead of indexes)
-- ================================================================

-- For the connections table, cluster by advisor and date
-- Run this ALTER if you want better query performance:
-- ALTER TABLE `YOUR_PROJECT_ID.savvy_pirate.connections`
-- SET OPTIONS (
--   clustering_columns = ['advisor_id', 'first_seen_date']
-- );


-- ================================================================
-- VIEW: Advisors currently on the move
-- ================================================================
CREATE OR REPLACE VIEW `YOUR_PROJECT_ID.savvy_pirate.v_advisors_on_move` AS
WITH recruiter_appearances AS (
  SELECT 
    a.id AS advisor_id,
    a.name AS advisor_name,
    a.linkedin_url,
    a.current_title,
    a.current_location,
    a.accreditations,
    c.recruiter_id,
    r.name AS recruiter_name,
    r.frequency AS recruiter_frequency,
    c.first_seen_date,
    c.search_type
  FROM `YOUR_PROJECT_ID.savvy_pirate.advisors` a
  JOIN `YOUR_PROJECT_ID.savvy_pirate.connections` c ON a.id = c.advisor_id
  JOIN `YOUR_PROJECT_ID.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
  WHERE r.is_active = TRUE
),
multi_recruiter AS (
  SELECT 
    advisor_id,
    COUNT(DISTINCT recruiter_id) AS recruiter_count,
    MIN(first_seen_date) AS first_appearance,
    MAX(first_seen_date) AS latest_appearance
  FROM recruiter_appearances
  GROUP BY advisor_id
  HAVING COUNT(DISTINCT recruiter_id) >= 2
)
SELECT 
  ra.advisor_id,
  ANY_VALUE(ra.advisor_name) AS advisor_name,
  ANY_VALUE(ra.linkedin_url) AS linkedin_url,
  ANY_VALUE(ra.current_title) AS current_title,
  ANY_VALUE(ra.current_location) AS current_location,
  ANY_VALUE(ra.accreditations) AS accreditations,
  mr.recruiter_count,
  mr.first_appearance,
  mr.latest_appearance,
  CASE 
    WHEN mr.recruiter_count >= 4 THEN 'critical'
    WHEN mr.recruiter_count >= 3 THEN 'high'
    ELSE 'normal'
  END AS severity,
  ARRAY_AGG(DISTINCT ra.recruiter_name ORDER BY ra.recruiter_name) AS recruiter_names,
  ARRAY_AGG(
    STRUCT(
      ra.recruiter_name,
      ra.first_seen_date,
      ra.search_type
    ) ORDER BY ra.first_seen_date
  ) AS recruiter_timeline
FROM recruiter_appearances ra
JOIN multi_recruiter mr ON ra.advisor_id = mr.advisor_id
GROUP BY ra.advisor_id, mr.recruiter_count, mr.first_appearance, mr.latest_appearance
ORDER BY mr.recruiter_count DESC;


-- ================================================================
-- VIEW: New connections in the last 14 days
-- ================================================================
CREATE OR REPLACE VIEW `YOUR_PROJECT_ID.savvy_pirate.v_recent_new_connections` AS
SELECT 
  a.id AS advisor_id,
  a.name AS advisor_name,
  a.linkedin_url,
  a.current_title,
  a.current_location,
  a.accreditations,
  r.id AS recruiter_id,
  r.name AS recruiter_name,
  r.frequency AS recruiter_frequency,
  c.first_seen_date,
  c.search_type,
  c.created_at AS connection_created_at
FROM `YOUR_PROJECT_ID.savvy_pirate.connections` c
JOIN `YOUR_PROJECT_ID.savvy_pirate.advisors` a ON c.advisor_id = a.id
JOIN `YOUR_PROJECT_ID.savvy_pirate.recruiters` r ON c.recruiter_id = r.id
WHERE c.first_seen_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 14 DAY)
ORDER BY c.first_seen_date DESC, r.name, a.name;


-- ================================================================
-- HELPER FUNCTION: Determine which frequency group is active
-- Returns "1st_3rd_week" or "2nd_4th_week" based on date
-- ================================================================
CREATE OR REPLACE FUNCTION `YOUR_PROJECT_ID.savvy_pirate.get_active_frequency`(check_date DATE)
RETURNS STRING
AS (
  CASE 
    WHEN EXTRACT(DAY FROM check_date) <= 7 THEN '1st_3rd_week'  -- Week 1
    WHEN EXTRACT(DAY FROM check_date) <= 14 THEN '2nd_4th_week'  -- Week 2
    WHEN EXTRACT(DAY FROM check_date) <= 21 THEN '1st_3rd_week'  -- Week 3
    WHEN EXTRACT(DAY FROM check_date) <= 28 THEN '2nd_4th_week'  -- Week 4
    ELSE '1st_3rd_week'  -- Week 5 (rare) - treat as week 1
  END
);


-- ================================================================
-- HELPER FUNCTION: Get week of month (1-5)
-- ================================================================
CREATE OR REPLACE FUNCTION `YOUR_PROJECT_ID.savvy_pirate.get_week_of_month`(check_date DATE)
RETURNS INT64
AS (
  CAST(CEIL(EXTRACT(DAY FROM check_date) / 7.0) AS INT64)
);
