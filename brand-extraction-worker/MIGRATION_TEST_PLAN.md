# Brand Extraction Migration Test Plan
## From Triggers to Railway Direct Inserts

### Overview
We've migrated from database triggers to Railway application logic for populating:
- `brand_mentions`
- `analytics_facts`  
- `prompt_citations`

---

## Pre-Migration Checklist

- [ ] **Deploy updated Railway worker** with new code
- [ ] **Test with existing data** before dropping triggers
- [ ] **Verify logs** show successful inserts
- [ ] **Check data accuracy** in all 3 tables

---

## Testing Strategy

### Phase 1: Test WITH Triggers (Current State)

**Goal:** Verify current system works and capture baseline data

1. Pick a recent `prompt_tracking_results` record with `extracted_brands`:
   ```sql
   SELECT id, engine, extracted_brands, created_at 
   FROM prompt_tracking_results 
   WHERE extracted_brands IS NOT NULL 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

2. Check what the triggers created:
   ```sql
   -- Check brand_mentions
   SELECT * FROM brand_mentions 
   WHERE result_id = '<result_id_from_above>';
   
   -- Check analytics_facts
   SELECT * FROM analytics_facts 
   WHERE result_id = '<result_id_from_above>';
   
   -- Check prompt_citations
   SELECT * FROM prompt_citations 
   WHERE result_id = '<result_id_from_above>';
   ```

3. Save counts for comparison:
   - Brand mentions count: ___
   - Analytics facts count: ___
   - Citations count: ___

---

### Phase 2: Test Railway WITHOUT Dropping Triggers

**Goal:** Test Railway inserts work alongside triggers (will create duplicates temporarily)

1. **Delete test data** from the 3 tables:
   ```sql
   DELETE FROM analytics_facts WHERE result_id = '<test_result_id>';
   DELETE FROM brand_mentions WHERE result_id = '<test_result_id>';
   DELETE FROM prompt_citations WHERE result_id = '<test_result_id>';
   ```

2. **Trigger re-processing** by updating `extracted_brands`:
   ```sql
   -- The Railway worker will process this when queued
   -- The triggers will ALSO fire
   UPDATE prompt_tracking_results 
   SET updated_at = NOW() 
   WHERE id = '<test_result_id>';
   ```
   
   OR manually add to queue (if you have a script to queue jobs).

3. **Check Railway logs** for successful processing:
   ```
   [Supabase] 🚀 Starting complete extraction save...
   [Supabase] ✅ Inserted X brand mentions
   [Supabase] ✅ Inserted Y analytics facts
   [Supabase] ✅ Inserted Z citations
   [Supabase] ✅✅✅ Complete extraction save successful
   ```

4. **Verify data matches Phase 1 baseline:**
   ```sql
   -- Should match Phase 1 counts
   SELECT COUNT(*) FROM brand_mentions WHERE result_id = '<test_result_id>';
   SELECT COUNT(*) FROM analytics_facts WHERE result_id = '<test_result_id>';
   SELECT COUNT(*) FROM prompt_citations WHERE result_id = '<test_result_id>';
   ```

5. **Compare data quality:**
   ```sql
   -- Check that brand_slug is normalized
   SELECT brand_name, brand_slug FROM analytics_facts 
   WHERE result_id = '<test_result_id>' LIMIT 5;
   
   -- Check that is_own_brand is calculated
   SELECT brand_name, is_own_brand FROM analytics_facts 
   WHERE result_id = '<test_result_id>' LIMIT 5;
   
   -- Check that own_brand_citations is calculated
   SELECT DISTINCT own_brand_citations FROM analytics_facts 
   WHERE result_id = '<test_result_id>';
   ```

---

### Phase 3: Drop Triggers and Test Final State

**ONLY proceed if Phase 2 passed all tests!**

1. **Run migration:**
   ```bash
   # Apply migration using Supabase CLI or Management API
   psql <connection_string> -f db/002_drop_brand_extraction_triggers.sql
   ```
   
   Expected output:
   ```
   DROP TRIGGER
   DROP TRIGGER
   DROP TRIGGER
   NOTICE: Successfully dropped all 3 brand extraction triggers ✅
   ```

2. **Verify triggers are gone:**
   ```sql
   SELECT t.tgname 
   FROM pg_trigger t
   JOIN pg_class c ON t.tgrelid = c.oid
   WHERE c.relname IN ('prompt_tracking_results', 'brand_mentions')
     AND t.tgname LIKE '%brand%' OR t.tgname LIKE '%citation%';
   ```
   Should return 0 rows for our 3 triggers.

3. **Test new data processing:**
   - Queue a new brand extraction job
   - Monitor Railway logs
   - Verify inserts in all 3 tables
   
   ```sql
   -- Check for newest result
   SELECT id, engine, created_at 
   FROM prompt_tracking_results 
   WHERE extracted_brands IS NOT NULL 
   ORDER BY created_at DESC 
   LIMIT 1;
   
   -- Verify data exists
   SELECT COUNT(*) FROM brand_mentions WHERE result_id = '<new_result_id>';
   SELECT COUNT(*) FROM analytics_facts WHERE result_id = '<new_result_id>';
   SELECT COUNT(*) FROM prompt_citations WHERE result_id = '<new_result_id>';
   ```

---

## Validation Queries

### Check for Data Consistency

```sql
-- Find results with extracted_brands but NO brand_mentions
SELECT ptr.id, ptr.engine, ptr.created_at
FROM prompt_tracking_results ptr
LEFT JOIN brand_mentions bm ON bm.result_id = ptr.id
WHERE ptr.extracted_brands IS NOT NULL
  AND ptr.extracted_brands != '[]'::jsonb
  AND bm.id IS NULL
LIMIT 10;
```

```sql
-- Find brand_mentions with NO analytics_facts
SELECT bm.id, bm.brand_name, bm.result_id
FROM brand_mentions bm
LEFT JOIN analytics_facts af ON af.result_id = bm.result_id AND af.brand_slug = normalize_brand_name(bm.brand_name)
WHERE af.id IS NULL
LIMIT 10;
```

```sql
-- Find results with citations but NO prompt_citations
SELECT ptr.id, ptr.engine, jsonb_array_length(ptr.citations) as citation_count
FROM prompt_tracking_results ptr
LEFT JOIN prompt_citations pc ON pc.result_id = ptr.id
WHERE ptr.citations IS NOT NULL
  AND jsonb_array_length(ptr.citations) > 0
  AND pc.id IS NULL
LIMIT 10;
```

---

## Monitoring

### Key Metrics to Watch

1. **Railway worker logs:**
   - No errors during `saveCompleteExtractionResult()`
   - All inserts complete successfully
   - Processing time reasonable (< 5s per result)

2. **Database row counts:**
   ```sql
   -- Daily brand mentions growth
   SELECT DATE(created_at), COUNT(*) 
   FROM brand_mentions 
   WHERE created_at > NOW() - INTERVAL '7 days'
   GROUP BY DATE(created_at)
   ORDER BY DATE(created_at) DESC;
   ```

3. **Error rate:**
   - Check Railway error logs for failed jobs
   - Check BullMQ failed queue

---

## Rollback Plan

If issues occur after dropping triggers:

1. **Stop Railway worker** to prevent duplicate inserts

2. **Restore triggers:**
   ```bash
   psql <connection_string> -f db/002_rollback_restore_triggers.sql
   ```

3. **Restart Railway worker** with OLD code (git revert)

4. **Clean up duplicate data** if needed:
   ```sql
   -- Find duplicates in brand_mentions (same result_id + brand_name)
   DELETE FROM brand_mentions a
   USING brand_mentions b
   WHERE a.id > b.id
     AND a.result_id = b.result_id
     AND a.brand_name = b.brand_name;
   ```

---

## Success Criteria

✅ All Phase 2 tests pass with identical data  
✅ No errors in Railway logs  
✅ Data validation queries return 0 gaps  
✅ Performance is acceptable (< 5s per job)  
✅ 24 hours of production traffic with no issues  

---

## Post-Migration Cleanup (After 1 week)

Once confident the system is stable, drop the unused trigger functions:

```sql
DROP FUNCTION IF EXISTS sync_brand_mentions() CASCADE;
DROP FUNCTION IF EXISTS populate_analytics_facts() CASCADE;
DROP FUNCTION IF EXISTS sync_prompt_citations() CASCADE;
```

