-- ROLLBACK Migration: Restore brand extraction triggers
-- Use this ONLY if you need to rollback from Railway to database triggers
-- Date: 2025-10-30

-- Restore sync_brand_mentions trigger
CREATE TRIGGER sync_brand_mentions_trigger 
  AFTER INSERT OR UPDATE ON prompt_tracking_results
  FOR EACH ROW
  WHEN (new.extracted_brands IS NOT NULL)
  EXECUTE FUNCTION sync_brand_mentions();

-- Restore populate_analytics_facts trigger  
CREATE TRIGGER trg_populate_analytics_facts
  AFTER INSERT ON brand_mentions
  FOR EACH ROW
  EXECUTE FUNCTION populate_analytics_facts();

-- Restore sync_prompt_citations trigger
CREATE TRIGGER sync_prompt_citations_trigger
  AFTER INSERT OR UPDATE OF citations ON prompt_tracking_results
  FOR EACH ROW
  EXECUTE FUNCTION sync_prompt_citations();

-- Verify triggers are restored
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
  
  IF trigger_count = 3 THEN
    RAISE NOTICE 'Successfully restored all 3 brand extraction triggers ✅';
  ELSE
    RAISE WARNING 'Only restored % out of 3 triggers!', trigger_count;
  END IF;
END $$;

