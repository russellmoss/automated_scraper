-- ================================================================
-- CLEAR TEST DATA FROM SAVVY PIRATE DATASET
-- ================================================================
-- This script removes all test/scraped data while preserving:
-- ✅ Schema (tables, views, functions)
-- ✅ Seed data (recruiters, searches)
-- 
-- ⚠️ WARNING: This will delete ALL scraped data!
-- Only run this when you're ready to start fresh with real scrapes.
-- ================================================================

-- Clear test data from all data tables
-- (Preserving recruiters and searches which are seed/configuration data)

DELETE FROM `savvy-gtm-analytics.savvy_pirate.advisors` WHERE TRUE;
-- Expected: Clears all 691 test advisors

DELETE FROM `savvy-gtm-analytics.savvy_pirate.connections` WHERE TRUE;
-- Expected: Clears all 672 test connections

DELETE FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` WHERE TRUE;
-- Expected: Clears all 1,199 test observations
-- Note: This is a streaming table, so deletion may take a moment

DELETE FROM `savvy-gtm-analytics.savvy_pirate.scrape_runs` WHERE TRUE;
-- Expected: Clears any test scrape runs

DELETE FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses` WHERE TRUE;
-- Expected: Clears 1 test analysis

DELETE FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports` WHERE TRUE;
-- Expected: Clears any test reports

DELETE FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts` WHERE TRUE;
-- Expected: Clears 6 test movement alerts

DELETE FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results` WHERE TRUE;
-- Expected: Clears 3 test CRM matches

DELETE FROM `savvy-gtm-analytics.savvy_pirate.advisor_job_changes` WHERE TRUE;
-- Expected: Clears any test job changes

-- ================================================================
-- VERIFICATION QUERY
-- Run this after clearing to confirm data is gone
-- ================================================================
/*
SELECT 
  'recruiters' as table_name, COUNT(*) as row_count FROM `savvy-gtm-analytics.savvy_pirate.recruiters`
UNION ALL
SELECT 'searches', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.searches`
UNION ALL
SELECT 'advisors', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.advisors`
UNION ALL
SELECT 'connections', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.connections`
UNION ALL
SELECT 'connection_observations', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.connection_observations`
UNION ALL
SELECT 'scrape_runs', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.scrape_runs`
UNION ALL
SELECT 'weekly_analyses', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.weekly_analyses`
UNION ALL
SELECT 'new_advisor_reports', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.new_advisor_reports`
UNION ALL
SELECT 'advisor_movement_alerts', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.advisor_movement_alerts`
UNION ALL
SELECT 'crm_match_results', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.crm_match_results`
UNION ALL
SELECT 'advisor_job_changes', COUNT(*) FROM `savvy-gtm-analytics.savvy_pirate.advisor_job_changes`
ORDER BY table_name;

-- Expected results after clearing:
-- recruiters: 29 (PRESERVED - seed data)
-- searches: 261 (PRESERVED - seed data)
-- All others: 0 (CLEARED)
*/

