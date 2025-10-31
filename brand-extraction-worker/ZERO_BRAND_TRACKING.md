# Zero-Brand Results Tracking

## Overview
We now track prompt results that return **zero brands** by inserting placeholder rows into `analytics_facts`. This enables accurate analytics and mention rate calculations.

---

## What Changed

### Before
```
Prompt Result → 0 brands found
  ↓
Nothing inserted to analytics_facts
  ↓
Lost data - can't track zero-brand queries
```

### After
```
Prompt Result → 0 brands found
  ↓
Insert placeholder row:
  - brand_slug: 'no_brands'
  - brand_name: 'No Brands Found'
  - mention_count: 0
  ↓
Full tracking of all queries ✅
```

---

## Implementation Details

### Placeholder Row Format

When no brands are found, we insert one row **per tag** with these values:

```typescript
{
  brand_slug: 'no_brands',           // ← Consistent identifier
  brand_name: 'No Brands Found',     // ← Human-readable
  brand_website: null,
  is_own_brand: false,
  mention_count: 0,                  // ← Zero mentions
  ranking_position: null,
  sentiment_score: null,
  // All other fields populated normally (date, engine, prompt, etc.)
}
```

### Modified Function

**File:** `src/services/supabase.ts`

**Function:** `insertAnalyticsFacts()`

Now handles two cases:
1. **No brands** → Insert placeholder rows
2. **Brands found** → Insert normal rows (existing behavior)

---

## Analytics Queries

### Total Queries Tracked
```sql
SELECT COUNT(DISTINCT result_id) 
FROM analytics_facts;
```

### Queries WITH Brand Mentions
```sql
SELECT COUNT(DISTINCT result_id) 
FROM analytics_facts 
WHERE brand_slug != 'no_brands';
```

### Queries WITHOUT Brand Mentions (Zero Brands)
```sql
SELECT COUNT(DISTINCT result_id) 
FROM analytics_facts 
WHERE brand_slug = 'no_brands';
```

### Brand Mention Rate
```sql
SELECT 
  COUNT(DISTINCT result_id) FILTER (WHERE brand_slug != 'no_brands') * 100.0 / 
  COUNT(DISTINCT result_id) as mention_rate_percent
FROM analytics_facts;
```

### Queries by Brand Count
```sql
SELECT 
  CASE 
    WHEN brand_slug = 'no_brands' THEN '0 brands'
    ELSE '1+ brands'
  END as brand_count_category,
  COUNT(DISTINCT result_id) as query_count
FROM analytics_facts
GROUP BY brand_count_category;
```

### Zero-Brand Rate by Engine
```sql
SELECT 
  engine,
  COUNT(DISTINCT result_id) FILTER (WHERE brand_slug = 'no_brands') * 100.0 / 
  COUNT(DISTINCT result_id) as zero_brand_rate_percent
FROM analytics_facts
GROUP BY engine
ORDER BY zero_brand_rate_percent DESC;
```

---

## Expected Logs

### When Brands Found (Normal)
```
[Supabase] Checking 5 brands for is_own_brand...
[Supabase] Inserting 5 analytics facts (5 brands × 1 tags)
[Supabase] ✅ Inserted 5 analytics facts
```

### When Zero Brands Found (NEW)
```
[Supabase] No brands found - inserting placeholder for zero-brand tracking
[Supabase] Inserting 1 analytics facts (0 brands × 1 tags)
[Supabase] ✅ Inserted 1 analytics facts
```

### With Multiple Tags
```
[Supabase] No brands found - inserting placeholder for zero-brand tracking
[Supabase] Inserting 3 analytics facts (0 brands × 3 tags)
[Supabase] ✅ Inserted 3 analytics facts
```

---

## Filtering Placeholder Data

When you want to **exclude** zero-brand results from brand lists/rankings:

```sql
-- Get all actual brands (exclude placeholder)
SELECT DISTINCT brand_name 
FROM analytics_facts 
WHERE brand_slug != 'no_brands';
```

```sql
-- Brand ranking (exclude zero-brand rows)
SELECT 
  brand_name, 
  AVG(ranking_position) as avg_rank
FROM analytics_facts
WHERE brand_slug != 'no_brands'
  AND ranking_position IS NOT NULL
GROUP BY brand_name
ORDER BY avg_rank;
```

---

## Dashboard Examples

### 1. Mention Coverage Widget
```sql
WITH stats AS (
  SELECT 
    COUNT(DISTINCT result_id) as total_queries,
    COUNT(DISTINCT result_id) FILTER (WHERE brand_slug != 'no_brands') as queries_with_mentions
  FROM analytics_facts
)
SELECT 
  queries_with_mentions,
  total_queries,
  (queries_with_mentions * 100.0 / total_queries)::numeric(5,2) as coverage_percent
FROM stats;
```

**Result:**
```
queries_with_mentions | total_queries | coverage_percent
---------------------|---------------|------------------
        850          |      1000     |      85.00
```

### 2. Daily Mention Rate Trend
```sql
SELECT 
  date,
  COUNT(DISTINCT result_id) as total_queries,
  COUNT(DISTINCT result_id) FILTER (WHERE brand_slug != 'no_brands') as with_brands,
  COUNT(DISTINCT result_id) FILTER (WHERE brand_slug = 'no_brands') as without_brands,
  (COUNT(DISTINCT result_id) FILTER (WHERE brand_slug != 'no_brands') * 100.0 / 
   COUNT(DISTINCT result_id))::numeric(5,2) as mention_rate
FROM analytics_facts
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY date
ORDER BY date DESC;
```

---

## Benefits

✅ **Complete tracking** - No missing query data  
✅ **Accurate metrics** - Can calculate true mention rates  
✅ **Engine comparison** - See which AI engines mention brands more/less  
✅ **Trend analysis** - Track if mention rates improve over time  
✅ **Query analysis** - Understand what types of queries don't trigger brands  
✅ **Simple queries** - Just filter by `brand_slug != 'no_brands'`

---

## Impact on Existing Data

### Old Data (Before This Change)
- Zero-brand results = **NOT tracked**
- Gaps in analytics_facts

### New Data (After This Change)
- Zero-brand results = **Tracked with placeholder**
- Complete coverage

**Note:** Old zero-brand results will remain untracked. Only NEW queries (after deployment) will have placeholder rows.

---

## Files Modified

- ✅ `src/services/supabase.ts` - Updated `insertAnalyticsFacts()`
- ✅ Build successful
- ✅ No linter errors

---

## Rollback

If needed, revert to previous version where zero-brand results were skipped:

```typescript
if (validBrands.length === 0) {
  console.log(`[Supabase] No valid brands for analytics facts`);
  return; // ← Old behavior: skip insert
}
```

---

## Summary

**Problem:** Zero-brand queries weren't tracked  
**Solution:** Insert placeholder row with `brand_slug = 'no_brands'`  
**Benefit:** Full query coverage + accurate analytics  
**Filter:** Use `WHERE brand_slug != 'no_brands'` to exclude placeholders

