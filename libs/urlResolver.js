/**
 * URL Redirect Resolver Utility
 *
 * Resolves redirect URLs (like Vertex AI Search redirects) to their final destination.
 * Specifically designed to handle Gemini's vertexaisearch.cloud.google.com redirect URLs.
 */

/**
 * Follows a redirect URL to get the final destination
 * @param {string} url - The URL to resolve
 * @param {number} maxRedirects - Maximum number of redirects to follow (default: 5)
 * @param {number} timeout - Request timeout in milliseconds (default: 5000)
 * @returns {Promise<string>} The final resolved URL (returns original URL if resolution fails)
 */
export async function resolveRedirectUrl(url, maxRedirects = 5, timeout = 5000) {
  // Skip resolution if not a Vertex AI redirect URL
  if (!url || !url.includes('vertexaisearch.cloud.google.com')) {
    return url;
  }

  // Prevent infinite recursion
  if (maxRedirects <= 0) {
    console.warn(`⚠️  Max redirects reached for URL: ${url.substring(0, 100)}...`);
    return url; // Fallback: return original URL
  }

  let controller = null;
  let timeoutId = null;

  try {
    // Setup timeout abort controller
    controller = new AbortController();
    timeoutId = setTimeout(() => {
      console.warn(`⚠️  Timeout (${timeout}ms) reached for URL: ${url.substring(0, 100)}...`);
      controller.abort();
    }, timeout);

    // Try HEAD request first (faster, no content download)
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual', // Handle redirects manually to track the chain
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; URLResolver/1.0)' // Some servers require User-Agent
      }
    });

    clearTimeout(timeoutId);

    // If we get a redirect status (3xx), follow the Location header
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        try {
          // If location is relative, make it absolute
          const resolvedLocation = new URL(location, url).href;

          // Recursively follow redirects
          return await resolveRedirectUrl(resolvedLocation, maxRedirects - 1, timeout);
        } catch (urlError) {
          console.warn(`⚠️  Invalid redirect location: ${location}`, urlError.message);
          return url; // Fallback: return original URL
        }
      } else {
        console.warn(`⚠️  Redirect status ${response.status} but no Location header`);
        return url; // Fallback: return original URL
      }
    }

    // If HEAD request didn't return a redirect, try GET as fallback
    // Some servers (including Google) might not respond properly to HEAD requests
    if (response.status !== 200) {
      // Setup new timeout for GET request
      controller = new AbortController();
      timeoutId = setTimeout(() => {
        console.warn(`⚠️  GET timeout (${timeout}ms) reached for URL: ${url.substring(0, 100)}...`);
        controller.abort();
      }, timeout);

      const getResponse = await fetch(url, {
        method: 'GET',
        redirect: 'follow', // Let fetch handle redirects automatically
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; URLResolver/1.0)'
        }
      });

      clearTimeout(timeoutId);

      // The response.url will be the final URL after all redirects
      if (getResponse.url && getResponse.url !== url) {
        return getResponse.url;
      }
    }

    return url; // Fallback: return original if no redirect was found
  } catch (error) {
    // Clear timeout if it exists
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Handle specific error types
    if (error.name === 'AbortError') {
      console.warn(`⚠️  Request aborted (timeout) for URL: ${url.substring(0, 100)}...`);
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.warn(`⚠️  Network error for URL: ${url.substring(0, 100)}...`, error.message);
    } else {
      console.warn(`⚠️  Failed to resolve redirect URL: ${url.substring(0, 100)}...`, error.message);
    }

    // Fallback: Always return original URL on any error
    return url;
  }
}

/**
 * Resolves multiple URLs in parallel with a concurrency limit
 * @param {Array<string>} urls - Array of URLs to resolve
 * @param {number} concurrency - Maximum number of concurrent requests (default: 5)
 * @returns {Promise<Map<string, string>>} Map of original URL to resolved URL
 */
export async function resolveMultipleUrls(urls, concurrency = 5) {
  const results = new Map();
  const queue = [...urls];

  // Process URLs in batches with limited concurrency
  const processUrl = async (url) => {
    try {
      const resolved = await resolveRedirectUrl(url);
      results.set(url, resolved);
    } catch (error) {
      // Fallback: If individual resolution fails, store original URL
      console.warn(`⚠️  Failed to process URL in batch: ${url.substring(0, 100)}...`, error.message);
      results.set(url, url);
    }
  };

  // Process in batches
  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    // Use allSettled to ensure all promises complete even if some fail
    await Promise.allSettled(batch.map(processUrl));
  }

  return results;
}

/**
 * Resolves redirect URLs in citation objects
 * @param {Array<Object>} citations - Array of citation objects with url field
 * @returns {Promise<Array<Object>>} Citations with resolved URLs (fallback to original on error)
 */
export async function resolveCitationUrls(citations) {
  // Validate input
  if (!citations || !Array.isArray(citations) || citations.length === 0) {
    return citations;
  }

  try {
    // Extract unique URLs that need resolution
    const vertexUrls = citations
      .map(c => c.url)
      .filter(url => url && url.includes('vertexaisearch.cloud.google.com'));

    // If no Vertex URLs, return original citations
    if (vertexUrls.length === 0) {
      return citations;
    }

    console.log(`🔗 Resolving ${vertexUrls.length} Vertex AI redirect URLs...`);

    // Resolve all URLs in parallel
    const resolvedUrlMap = await resolveMultipleUrls(vertexUrls);

    console.log(`✅ Resolved ${resolvedUrlMap.size} URLs`);

    // Update citations with resolved URLs
    return citations.map(citation => {
      if (citation.url && resolvedUrlMap.has(citation.url)) {
        const resolvedUrl = resolvedUrlMap.get(citation.url);

        // Only update if resolution was successful (URL changed)
        if (resolvedUrl && resolvedUrl !== citation.url) {
          return {
            ...citation,
            url: resolvedUrl,
            domain: extractDomainFromUrl(resolvedUrl),
            original_vertex_url: citation.url // Keep the original for debugging
          };
        } else {
          // Resolution failed or timed out, keep original
          console.warn(`⚠️  Keeping original URL (resolution failed): ${citation.url.substring(0, 80)}...`);
          return citation;
        }
      }
      return citation;
    });
  } catch (error) {
    // Fallback: If entire resolution process fails, return original citations
    console.error(`❌ Critical error in resolveCitationUrls, returning original citations:`, error.message);
    return citations;
  }
}

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} Domain name without www
 */
function extractDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}
