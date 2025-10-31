-- =====================================================
-- Data Fix: Update NULL canonical_brand_ids
-- =====================================================
-- Problem: Some rows have canonical_brand_id = NULL due to previous race condition errors
-- Solution: Re-link them to existing canonical brands using slug matching
-- =====================================================

-- Step 1: Check how many NULL canonical_brand_ids exist
SELECT 
  'analytics_facts' as table_name,
  COUNT(*) as null_count,
  COUNT(DISTINCT brand_name) as distinct_brands
FROM analytics_facts
WHERE canonical_brand_id IS NULL
  AND brand_slug != 'no_brands'  -- Exclude zero-brand placeholders
UNION ALL
SELECT 
  'brand_mentions' as table_name,
  COUNT(*) as null_count,
  COUNT(DISTINCT brand_name) as distinct_brands
FROM brand_mentions
WHERE canonical_brand_id IS NULL;

-- =====================================================
-- Step 2: Fix analytics_facts - Match by normalized slug
-- =====================================================

WITH brand_mappings AS (
  -- For each NULL brand in analytics_facts, find matching canonical brand
  SELECT DISTINCT
    af.brand_name,
    normalize_brand_name_to_slug(af.brand_name) as normalized_slug,
    cb.id as canonical_brand_id,
    cb.canonical_name
  FROM analytics_facts af
  LEFT JOIN canonical_brands cb 
    ON normalize_brand_name_to_slug(af.brand_name) = cb.canonical_slug
  WHERE af.canonical_brand_id IS NULL
    AND af.brand_slug != 'no_brands'
    AND cb.id IS NOT NULL  -- Only where we found a match
)
UPDATE analytics_facts
SET 
  canonical_brand_id = bm.canonical_brand_id,
  updated_at = NOW()
FROM brand_mappings bm
WHERE analytics_facts.brand_name = bm.brand_name
  AND analytics_facts.canonical_brand_id IS NULL;

-- Report what was fixed
SELECT 
  COUNT(*) as rows_fixed,
  canonical_brand_id,
  brand_name,
  COUNT(DISTINCT result_id) as unique_results
FROM analytics_facts
WHERE canonical_brand_id IS NOT NULL
  AND brand_slug != 'no_brands'
  AND updated_at > NOW() - INTERVAL '5 seconds'
GROUP BY canonical_brand_id, brand_name
ORDER BY rows_fixed DESC;

-- =====================================================
-- Step 3: Fix brand_mentions - Match by normalized slug
-- =====================================================

WITH brand_mappings AS (
  -- For each NULL brand in brand_mentions, find matching canonical brand
  SELECT DISTINCT
    bm.brand_name,
    normalize_brand_name_to_slug(bm.brand_name) as normalized_slug,
    cb.id as canonical_brand_id,
    cb.canonical_name
  FROM brand_mentions bm
  LEFT JOIN canonical_brands cb 
    ON normalize_brand_name_to_slug(bm.brand_name) = cb.canonical_slug
  WHERE bm.canonical_brand_id IS NULL
    AND cb.id IS NOT NULL  -- Only where we found a match
)
UPDATE brand_mentions
SET 
  canonical_brand_id = bm.canonical_brand_id,
  updated_at = NOW()
FROM brand_mappings bm
WHERE brand_mentions.brand_name = bm.brand_name
  AND brand_mentions.canonical_brand_id IS NULL;

-- Report what was fixed
SELECT 
  COUNT(*) as rows_fixed,
  canonical_brand_id,
  brand_name
FROM brand_mentions
WHERE canonical_brand_id IS NOT NULL
  AND updated_at > NOW() - INTERVAL '5 seconds'
GROUP BY canonical_brand_id, brand_name
ORDER BY rows_fixed DESC;

-- =====================================================
-- Step 4: Verify - Check remaining NULLs
-- =====================================================

-- These should only be brands that don't exist in canonical_brands yet
-- (edge case: new brands that failed during the race condition window)

SELECT 
  'analytics_facts_still_null' as status,
  COUNT(*) as count,
  array_agg(DISTINCT brand_name) as brand_names
FROM analytics_facts
WHERE canonical_brand_id IS NULL
  AND brand_slug != 'no_brands'
UNION ALL
SELECT 
  'brand_mentions_still_null' as status,
  COUNT(*) as count,
  array_agg(DISTINCT brand_name) as brand_names
FROM brand_mentions
WHERE canonical_brand_id IS NULL;

-- =====================================================
-- Optional: Create missing canonical brands for remaining NULLs
-- =====================================================
-- If any brands still have NULL after the update, create canonical brands for them

DO $$
DECLARE
  v_brand_record RECORD;
  v_canonical_id UUID;
BEGIN
  -- Process each unique brand that still has NULL canonical_brand_id
  FOR v_brand_record IN 
    SELECT DISTINCT 
      brand_name,
      brand_website
    FROM analytics_facts
    WHERE canonical_brand_id IS NULL
      AND brand_slug != 'no_brands'
  LOOP
    -- Create or find canonical brand
    v_canonical_id := find_or_create_canonical_brand(
      v_brand_record.brand_name,
      v_brand_record.brand_website,
      NULL,
      NULL,
      false
    );
    
    -- Update analytics_facts
    UPDATE analytics_facts
    SET canonical_brand_id = v_canonical_id,
        updated_at = NOW()
    WHERE brand_name = v_brand_record.brand_name
      AND canonical_brand_id IS NULL;
    
    -- Update brand_mentions
    UPDATE brand_mentions
    SET canonical_brand_id = v_canonical_id,
        updated_at = NOW()
    WHERE brand_name = v_brand_record.brand_name
      AND canonical_brand_id IS NULL;
    
    RAISE NOTICE 'Created/linked canonical brand for: % (ID: %)', v_brand_record.brand_name, v_canonical_id;
  END LOOP;
END $$;

-- =====================================================
-- Final verification: Should have zero NULLs now
-- =====================================================

SELECT 
  'FINAL_CHECK' as status,
  COUNT(*) FILTER (WHERE canonical_brand_id IS NULL AND brand_slug != 'no_brands') as analytics_nulls,
  COUNT(*) FILTER (WHERE canonical_brand_id IS NOT NULL) as analytics_linked,
  (COUNT(*) FILTER (WHERE canonical_brand_id IS NOT NULL) * 100.0 / 
   NULLIF(COUNT(*) FILTER (WHERE brand_slug != 'no_brands'), 0))::numeric(5,2) as link_percentage
FROM analytics_facts;

SELECT 
  'FINAL_CHECK_MENTIONS' as status,
  COUNT(*) FILTER (WHERE canonical_brand_id IS NULL) as mentions_nulls,
  COUNT(*) FILTER (WHERE canonical_brand_id IS NOT NULL) as mentions_linked,
  (COUNT(*) FILTER (WHERE canonical_brand_id IS NOT NULL) * 100.0 / 
   NULLIF(COUNT(*), 0))::numeric(5,2) as link_percentage
FROM brand_mentions;

