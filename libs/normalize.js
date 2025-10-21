// ESM

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return undefined; } };
const secsToMs = (s) => {
  if (s === undefined || s === null) return undefined;
  if (typeof s === 'number') return Math.round(s * 1000);
  const m = String(s).match(/([\d.]+)/);
  return m ? Math.round(parseFloat(m[1]) * 1000) : undefined;
};

// Extract domain from URL
const extractDomain = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
};

// Strip markdown to plain text (simple version)
const stripMarkdown = (markdown) => {
  if (!markdown) return '';
  return markdown
    .replace(/^#{1,6}\s+/gm, '') // Remove headers
    .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.+?)\*/g, '$1') // Remove italic
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
    .replace(/`(.+?)`/g, '$1') // Remove inline code
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .trim();
};

// Remove <thinking> tags from Perplexity responses
const removeThinkingTags = (text) => {
  if (!text) return '';
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
};

/**
 * Normalizes responses from different AI providers into a consistent format.
 * - Extracts core content (text, markdown)
 */
export function normalizeResponse(engine, dataforseoResponse, brandContext, jobData = {}) {
  const startTime = Date.now();
  
  let answer_text = '';
  let answer_markdown = '';
  let model = '';
  let apiCost = 0;
  
  try {
    const task = dataforseoResponse?.tasks?.[0];
    const result = task?.result?.[0];
    
    if (engine === 'chatgpt') {
      // ChatGPT from LLM Scraper
      answer_markdown = result?.markdown || result?.items?.[0]?.markdown || '';
      answer_text = stripMarkdown(answer_markdown);
      
      model = result?.model || 'gpt-4o-mini';
      apiCost = task?.cost || 0;
      
      // Extract citations from ChatGPT response
      // DataForSEO might provide citations/sources/references at different levels
      const sourcesData = result?.sources || result?.references || result?.citations || 
                         result?.items?.[0]?.sources || result?.items?.[0]?.references || [];
      
      if (sourcesData && Array.isArray(sourcesData) && sourcesData.length > 0) {
        const citations = [];
        const seenUrls = new Set();
        
        sourcesData.forEach((source, index) => {
          const url = source.url || source.uri || source.link;
          if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            citations.push({
              number: index + 1,
              url: url,
              title: source.title || '',
              domain: extractDomain(url),
              text: source.text || source.snippet || source.description || ''
            });
          }
        });
        
        if (citations.length > 0) {
          extra.citations = citations;
          extra.citations_count = citations.length;
        }
      }
    }
    else if (engine === 'perplexity') {
      // Perplexity from llm_responses
      const text = result?.items?.[0]?.sections?.[0]?.text || result?.text || '';
      answer_text = removeThinkingTags(text);
      answer_markdown = answer_text;
      
      model = result?.model || 'sonar-reasoning';
      apiCost = task?.cost || 0;
      
      // Extract citations from Perplexity response
      if (result?.citations && Array.isArray(result.citations) && result.citations.length > 0) {
        const citations = [];
        const seenUrls = new Set();
        
        result.citations.forEach((citation, index) => {
          const url = citation.url || citation.uri;
          if (url && !seenUrls.has(url)) {
            seenUrls.add(url);
            citations.push({
              number: index + 1,
              url: url,
              title: citation.title || '',
              domain: extractDomain(url),
              text: citation.text || citation.snippet || ''
            });
          }
        });
        
        if (citations.length > 0) {
          extra.citations = citations;
          extra.citations_count = citations.length;
        }
      }
    }
    else if (engine === 'gemini') {
      // Gemini normalization
      answer_markdown = result?.markdown || result?.answer || '';
      answer_text = stripMarkdown(answer_markdown);
      
      model = result?.model || 'gemini-2.5-flash';
      apiCost = task?.cost || 0;
      
      // Extract citations from Gemini response
      if (result?.citations && Array.isArray(result.citations) && result.citations.length > 0) {
        extra.citations = result.citations.map(citation => ({
          number: citation.number,
          url: citation.url,
          title: citation.title || '',
          text: citation.text || '',
          domain: extractDomain(citation.url)
        }));
        extra.citations_count = extra.citations.length;
      }
    }
    else if (engine === 'google') {
      // Google AI (DataForSEO) response structure
      // Response has result.markdown with full formatted answer
      // And result.items[0].items[] array with individual elements

      // Primary: Use the full markdown field (contains complete formatted response)
      answer_markdown = result?.markdown || '';

      // Fallback: If no markdown, try to extract from nested items structure
      if (!answer_markdown && result?.items?.[0]?.items) {
        const elements = result.items[0].items;
        // Extract text from nested ai_overview_element items
        answer_text = elements.map(el => el.text || '').filter(Boolean).join('\n\n');
        answer_markdown = elements.map(el => el.markdown || el.text || '').filter(Boolean).join('\n\n');
      } else {
        // Strip markdown to get plain text
        answer_text = stripMarkdown(answer_markdown);
      }

      model = result?.model || 'google-ai';
      apiCost = task?.cost || 0;
    }

    // Prepare extra data based on engine
    const extra = {};

    // For Google: Add citations if extracted
    if (engine === 'google') {
      // Extract citations/references from Google AI response
      // References can appear at two levels:
      // 1. Overview level: result.items[0].references
      // 2. Element level: result.items[0].items[].references
      const citations = [];
      const seenUrls = new Set();

      if (result?.items?.[0]) {
        const overview = result.items[0];

        // Collect overview-level references
        if (overview.references && Array.isArray(overview.references)) {
          overview.references.forEach(ref => {
            if (ref.url && !seenUrls.has(ref.url)) {
              seenUrls.add(ref.url);
              citations.push({
                url: ref.url,
                title: ref.title || '',
                domain: ref.domain || '',
                source: ref.source || '',
                text: ref.text || ''
              });
            }
          });
        }

        // Collect element-level references
        if (overview.items && Array.isArray(overview.items)) {
          overview.items.forEach(item => {
            if (item.references && Array.isArray(item.references)) {
              item.references.forEach(ref => {
                if (ref.url && !seenUrls.has(ref.url)) {
                  seenUrls.add(ref.url);
                  citations.push({
                    url: ref.url,
                    title: ref.title || '',
                    domain: ref.domain || '',
                    source: ref.source || '',
                    text: ref.text || ''
                  });
                }
              });
            }
          });
        }
      }

      // Add citations to extra if found
      if (citations.length > 0) {
        extra.citations = citations;
        extra.citations_count = citations.length;
      }
    }

    // Brand mention analysis

  return {
      // Core fields
      engine,
      model,
      checked_at: new Date().toISOString(),

      // Content fields
      answer_text,
      answer_markdown,
      answer_length: answer_text.length,

      // Provider fields
      provider: 'dataforseo',
      cost: apiCost,
      provider_raw: dataforseoResponse,

      // Metadata
      metadata: {
        locale: jobData.locale || 'US',
        execution_time_ms: Date.now() - startTime,
        api_version: 'v3'
      },

      // Extra (for engine-specific data)
      extra
    };
  } catch (error) {
    console.error('❌ Normalization error:', error);
    throw error;
  }
}

// ============================================================================
// END OF NORMALIZE.JS - Legacy functions removed
// ============================================================================
