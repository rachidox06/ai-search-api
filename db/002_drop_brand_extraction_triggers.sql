-- Migration: Drop brand extraction triggers and replace with Railway application logic
-- Date: 2025-10-30
-- Reason: Move from unreliable database triggers to reliable Railway worker direct inserts
-- 
-- This migration drops 3 triggers that are now handled by brand-extraction-worker:
-- 1. sync_brand_mentions_trigger -> inserts into brand_mentions
-- 2. trg_populate_analytics_facts -> inserts into analytics_facts  
-- 3. sync_prompt_citations_trigger -> inserts into prompt_citations
--
-- IMPORTANT: Deploy brand-extraction-worker BEFORE running this migration!

-- Drop trigger that syncs brand_mentions from extracted_brands
DROP TRIGGER IF EXISTS sync_brand_mentions_trigger ON prompt_tracking_results;

-- Drop trigger that populates analytics_facts from brand_mentions
DROP TRIGGER IF EXISTS trg_populate_analytics_facts ON brand_mentions;

-- Drop trigger that syncs prompt_citations from citations JSONB
DROP TRIGGER IF EXISTS sync_prompt_citations_trigger ON prompt_tracking_results;

-- Note: We keep the trigger functions for now in case rollback is needed
-- The functions can be dropped in a future migration after confirming everything works:
-- - sync_brand_mentions()
-- - populate_analytics_facts()
-- - sync_prompt_citations()

-- Verify triggers are dropped
DO $$
DECLARE
  trigger_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND t.tgname IN ('sync_brand_mentions_trigger', 'trg_populate_analytics_facts', 'sync_prompt_citations_trigger');
  
  IF trigger_count > 0 THEN
    RAISE EXCEPTION 'Failed to drop all triggers. Found % remaining triggers.', trigger_count;
  ELSE
    RAISE NOTICE 'Successfully dropped all 3 brand extraction triggers ✅';
  END IF;
END $$;

