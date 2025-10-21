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
    }
    else if (engine === 'perplexity') {
      // Perplexity from llm_responses
      const text = result?.items?.[0]?.sections?.[0]?.text || result?.text || '';
      answer_text = removeThinkingTags(text);
      answer_markdown = answer_text;
      
      model = result?.model || 'sonar-reasoning';
      apiCost = task?.cost || 0;
    }
    else if (engine === 'gemini') {
      // Gemini normalization
      answer_markdown = result?.markdown || result?.answer || '';
      answer_text = stripMarkdown(answer_markdown);
      
      model = result?.model || 'gemini-2.5-flash';
      apiCost = task?.cost || 0;
    }
    else if (engine === 'google') {
      // Google AI (DataForSEO) response structure
      const result = task.result[0];
      answer_text = result?.items?.map(i => i.text).join('\n\n') || '';
      answer_markdown = answer_text; // Google AI doesn't provide markdown
      model = result?.model || 'google-ai';
      apiCost = task?.cost || 0;
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
      extra: {}
    };
  } catch (error) {
    console.error('❌ Normalization error:', error);
    throw error;
  }
}

// ============================================================================
// END OF NORMALIZE.JS - Legacy functions removed
// ============================================================================
