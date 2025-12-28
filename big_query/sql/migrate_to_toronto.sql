-- ================================================================
-- MIGRATION SCRIPT: Move savvy_pirate to Toronto Region
-- ================================================================
-- This script migrates the entire savvy_pirate dataset from US to
-- northamerica-northeast2 (Toronto) to enable cross-region views
-- with FINTRX data.
-- 
-- IMPORTANT: Run this in BigQuery Console (Toronto region)
-- ================================================================

-- ================================================================
-- STEP 1: Create New Dataset in Toronto
-- ================================================================

CREATE SCHEMA IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate_toronto`
OPTIONS(
  description = 'LinkedIn recruiter connection intelligence for Savvy Pirate (Toronto)',
  location = 'northamerica-northeast2'
);

-- ================================================================
-- STEP 2: Copy All Tables (with data)
-- ================================================================

-- Copy recruiters
CREATE TABLE `savvy-gtm-analytics.savvy_pirate_toronto.recruiters` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.recruiters`;

-- Copy searches
CREATE TABLE `savvy-gtm-analytics.savvy_pirate_toronto.searches` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.searches`;

-- Copy advisors
CREATE TABLE `savvy-gtm-analytics.savvy_pirate_toronto.advisors` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.advisors`;

-- Copy connections
CREATE TABLE `savvy-gtm-analytics.savvy_pirate_toronto.connections` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.connections`;

-- Copy scrape_runs (may be empty)
CREATE TABLE `savvy-gtm-analytics.savvy_pirate_toronto.scrape_runs` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.scrape_runs`;

-- Copy connection_observations (may be empty)
CREATE TABLE `savvy-gtm-analytics.savvy_pirate_toronto.connection_observations` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.connection_observations`;

-- Copy other tables if they exist
CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate_toronto.weekly_analyses` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses` WHERE FALSE;

CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate_toronto.new_advisor_reports` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` WHERE FALSE;

CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate_toronto.advisor_movement_alerts` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts` WHERE FALSE;

CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate_toronto.crm_match_results` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results` WHERE FALSE;

CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.savvy_pirate_toronto.advisor_job_changes` AS
SELECT * FROM `savvy-gtm-analytics.savvy_pirate.advisor_job_changes` WHERE FALSE;

-- ================================================================
-- STEP 3: Recreate All Functions
-- ================================================================

-- get_week_of_month
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate_toronto.get_week_of_month`(date_val DATE)
RETURNS INT64
AS (CAST(CEIL(EXTRACT(DAY FROM date_val) / 7.0) AS INT64));

-- get_active_frequency
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate_toronto.get_active_frequency`(recruiter_frequency STRING, week_of_month INT64)
RETURNS BOOL
AS (
  CASE 
    WHEN recruiter_frequency = '1st_3rd_week' AND week_of_month IN (1, 3) THEN TRUE
    WHEN recruiter_frequency = '2nd_4th_week' AND week_of_month IN (2, 4) THEN TRUE
    ELSE FALSE
  END
);

-- normalize_linkedin_url
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate_toronto.normalize_linkedin_url`(url STRING)
RETURNS STRING
AS (
  LOWER(REGEXP_REPLACE(url, r'^https?://(www\.)?linkedin\.com/in/([^/?#]+).*', r'https://www.linkedin.com/in/\2'))
);

-- normalize_name
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate_toronto.normalize_name`(name STRING)
RETURNS STRING
AS (
  UPPER(TRIM(REGEXP_REPLACE(name, r'\s+', ' ')))
);

-- extract_linkedin_slug
CREATE OR REPLACE FUNCTION `savvy-gtm-analytics.savvy_pirate_toronto.extract_linkedin_slug`(url STRING)
RETURNS STRING
AS (
  LOWER(TRIM(REGEXP_EXTRACT(url, r'linkedin\.com/in/([^/?#]+)')))
);

-- ================================================================
-- STEP 4: Recreate All Views (Now with FINTRX support!)
-- ================================================================

-- Note: Views need to be recreated from the implementation guide
-- The key benefit: v_advisors_with_crd can now be created!

-- ================================================================
-- STEP 5: Verify Migration
-- ================================================================

SELECT 
  'recruiters' as table_name, COUNT(*) as count FROM `savvy-gtm-analytics.savvy_pirate_toronto.recruiters`
  UNION ALL SELECT 'searches', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate_toronto.searches`
  UNION ALL SELECT 'advisors', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate_toronto.advisors`
  UNION ALL SELECT 'connections', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate_toronto.connections`
ORDER BY table_name;

