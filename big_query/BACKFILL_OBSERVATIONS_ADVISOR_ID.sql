-- ============================================================
-- BACKFILL SCRIPT: Fix advisor_id in connection_observations
-- ============================================================
-- This script matches observations to advisors using linkedin_id (slug)
-- Run this to fix existing observations that have hash IDs or NULL advisor_id
-- ============================================================

-- Step 1: Check how many observations need fixing
SELECT 
  COUNT(*) as total_observations,
  SUM(CASE WHEN advisor_id LIKE 'adv_%' THEN 1 ELSE 0 END) as hash_ids_to_fix,
  SUM(CASE WHEN advisor_id IS NULL AND advisor_linkedin_url IS NOT NULL THEN 1 ELSE 0 END) as null_ids_to_fix,
  SUM(CASE WHEN advisor_id IS NOT NULL AND advisor_id NOT LIKE 'adv_%' THEN 1 ELSE 0 END) as already_correct
FROM `savvy-gtm-analytics.savvy_pirate.connection_observations`;

-- Step 2: Preview what will be updated (run this first to verify)
SELECT 
  o.id as observation_id,
  o.advisor_id as current_advisor_id,
  o.advisor_name,
  o.advisor_linkedin_url,
  `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`(o.advisor_linkedin_url) as obs_slug,
  a.linkedin_id as advisor_linkedin_id,
  a.id as new_advisor_id,
  a.name as advisor_name_in_table
FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a 
  ON `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`(o.advisor_linkedin_url) = a.linkedin_id
WHERE (o.advisor_id LIKE 'adv_%' OR o.advisor_id IS NULL)
  AND o.advisor_linkedin_url IS NOT NULL
LIMIT 100;

-- Step 3: Create a temporary table with the matches
CREATE OR REPLACE TABLE `savvy-gtm-analytics.savvy_pirate._temp_observation_fixes` AS
SELECT 
  o.id as observation_id,
  a.id as correct_advisor_id
FROM `savvy-gtm-analytics.savvy_pirate.connection_observations` o
JOIN `savvy-gtm-analytics.savvy_pirate.advisors` a 
  ON `savvy-gtm-analytics.savvy_pirate.extract_linkedin_slug`(o.advisor_linkedin_url) = a.linkedin_id
WHERE (o.advisor_id LIKE 'adv_%' OR o.advisor_id IS NULL)
  AND o.advisor_linkedin_url IS NOT NULL;

-- Step 4: Update observations using the temporary table
UPDATE `savvy-gtm-analytics.savvy_pirate.connection_observations` o
SET advisor_id = f.correct_advisor_id
FROM `savvy-gtm-analytics.savvy_pirate._temp_observation_fixes` f
WHERE o.id = f.observation_id;

-- Step 5: Clean up temporary table
DROP TABLE IF EXISTS `savvy-gtm-analytics.savvy_pirate._temp_observation_fixes`;

-- Step 6: Verify the fix
SELECT 
  COUNT(*) as total_observations,
  SUM(CASE WHEN advisor_id LIKE 'adv_%' THEN 1 ELSE 0 END) as hash_ids_remaining,
  SUM(CASE WHEN advisor_id IS NULL AND advisor_linkedin_url IS NOT NULL THEN 1 ELSE 0 END) as null_ids_remaining,
  SUM(CASE WHEN advisor_id IS NOT NULL AND advisor_id NOT LIKE 'adv_%' THEN 1 ELSE 0 END) as correct_ids
FROM `savvy-gtm-analytics.savvy_pirate.connection_observations`;

