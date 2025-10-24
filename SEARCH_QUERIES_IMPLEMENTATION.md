# Search Queries Implementation for Gemini

## Overview
This document describes the implementation for extracting and storing search queries from Gemini's `groundingMetadata.webSearchQueries` into the database.

## Changes Made

### 1. Worker ([worker.gemini.js](worker.gemini.js))

#### Line 97: Extract search queries from API response
```javascript
searchQueries: groundingMetadata?.webSearchQueries || []
```

#### Line 127-130: Log search queries count
```javascript
console.log('✅ Gemini API response received:', {
  citations_count: result.citations?.length || 0,
  search_queries_count: result.searchQueries?.length || 0
});
```

#### Line 138: Pass search queries to normalize function
```javascript
result: [{
  markdown: result.enhancedText || result.text,
  answer: result.text,
  sources: result.sources,
  citations: result.citations,
  searchQueries: result.searchQueries, // ← Added this line
  model: 'gemini-2.5-flash'
}]
```

### 2. Normalize Function ([libs/normalize.js](libs/normalize.js#L189-L193))

#### Lines 189-193: Extract search queries for Gemini
```javascript
// Extract search queries from Gemini response (from groundingMetadata.webSearchQueries)
if (result?.searchQueries && Array.isArray(result.searchQueries) && result.searchQueries.length > 0) {
  extra.search_queries = result.searchQueries;
  console.log(`🔍 [normalize.js] Extracted ${result.searchQueries.length} search queries from Gemini`);
}
```

### 3. Persist Function ([libs/persist.js](libs/persist.js#L32-L43))

#### Lines 32-36: Extract search_queries from extra
```javascript
// Add search_queries if they exist in extra (for Gemini only)
let search_queries = null;
if (normalizedData.extra?.search_queries) {
  search_queries = normalizedData.extra.search_queries;
}
```

#### Lines 38-43: Remove search_queries from extra to avoid duplication
```javascript
// Remove citations and search_queries from extra to avoid duplication
// They will be stored in dedicated columns
const extraWithoutDedicatedFields = { ...normalizedData.extra };
delete extraWithoutDedicatedFields.citations;
delete extraWithoutDedicatedFields.citations_count;
delete extraWithoutDedicatedFields.search_queries;
```

#### Lines 69-70: Insert search_queries into database
```javascript
// Search queries in dedicated column (Gemini only)
search_queries: search_queries
```

## Data Flow

```
1. Gemini API Response
   └─> groundingMetadata.webSearchQueries: ["query 1", "query 2", ...]

2. queryGemini() in worker.gemini.js (line 97)
   └─> Extracts: searchQueries: groundingMetadata?.webSearchQueries || []

3. runJob() in worker.gemini.js (line 138)
   └─> Passes to normalize: searchQueries: result.searchQueries

4. normalizeResponse() in libs/normalize.js (lines 189-193)
   └─> Stores in extra: extra.search_queries = result.searchQueries

5. saveTrackingResult() in libs/persist.js (lines 32-36, 70)
   └─> Extracts from extra and saves to dedicated column: search_queries

6. Database (prompt_tracking_results table)
   └─> Column: search_queries (JSONB)
   └─> Example: ["quantum computing 2024", "latest quantum breakthroughs"]
```

## Database Schema

The `search_queries` column in the `prompt_tracking_results` table should be:
- **Type**: `JSONB`
- **Nullable**: Yes (will be NULL for engines other than Gemini)
- **Content**: Array of strings representing search queries used by Gemini

Example data:
```json
{
  "search_queries": [
    "quantum computing developments 2024",
    "quantum computing breakthroughs",
    "latest quantum computer news"
  ]
}
```

## Engine Support

| Engine | Search Queries Support |
|--------|----------------------|
| Gemini | ✅ Yes (from `groundingMetadata.webSearchQueries`) |
| Claude | ❌ No |
| ChatGPT | ❌ No |
| Perplexity | ❌ No |
| Google | ❌ No |

## Testing

To verify the implementation works:

1. **Send a test prompt to Gemini:**
   ```bash
   curl -X POST https://your-api.com/api/v1/prompt-runs/batch \
     -H "Content-Type: application/json" \
     -d '{"prompt_id":"test-uuid","engines":["gemini"]}'
   ```

2. **Check the logs for:**
   ```
   ✅ Gemini API response received: { citations_count: X, search_queries_count: Y }
   🔍 [normalize.js] Extracted Y search queries from Gemini
   ✅ Saved tracking result to Supabase: result-id
   ```

3. **Query the database:**
   ```sql
   SELECT
     id,
     engine,
     search_queries,
     jsonb_array_length(search_queries) as query_count
   FROM prompt_tracking_results
   WHERE engine = 'gemini'
   ORDER BY created_at DESC
   LIMIT 10;
   ```

## Benefits

1. **Transparency**: Users can see exactly what queries Gemini used to research their question
2. **Quality Analysis**: Can analyze the quality and relevance of search queries used
3. **Debugging**: Helps understand why Gemini returned certain results
4. **Query Mining**: Can extract valuable search query patterns for SEO/content strategy

## Example Output

When Gemini processes: *"What are the latest developments in quantum computing?"*

The `search_queries` column might contain:
```json
[
  "latest quantum computing developments 2024",
  "quantum computing breakthroughs",
  "quantum computer news recent"
]
```

This shows exactly what queries Gemini used to search Google before formulating its answer.
