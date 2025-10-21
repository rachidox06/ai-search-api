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

// Check if brand was mentioned (name or aliases)
const checkBrandMention = (text, brandContext) => {
  if (!text || !brandContext) return false;
  const lowerText = text.toLowerCase();
  const brandName = (brandContext.brand_name || '').toLowerCase();
  const aliases = (brandContext.brand_aliases || []).map(a => a.toLowerCase());
  
  if (brandName && lowerText.includes(brandName)) return true;
  return aliases.some(alias => alias && lowerText.includes(alias));
};

// Analyze sentiment when brand is mentioned
const analyzeSentiment = (text, brandContext) => {
  if (!text || !brandContext) return 'neutral';
  
  const lowerText = text.toLowerCase();
  const brandName = (brandContext.brand_name || '').toLowerCase();
  
  // Find context around brand mention
  const brandIndex = lowerText.indexOf(brandName);
  if (brandIndex === -1) return 'neutral';
  
  // Get 100 chars before and after brand mention
  const contextStart = Math.max(0, brandIndex - 100);
  const contextEnd = Math.min(lowerText.length, brandIndex + brandName.length + 100);
  const context = lowerText.substring(contextStart, contextEnd);
  
  // Positive indicators
  const positiveWords = ['best', 'great', 'excellent', 'top', 'leading', 'innovative', 'recommended', 'popular', 'trusted', 'quality'];
  const positiveCount = positiveWords.filter(word => context.includes(word)).length;
  
  // Negative indicators
  const negativeWords = ['worst', 'bad', 'poor', 'avoid', 'issue', 'problem', 'difficult', 'disappointing'];
  const negativeCount = negativeWords.filter(word => context.includes(word)).length;
  
  if (positiveCount > negativeCount && positiveCount > 0) return 'positive';
  if (negativeCount > positiveCount && negativeCount > 0) return 'negative';
  return 'neutral';
};

// Extract ranking position from text
const extractRankingPosition = (text, citations, brandContext) => {
  if (!brandContext?.website_domain) return null;
  
  // Check citations for brand's website
  const brandCitation = citations.findIndex(c => 
    c.domain === brandContext.website_domain || 
    c.url?.includes(brandContext.website_domain)
  );
  
  if (brandCitation >= 0) return brandCitation + 1;
  
  // Check for explicit ranking mentions in text
  const rankingPatterns = [
    new RegExp(`(\\d+)[.,]?\\s+${brandContext.brand_name}`, 'i'),
    new RegExp(`#(\\d+).*${brandContext.brand_name}`, 'i'),
    new RegExp(`${brandContext.brand_name}.*ranked\\s+(\\d+)`, 'i')
  ];
  
  for (const pattern of rankingPatterns) {
    const match = text.match(pattern);
    if (match) return parseInt(match[1]);
  }
  
  return null;
};

// ============================================================================
// NEW UNIVERSAL NORMALIZATION FUNCTION
// ============================================================================

export function normalizeResponse(engine, dataforseoResponse, brandContext, jobData = {}) {
  const startTime = Date.now();
  
  let answer_text = '';
  let answer_markdown = '';
  let citations = [];
  let model = '';
  let apiCost = 0;
  
  try {
    const task = dataforseoResponse?.tasks?.[0];
    const result = task?.result?.[0];
    
    if (engine === 'chatgpt') {
      // ChatGPT from LLM Scraper
      answer_markdown = result?.markdown || result?.items?.[0]?.markdown || '';
      answer_text = stripMarkdown(answer_markdown);
      
      const sources = result?.sources || result?.items?.[0]?.sources || [];
      citations = sources.map((source, idx) => ({
        number: idx + 1,
        url: source.url || '',
        title: source.title || '',
        domain: extractDomain(source.url || ''),
        snippet: source.snippet || '',
        is_own_website: extractDomain(source.url || '') === brandContext.website_domain
      }));
      
      model = result?.model || 'gpt-4o-mini';
      apiCost = task?.cost || 0;
    }
    else if (engine === 'perplexity') {
      // Perplexity from llm_responses
      const text = result?.items?.[0]?.sections?.[0]?.text || result?.text || '';
      answer_text = removeThinkingTags(text);
      answer_markdown = answer_text;
      
      const annotations = result?.items?.[0]?.sections?.[0]?.annotations || result?.annotations || [];
      citations = annotations.map((ann, idx) => ({
        number: idx + 1,
        url: ann.url || '',
        title: ann.title || '',
        domain: extractDomain(ann.url || ''),
        snippet: ann.snippet || '',
        is_own_website: extractDomain(ann.url || '') === brandContext.website_domain
      }));
      
      model = result?.model || 'sonar-reasoning';
      apiCost = task?.cost || 0;
    }
    else if (engine === 'gemini') {
      // Gemini normalization
      answer_markdown = result?.markdown || result?.answer || '';
      answer_text = stripMarkdown(answer_markdown);
      
      const sources = result?.sources || [];
      citations = sources.map((source, idx) => ({
        number: idx + 1,
        url: source.url || '',
        title: source.title || '',
        domain: extractDomain(source.url || ''),
        snippet: source.snippet || '',
        is_own_website: extractDomain(source.url || '') === brandContext.website_domain
      }));
      
      model = result?.model || 'gemini-2.5-flash';
      apiCost = task?.cost || 0;
    }
    else if (engine === 'google') {
      // Google AI Mode normalization - extract from nested items[0]
      const aiOverview = result?.items?.[0];
      answer_markdown = aiOverview?.markdown || '';
      answer_text = stripMarkdown(answer_markdown);
      
      const references = aiOverview?.references || [];
      citations = references.map((ref, idx) => ({
        number: idx + 1,
        url: ref.url || '',
        title: ref.title || '',
        domain: extractDomain(ref.url || ''),
        snippet: ref.snippet || ref.text || '',
        is_own_website: extractDomain(ref.url || '') === brandContext.website_domain
      }));
      
      model = result?.model || 'google-ai';
      apiCost = task?.cost || 0;
    }
    
    // Brand mention analysis
    const was_mentioned = checkBrandMention(answer_text, brandContext);
    const sentiment = was_mentioned ? analyzeSentiment(answer_text, brandContext) : 'none';
    const ranking_position = extractRankingPosition(answer_text, citations, brandContext);
    
  return {
      // Core fields
      engine,
      model,
      checked_at: new Date().toISOString(),
      
      // Content fields
      answer_text,
      answer_markdown,
      answer_length: answer_text.length,
      
      // Analysis fields
      was_mentioned,
      sentiment,
      ranking_position,
      
      // Citation fields
      total_citations: citations.length,
      citations,
      
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
