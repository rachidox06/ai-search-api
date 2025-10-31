# Canonical Brands Fix - Implementation Guide

## 🎯 Problem Statement

The brand extraction worker was experiencing duplicate key errors when trying to create canonical brands:

```
[Supabase] Failed to find/create canonical brands: 
duplicate key value violates unique constraint "canonical_brands_canonical_slug_key"
[Supabase] Using NULL canonical_brand_id fallback
```

This resulted in `canonical_brand_id = NULL` even when the brand existed in the database.

## 🔍 Root Causes

### 1. **Normalization Mismatch**
- **TypeScript** `normalizeBrandName()`: Returns `"eight sleep"` (with spaces)
- **Postgres** `normalize_brand_name_to_slug()`: Returns `"eightsleep"` (no spaces)
- **Result**: TypeScript searches for wrong slug → not found → tries to create → duplicate key error

### 2. **Race Condition in Postgres**
- No `ON CONFLICT` handling in INSERT statement
- When two concurrent requests try to create the same brand:
  - Request A: SELECT (not found) → INSERT (success)
  - Request B: SELECT (not found) → INSERT (DUPLICATE KEY ERROR)

## ✅ Solution Implemented

### Phase 1: Fix TypeScript Normalization

**File**: `brand-extraction-worker/src/services/supabase.ts`

**Added**: New function `normalizeBrandNameToSlug()` that exactly matches Postgres logic:

```typescript
export function normalizeBrandNameToSlug(brandName: string): string {
  // Removes ALL special characters including spaces
  // "Eight Sleep" → "eightsleep"
  // Matches Postgres normalize_brand_name_to_slug() exactly
}
```

**Why two normalization functions?**
- `normalizeBrandName()`: Keeps spaces - used for `analytics_facts.brand_slug` (backward compatibility)
- `normalizeBrandNameToSlug()`: No spaces - matches `canonical_brands.canonical_slug` (canonical lookup)

### Phase 2: Fix Postgres Race Condition

**File**: `db/003_fix_canonical_brands_race_condition.sql`

**Changed**: INSERT statement in `find_or_create_canonical_brand()`:

```sql
-- BEFORE (race condition)
INSERT INTO canonical_brands (...) 
VALUES (...)
RETURNING id INTO v_canonical_brand_id;

-- AFTER (race-condition-safe)
INSERT INTO canonical_brands (...) 
VALUES (...)
ON CONFLICT (canonical_slug) DO NOTHING
RETURNING id INTO v_canonical_brand_id;

-- If INSERT was blocked, SELECT the existing brand
IF v_canonical_brand_id IS NULL THEN
  SELECT id INTO v_canonical_brand_id
  FROM canonical_brands
  WHERE canonical_slug = v_normalized_slug;
END IF;
```

**How it works**:
1. Try to INSERT new brand
2. If slug already exists (concurrent insert), do nothing (no error)
3. SELECT the existing brand by slug
4. Return the ID (whether we created it or found it)

### Phase 3: Remove Temporary Workaround

**Removed**: 
- `generateSlugVariations()` - no longer needed
- `manualLookupCanonicalBrands()` - no longer needed
- Duplicate key retry logic - no longer needed

**Why?** With proper normalization, slugs always match. With `ON CONFLICT`, no errors are thrown.

### Phase 4: Fix Existing Data

**File**: `db/004_fix_null_canonical_brand_ids.sql`

This script:
1. Finds all rows with `canonical_brand_id = NULL`
2. Re-links them to existing canonical brands using corrected slug matching
3. Creates missing canonical brands if needed
4. Verifies 100% of brands are linked

## 📦 Files Changed

### TypeScript
- ✅ `brand-extraction-worker/src/services/supabase.ts`
  - Added `normalizeBrandNameToSlug()` function
  - Removed temporary workaround code
  - Simplified error handling

### SQL Migrations
- ✅ `db/003_fix_canonical_brands_race_condition.sql` - Fix Postgres function
- ✅ `db/004_fix_null_canonical_brand_ids.sql` - Fix existing data

### Documentation
- ✅ `brand-extraction-worker/CANONICAL_BRANDS_FIX_GUIDE.md` - This file

## 🚀 Deployment Steps

### Step 1: Apply Postgres Migration (Critical First!)

Run the race condition fix **BEFORE** deploying TypeScript changes:

```bash
# Connect to Supabase
psql $DATABASE_URL

# Apply the fix
\i db/003_fix_canonical_brands_race_condition.sql
```

**Why first?** This prevents duplicate key errors immediately.

### Step 2: Deploy TypeScript Changes

Build and deploy the updated worker:

```bash
cd brand-extraction-worker
npm run build
# Deploy to Railway (or your platform)
```

**Result**: New requests will use correct slug normalization.

### Step 3: Fix Existing Data

Run the data fix script:

```bash
psql $DATABASE_URL
\i db/004_fix_null_canonical_brand_ids.sql
```

**Result**: All existing NULL `canonical_brand_id` values are updated.

### Step 4: Verify

Check logs for success:

```
[Supabase] Finding/creating 5 canonical brands...
[Supabase] ✅ Got 5 canonical brand IDs
```

No more errors like:
```
❌ duplicate key value violates unique constraint "canonical_brands_canonical_slug_key"
❌ Using NULL canonical_brand_id fallback
```

## 🧪 Testing

### Test 1: Normalization Match

```typescript
import { normalizeBrandNameToSlug } from './services/supabase';

console.log(normalizeBrandNameToSlug('Eight Sleep')); 
// Should output: "eightsleep"
```

### Test 2: Race Condition Handling

Run the test included in `003_fix_canonical_brands_race_condition.sql`:

```sql
-- Creates same brand twice
-- Should return same ID both times (no error)
```

### Test 3: Verify Data Fix

```sql
-- Should return 0 NULLs
SELECT COUNT(*) 
FROM analytics_facts 
WHERE canonical_brand_id IS NULL 
  AND brand_slug != 'no_brands';
```

## 📊 Expected Results

### Before Fix
```
✅ Extracts "Eight Sleep" from AI response
✅ Sets is_own_brand = true
❌ Canonical brand lookup fails with duplicate key error
❌ Falls back to canonical_brand_id = NULL
```

### After Fix
```
✅ Extracts "Eight Sleep" from AI response
✅ Sets is_own_brand = true
✅ Canonical brand lookup succeeds (correct slug normalization)
✅ Returns canonical_brand_id = 'f50602a9-014d-476f-a57d-d8920cbd731b'
```

## 🎓 Key Learnings

1. **Normalization Must Match**: TypeScript and Postgres must produce identical slugs
2. **Handle Race Conditions**: Always use `ON CONFLICT` when creating unique records
3. **Fail Gracefully**: Don't return NULL on errors - retry with SELECT
4. **Test Both Paths**: Test successful INSERT and blocked INSERT (conflict) scenarios

## 🔧 Future Improvements

### Optional: Consolidate Normalization Functions

Consider keeping only `normalizeBrandNameToSlug()` and deprecating `normalizeBrandName()`:

1. Update `analytics_facts.brand_slug` to use no-space slugs
2. Update frontend queries to match
3. Remove `normalizeBrandName()` function

**Benefits**: Single source of truth, no confusion

**Effort**: Medium (requires frontend updates)

## 📞 Support

If issues persist:

1. Check logs for the exact error message
2. Verify Postgres migration was applied: `SELECT proname FROM pg_proc WHERE proname = 'find_or_create_canonical_brand'`
3. Test normalization: `SELECT normalize_brand_name_to_slug('Eight Sleep')`
4. Check for NULLs: Run queries from `004_fix_null_canonical_brand_ids.sql`

## ✅ Success Criteria

- [ ] No more duplicate key errors in logs
- [ ] No more NULL canonical_brand_ids for real brands
- [ ] "Eight Sleep" correctly links to existing canonical brand
- [ ] Concurrent requests handled gracefully
- [ ] TypeScript compiles without errors
- [ ] All existing data fixed

