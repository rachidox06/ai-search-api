# Canonical Brands Implementation Summary

## Overview
Successfully integrated the `canonical_brands` table into the brand extraction workflow while maintaining all existing features including zero-brand tracking.

## Files Modified

### 1. `/brand-extraction-worker/src/services/supabase.ts`

**Total Changes:**
- Updated 2 TypeScript interfaces
- Added 1 new batch RPC function
- Removed 1 function (merged into another)
- Completely rewrote 1 major function
- Updated 1 orchestration function

---

## Detailed Changes

### A. Type Definitions Updated

#### `BrandMentionInsert` Interface
**Added:**
```typescript
canonical_brand_id: string | null;
```

#### `AnalyticsFactInsert` Interface
**Added:**
```typescript
canonical_brand_id: string | null;
```

---

### B. New Function: `findOrCreateCanonicalBrandsBatch()`

**Purpose:** Batch RPC call to find or create canonical brands in one database call

**Key Features:**
- Takes array of brands with `name`, `domain`, `sentiment`, `ranking_position`
- Calls Postgres function `find_or_create_canonical_brands_batch`
- Returns array of canonical brand IDs in same order as input
- **Fallback:** Returns `null` for all brands if RPC fails (graceful degradation)
- **Validation:** Ensures returned array length matches input length

**Performance:** Single RPC call instead of N individual calls

---

### C. Removed Function: `insertBrandMentions()`

**Reason:** Merged into `insertAnalyticsFacts()` to reduce code duplication and consolidate logic

---

### D. Major Rewrite: `insertAnalyticsFacts()`

**New Responsibilities:**
1. Insert into `analytics_facts` table (existing)
2. Insert into `brand_mentions` table (new - previously separate)
3. Find/create canonical brands (new)
4. Maintain zero-brand tracking (preserved)

**Flow:**

#### CASE 1: Zero Brands Found
```
1. Create placeholder analytics_facts rows (one per tag)
   - brand_slug: 'no_brands'
   - brand_name: 'No Brands Found'
   - canonical_brand_id: null
   - mention_count: 0
2. Skip brand_mentions insertion (nothing to insert)
```

#### CASE 2: Brands Found
```
STEP 1: Find/Create Canonical Brands (Batch)
  ├─ Prepare brands array for RPC
  ├─ Call findOrCreateCanonicalBrandsBatch()
  └─ Get array of canonical_brand_ids

STEP 2: Batch Fuzzy Matching (Existing)
  ├─ Extract brand names
  ├─ Call isOwnBrandFuzzyBatch()
  └─ Get array of is_own_brand booleans

STEP 3: Prepare Rows
  For each brand:
    ├─ Normalize brand name to slug (local, no DB call)
    ├─ Get canonical_brand_id from Step 1 array
    ├─ Get is_own_brand from Step 2 array
    ├─ Create analytics_facts rows (one per tag)
    └─ Create brand_mentions row (one per brand)

STEP 4: Insert analytics_facts
  └─ Upsert with conflict resolution

STEP 5: Insert brand_mentions
  └─ Standard insert
```

**Preserved Features:**
- ✅ Zero-brand tracking with placeholder rows
- ✅ Batch fuzzy matching for `is_own_brand`
- ✅ Local brand name normalization
- ✅ Proper `own_brand_citations` calculation (uses `calculateOwnBrandCitations()`)
- ✅ Tag multiplication (one analytics row per brand × tag)
- ✅ Backwards compatibility (keeps `brand_slug`, `brand_name`, `brand_website`)

**New Features:**
- ✅ `canonical_brand_id` field populated in both tables
- ✅ Batch canonical brand creation/lookup
- ✅ Consolidated brand_mentions insertion

---

### E. Updated: `saveCompleteExtractionResult()`

**Changes:**
- **Removed:** Separate `insertBrandMentions()` call (Step 3)
- **Updated:** Comments to reflect new consolidated approach
- **Flow is now:**
  1. Save extracted brands to `prompt_tracking_results`
  2. Fetch result and prompt data
  3. **Insert into both `analytics_facts` AND `brand_mentions`** (single function call)
  4. Insert into `prompt_citations`

---

## Database Requirements

### Tables
1. **`canonical_brands`** - Must exist with proper schema
2. **`analytics_facts`** - Must have `canonical_brand_id UUID` column (nullable)
3. **`brand_mentions`** - Must have `canonical_brand_id UUID` column (nullable)

### Postgres Functions
1. **`find_or_create_canonical_brands_batch`** - Must be created
   - Input: `p_brands` (array of brand objects)
   - Output: Array of UUIDs (canonical brand IDs)
   - Logic: Find existing or create new canonical brands using fuzzy matching

### Indexes (Recommended)
```sql
-- For analytics_facts
CREATE INDEX idx_analytics_facts_canonical_brand_id 
ON analytics_facts(canonical_brand_id);

-- For brand_mentions
CREATE INDEX idx_brand_mentions_canonical_brand_id 
ON brand_mentions(canonical_brand_id);

-- For canonical_brands (if not already created)
CREATE INDEX idx_canonical_brands_normalized_name 
ON canonical_brands(normalized_name);
```

---

## Backwards Compatibility

**Maintained Fields:**
- `brand_slug` - Still populated using local normalization
- `brand_name` - Still stores original brand name
- `brand_website` - Still stores brand domain

**Why?**
These fields allow existing dashboards and queries to continue working while the frontend is updated to use `canonical_brand_id`.

**Migration Path:**
1. ✅ Deploy backend with new code (this implementation)
2. ⏳ Update frontend to use `canonical_brand_id` joins
3. ⏳ Eventually deprecate old fields (future)

---

## Error Handling

**Graceful Degradation:**

1. **If `find_or_create_canonical_brands_batch` RPC fails:**
   - Logs error
   - Sets all `canonical_brand_id` to `null`
   - Continues with insertion (backwards compatible fields still work)

2. **If `is_own_brand_fuzzy_batch` RPC fails:**
   - Logs warning
   - Sets all `is_own_brand` to `false`
   - Continues with insertion

**This ensures the worker doesn't crash if the canonical brands feature has issues.**

---

## Performance Characteristics

**Database Calls Per Result (with N brands):**

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Canonical brand lookup | N/A | **1 batch** | New feature |
| is_own_brand check | **1 batch** | **1 batch** | Same |
| Brand normalization | 0 (local) | 0 (local) | Same |
| analytics_facts insert | 1 | 1 | Same |
| brand_mentions insert | 1 | 1 | Same |
| **TOTAL** | **2 + local** | **3 + local** | +1 batch call |

**Impact:** Minimal - added only 1 additional batch RPC call

---

## Testing Checklist

- [ ] Zero-brand results still create placeholder rows in analytics_facts
- [ ] Zero-brand results don't create brand_mentions rows
- [ ] Normal brand extraction populates canonical_brand_id
- [ ] Fallback works when RPC fails (null canonical_brand_id)
- [ ] is_own_brand still calculated correctly
- [ ] own_brand_citations uses correct calculation
- [ ] Tags multiply correctly (N brands × M tags = N*M analytics rows)
- [ ] Brand mentions: N brands = N rows (not multiplied by tags)
- [ ] Backwards compatible fields still populated

---

## Summary

**What Changed:**
- Added `canonical_brand_id` to both `analytics_facts` and `brand_mentions`
- Integrated batch canonical brand lookup/creation
- Merged `insertBrandMentions()` into `insertAnalyticsFacts()`
- Maintained all existing features (zero-brand tracking, fuzzy matching, performance optimizations)

**What Stayed the Same:**
- Zero-brand tracking still works
- Batch performance optimizations preserved
- Backwards compatible fields still populated
- Error handling and graceful degradation
- Same function signatures for external callers

**Lines Changed:**
- +52 lines added
- -35 lines removed
- Net: +17 lines

**Compilation:** ✅ Successful with no errors

