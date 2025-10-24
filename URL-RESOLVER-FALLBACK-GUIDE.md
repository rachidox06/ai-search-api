# URL Resolver - Fallback & Error Handling Guide

## Overview

The URL resolver is designed to follow Vertex AI Search redirect URLs from Gemini citations to their final destination. It includes **comprehensive fallback mechanisms** to ensure the system never breaks, even when URL resolution fails.

## Core Principle: Always Return Valid Data

**The resolver NEVER throws errors that break the citation flow.** If resolution fails for any reason, it returns the original URL so citations are still displayed.

---

## Fallback Scenarios & Behavior

### 1. **Timeout Protection** ⏱️

**Scenario:** URL resolution takes too long (default: 5 seconds)

**Behavior:**
- Aborts the request automatically
- Returns the original Vertex URL
- Logs warning: `⚠️ Request aborted (timeout)`

**Example:**
```javascript
// If this takes >5 seconds, it will timeout and return original URL
const resolved = await resolveRedirectUrl(vertexUrl, 5, 5000);
```

**User Impact:** Citations show with Vertex URL instead of final URL (but still functional)

---

### 2. **Network Errors** 🌐

**Scenario:** DNS failure, connection refused, network unreachable

**Behavior:**
- Catches the network error
- Returns the original Vertex URL
- Logs warning: `⚠️ Network error for URL`

**User Impact:** Citations preserved with original URL

---

### 3. **Invalid Redirect URLs** ⚠️

**Scenario:** Vertex returns invalid redirect token or malformed URL

**Behavior:**
- Detects invalid URL format
- Returns the original Vertex URL
- Logs warning: `⚠️ Invalid redirect location`

**User Impact:** Citation preserved, shows Vertex URL

---

### 4. **Max Redirects Reached** 🔄

**Scenario:** Redirect chain exceeds 5 hops (prevents infinite loops)

**Behavior:**
- Stops following redirects at limit
- Returns the original URL
- Logs warning: `⚠️ Max redirects reached`

**Configuration:**
```javascript
// Customize max redirects (default: 5)
const resolved = await resolveRedirectUrl(url, 10); // Allow 10 redirects
```

**User Impact:** Citation shows original URL if redirect chain is too long

---

### 5. **Missing Location Header** 📍

**Scenario:** Server returns 3xx status but no Location header

**Behavior:**
- Detects missing Location header
- Returns the original URL
- Logs warning: `⚠️ Redirect status but no Location header`

**User Impact:** Citation preserved with original URL

---

### 6. **Partial Batch Failures** 📦

**Scenario:** When resolving multiple URLs, some succeed and some fail

**Behavior:**
- Uses `Promise.allSettled()` to ensure all complete
- Failed URLs return original URL
- Successful URLs return resolved URL
- **No data loss** - all citations preserved

**Example:**
```javascript
const citations = [
  { url: 'vertex-url-1' },  // ✅ Resolves successfully
  { url: 'vertex-url-2' },  // ❌ Times out -> keeps original
  { url: 'normal-url' }     // ⏭️ Skipped (not Vertex)
];

const resolved = await resolveCitationUrls(citations);
// Returns all 3 citations, no data loss
```

**User Impact:** Users get resolved URLs where possible, original URLs where resolution failed

---

### 7. **Empty/Null Input** ⚿

**Scenario:** Function called with null, undefined, or empty array

**Behavior:**
- Returns the input unchanged
- No errors thrown
- No unnecessary processing

**Example:**
```javascript
await resolveCitationUrls(null);       // Returns: null
await resolveCitationUrls(undefined);  // Returns: undefined
await resolveCitationUrls([]);        // Returns: []
```

**User Impact:** None (defensive programming)

---

### 8. **Non-Vertex URLs** 🚫

**Scenario:** URL is not a Vertex AI redirect URL

**Behavior:**
- Immediately returns original URL (no resolution attempt)
- No network requests made
- Efficient fast-path

**Detection:**
```javascript
if (!url.includes('vertexaisearch.cloud.google.com')) {
  return url; // Skip resolution
}
```

**User Impact:** Normal URLs pass through instantly, no delay

---

## Configuration Options

### Timeout

**Default:** 5000ms (5 seconds)

**Customize:**
```javascript
// Shorter timeout for faster failures
await resolveRedirectUrl(url, 5, 2000); // 2 seconds

// Longer timeout for slow networks
await resolveRedirectUrl(url, 5, 10000); // 10 seconds
```

### Max Redirects

**Default:** 5 redirects

**Customize:**
```javascript
// More redirects allowed
await resolveRedirectUrl(url, 10); // Allow 10 hops

// Fewer redirects (faster failure)
await resolveRedirectUrl(url, 2); // Only 2 hops
```

### Concurrency

**Default:** 5 parallel requests

**Customize:**
```javascript
// Higher concurrency (faster but more network load)
await resolveMultipleUrls(urls, 10);

// Lower concurrency (slower but lighter on network)
await resolveMultipleUrls(urls, 2);
```

---

## Logging & Monitoring

### Warning Logs

All fallback scenarios log warnings (not errors) so you can monitor resolution success rate:

```
⚠️  Request aborted (timeout) for URL: https://vertex...
⚠️  Network error for URL: https://vertex...
⚠️  Failed to resolve redirect URL: https://vertex...
⚠️  Keeping original URL (resolution failed): https://vertex...
```

### Success Logs

```
🔗 Resolving 9 Vertex AI redirect URLs...
✅ Resolved 9 URLs
✅ URLs resolved
```

### Monitoring Resolution Success Rate

To track how often resolution succeeds vs. fails, monitor these logs in your production environment.

---

## Production Behavior

### What Users See

**When Resolution Succeeds (99% of cases):**
- Clean, final destination URLs in citations
- Example: `johnwolfecompton.com/article`
- Correct domain extracted for brand tracking

**When Resolution Fails (rare):**
- Original Vertex redirect URL in citations
- Example: `vertexaisearch.cloud.google.com/grounding-api-redirect/...`
- Citation is still functional (links still work via redirect)
- Domain shows as `vertexaisearch.cloud.google.com`

### Impact on Brand Tracking

- **Success:** Accurate domain extraction for brand analysis
- **Failure:** Brand tracking may incorrectly attribute to Google

**Mitigation:** The original Vertex URL is stored in `original_vertex_url` field for debugging and potential retry logic.

---

## Testing

### Run Full Test Suite

```bash
# Test successful resolutions
node test-url-resolver.js

# Test fallback behaviors
node test-url-resolver-fallback.js
```

### Test Output

All tests should pass with these results:
- ✅ Non-Vertex URLs skipped
- ✅ Empty input handled safely
- ✅ Max redirects enforced
- ✅ Invalid URLs fallback to original
- ✅ Timeouts fallback to original
- ✅ No data loss on partial failures

---

## Best Practices

### 1. Don't Increase Timeout Too Much
- Long timeouts slow down the entire pipeline
- 5 seconds is usually sufficient
- Better to fail fast and keep original URL

### 2. Monitor Warning Logs
- Track resolution failure rate
- If failures spike, investigate:
  - Network connectivity issues
  - Vertex API changes
  - Rate limiting

### 3. Don't Retry in Application Code
- Resolver already has retry logic (HEAD → GET fallback)
- Retrying again could cause delays
- Better to accept original URL and log for analysis

### 4. Keep Concurrency Reasonable
- Default of 5 is balanced
- Too high = potential rate limiting
- Too low = slow batch processing

---

## Error Recovery Flow

```
URL Resolution Attempt
        ↓
    Is Vertex URL? ──No──→ Return Original (fast path)
        ↓ Yes
    Try HEAD Request (with timeout)
        ↓
    Success? ──No──→ Try GET Request
        ↓ Yes          ↓
    Follow Redirect    Success? ──No──→ Return Original URL
        ↓ Yes                              (Log Warning)
    Return Final URL ←─────────┘
```

---

## Summary

**The URL resolver is designed to be resilient and never break the citation flow.**

Key guarantees:
- ✅ Never throws unhandled errors
- ✅ Always returns valid citation data
- ✅ Falls back to original URL on any failure
- ✅ Logs warnings for monitoring
- ✅ No data loss in batch operations
- ✅ Configurable timeouts and limits
- ✅ Efficient (skips non-Vertex URLs)

**Worst case scenario:** Citations show Vertex redirect URLs instead of final URLs, but everything still works and no data is lost.
