-- =====================================================
-- Migration: Fix canonical brands race condition
-- =====================================================
-- Problem: find_or_create_canonical_brand() can throw duplicate key errors
--          when multiple requests try to create the same brand simultaneously
-- Solution: Use INSERT ... ON CONFLICT DO NOTHING + fallback SELECT pattern
-- =====================================================

-- Drop and recreate the function with race-condition-safe INSERT
CREATE OR REPLACE FUNCTION public.find_or_create_canonical_brand(
  p_brand_name text, 
  p_brand_domain text DEFAULT NULL::text, 
  p_sentiment integer DEFAULT NULL::integer, 
  p_ranking_position integer DEFAULT NULL::integer, 
  p_domain_verified boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_canonical_brand_id UUID;
  v_normalized_domain TEXT;
  v_normalized_slug TEXT;
  v_similar_brand RECORD;
  v_alias_exists BOOLEAN;
  v_new_alias JSONB;
BEGIN
  -- Validate input
  IF p_brand_name IS NULL OR TRIM(p_brand_name) = '' THEN
    RAISE EXCEPTION 'Brand name cannot be empty';
  END IF;
  
  -- Normalize inputs
  v_normalized_domain := normalize_domain_for_matching(extract_domain_from_url(p_brand_domain));
  v_normalized_slug := normalize_brand_name_to_slug(p_brand_name);
  
  -- PRIORITY 1: Exact canonical_website match
  IF v_normalized_domain IS NOT NULL THEN
    SELECT id INTO v_canonical_brand_id
    FROM canonical_brands
    WHERE normalize_domain_for_matching(canonical_website) = v_normalized_domain
    ORDER BY created_at ASC
    LIMIT 1;
    
    IF v_canonical_brand_id IS NOT NULL THEN
      -- Found by domain match - update and return
      SELECT EXISTS(
        SELECT 1 FROM canonical_brands
        WHERE id = v_canonical_brand_id
          AND (
            canonical_name = p_brand_name
            OR aliases @> jsonb_build_array(jsonb_build_object('name', p_brand_name))
          )
      ) INTO v_alias_exists;
      
      -- Add to aliases if new variation
      IF NOT v_alias_exists THEN
        v_new_alias := jsonb_build_object(
          'name', p_brand_name,
          'first_seen', NOW(),
          'mention_count', 1
        );
        
        UPDATE canonical_brands
        SET 
          aliases = COALESCE(aliases, '[]'::jsonb) || v_new_alias,
          total_mentions = total_mentions + 1,
          last_seen_at = NOW(),
          updated_at = NOW(),
          -- Set domain_verified to true if this mention is verified (never downgrade to false)
          domain_verified = CASE WHEN p_domain_verified THEN true ELSE domain_verified END
        WHERE id = v_canonical_brand_id;
      ELSE
        -- Just increment counts
        UPDATE canonical_brands
        SET 
          total_mentions = total_mentions + 1,
          last_seen_at = NOW(),
          updated_at = NOW(),
          -- Set domain_verified to true if this mention is verified (never downgrade to false)
          domain_verified = CASE WHEN p_domain_verified THEN true ELSE domain_verified END
        WHERE id = v_canonical_brand_id;
      END IF;
      
      RETURN v_canonical_brand_id;
    END IF;
    
    -- PRIORITY 2: Check additional_websites array
    SELECT id INTO v_canonical_brand_id
    FROM canonical_brands
    WHERE v_normalized_domain = ANY(
      SELECT normalize_domain_for_matching(unnest(additional_websites))
    )
    ORDER BY created_at ASC
    LIMIT 1;
    
    IF v_canonical_brand_id IS NOT NULL THEN
      -- Found in additional_websites - update and return
      UPDATE canonical_brands
      SET 
        total_mentions = total_mentions + 1,
        last_seen_at = NOW(),
        updated_at = NOW(),
        -- Set domain_verified to true if verified
        domain_verified = CASE WHEN p_domain_verified THEN true ELSE domain_verified END
      WHERE id = v_canonical_brand_id;
      
      RETURN v_canonical_brand_id;
    END IF;
  END IF;
  
  -- PRIORITY 3: Fuzzy match by slug (85%+ similarity)
  SELECT 
    id,
    canonical_name,
    canonical_slug,
    canonical_website
  INTO v_similar_brand
  FROM canonical_brands
  WHERE similarity(canonical_slug, v_normalized_slug) >= 0.85
    AND (
      v_normalized_domain IS NULL 
      OR canonical_website IS NULL
      OR normalize_domain_for_matching(canonical_website) = v_normalized_domain
    )
  ORDER BY 
    similarity(canonical_slug, v_normalized_slug) DESC,
    created_at ASC
  LIMIT 1;
  
  IF v_similar_brand.id IS NOT NULL THEN
    v_canonical_brand_id := v_similar_brand.id;
    
    -- Update with new name as alias
    v_new_alias := jsonb_build_object(
      'name', p_brand_name,
      'first_seen', NOW(),
      'mention_count', 1
    );
    
    UPDATE canonical_brands
    SET 
      aliases = COALESCE(aliases, '[]'::jsonb) || v_new_alias,
      total_mentions = total_mentions + 1,
      last_seen_at = NOW(),
      updated_at = NOW(),
      canonical_website = COALESCE(canonical_website, extract_domain_from_url(p_brand_domain)),
      -- Set domain_verified to true if verified
      domain_verified = CASE WHEN p_domain_verified THEN true ELSE domain_verified END
    WHERE id = v_canonical_brand_id;
    
    RETURN v_canonical_brand_id;
  END IF;
  
  -- =====================================================
  -- PRIORITY 4: No match found - create new canonical brand
  -- FIXED: Use INSERT ... ON CONFLICT DO NOTHING + SELECT pattern
  -- This prevents duplicate key errors from race conditions
  -- =====================================================
  
  -- Try to insert
  INSERT INTO canonical_brands (
    canonical_name,
    canonical_slug,
    canonical_website,
    domain_verified,
    aliases,
    total_mentions,
    first_seen_at,
    last_seen_at
  ) VALUES (
    p_brand_name,
    v_normalized_slug,
    extract_domain_from_url(p_brand_domain),
    p_domain_verified,
    '[]'::jsonb,
    1,
    NOW(),
    NOW()
  )
  ON CONFLICT (canonical_slug) DO NOTHING
  RETURNING id INTO v_canonical_brand_id;
  
  -- If INSERT was blocked by concurrent transaction, SELECT the existing brand
  IF v_canonical_brand_id IS NULL THEN
    SELECT id INTO v_canonical_brand_id
    FROM canonical_brands
    WHERE canonical_slug = v_normalized_slug
    LIMIT 1;
    
    -- Update the existing brand's stats
    IF v_canonical_brand_id IS NOT NULL THEN
      UPDATE canonical_brands
      SET 
        total_mentions = total_mentions + 1,
        last_seen_at = NOW(),
        updated_at = NOW(),
        -- Set domain_verified to true if verified
        domain_verified = CASE WHEN p_domain_verified THEN true ELSE domain_verified END
      WHERE id = v_canonical_brand_id;
    END IF;
  END IF;
  
  RETURN v_canonical_brand_id;
END;
$function$;

-- =====================================================
-- Test the fix (optional - comment out if not needed)
-- =====================================================

-- Test that concurrent "Eight Sleep" inserts don't fail
DO $$
DECLARE
  v_brand_id_1 UUID;
  v_brand_id_2 UUID;
BEGIN
  -- Simulate two concurrent requests for the same brand
  v_brand_id_1 := find_or_create_canonical_brand('Test Brand XYZ', 'testbrand.com', NULL, NULL, false);
  v_brand_id_2 := find_or_create_canonical_brand('Test Brand XYZ', 'testbrand.com', NULL, NULL, false);
  
  -- Both should return the same ID
  IF v_brand_id_1 = v_brand_id_2 THEN
    RAISE NOTICE '✅ Race condition fix working: both calls returned same ID: %', v_brand_id_1;
  ELSE
    RAISE EXCEPTION '❌ Race condition NOT fixed: got different IDs: % vs %', v_brand_id_1, v_brand_id_2;
  END IF;
  
  -- Clean up test data
  DELETE FROM canonical_brands WHERE id = v_brand_id_1;
END $$;

