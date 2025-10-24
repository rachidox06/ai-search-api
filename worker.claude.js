import { Worker } from 'bullmq';
import OpenAI from 'openai';
import { normalizeResponse } from './libs/normalize.js';
import { saveTrackingResult } from './libs/persist.js';
import { queueBrandExtraction } from './libs/brandQueue.js';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, OPENROUTER_API_KEY } = process.env;

// Function to query Claude via OpenRouter API
async function queryClaude(prompt, model = 'anthropic/claude-4.5-sonnet') {
  if (!OPENROUTER_API_KEY) {
    throw new Error('Missing OPENROUTER_API_KEY');
  }

  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: OPENROUTER_API_KEY,
  });

  const completion = await client.chat.completions.create({
    extra_headers: {
      "HTTP-Referer": "https://ai-search-api.com", // Optional: for OpenRouter rankings
      "X-Title": "AI Search API", // Optional: for OpenRouter rankings
    },
    model: model,
    messages: [
      {
        role: "system",
        content: "You are a helpful AI assistant with access to current information. Provide comprehensive, well-researched answers with specific facts and data. ALWAYS include citations and sources when making factual claims. Format sources as [Source: URL or publication name]. Include relevant URLs when available. Be thorough but concise."
      },
      {
        role: "user",
        content: `${prompt}\n\nPlease provide detailed citations and sources for all factual claims in your response.`
      }
    ],
    temperature: 0.1, // Lower temperature for more factual responses
    max_tokens: 4096, // Allow longer responses
  });

  const response = completion.choices[0].message.content;
  
  // Extract URLs from the response
  const urlRegex = /https?:\/\/[^\s\)\]]+/g;
  const urls = response.match(urlRegex) || [];
  
  // Extract citation patterns like [Source: ...] or [1] or (Source: ...)
  const citationRegex = /\[(?:Source:|Ref:|Citation:)?\s*([^\]]+)\]|\((?:Source:|Ref:|Citation:)\s*([^)]+)\)/gi;
  const citationMatches = [...response.matchAll(citationRegex)];
  
  // Combine URLs and citation text to create sources
  const sources = [];
  const seenUrls = new Set();
  
  // Add URLs as sources
  urls.forEach((url, index) => {
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({
        url: url,
        title: `Source ${sources.length + 1}`,
        citation_number: sources.length + 1
      });
    }
  });
  
  // Add citation text as sources (for non-URL citations)
  citationMatches.forEach((match) => {
    const citationText = match[1] || match[2];
    if (citationText && !citationText.startsWith('http') && citationText.length > 5) {
      sources.push({
        url: null,
        title: citationText.trim(),
        citation_number: sources.length + 1,
        type: 'text_citation'
      });
    }
  });

  return {
    text: response,
    originalText: response,
    sources: sources,
    model: model,
    usage: completion.usage
  };
}

async function runJob(jobData) {
  const {
    prompt_id,       // REQUIRED: UUID from Next.js
    prompt_text,     // REQUIRED: The actual prompt
    locale = 'US',
    engine = 'claude',
    website_id,
    website_domain,  // REQUIRED: for brand tracking
    brand_name,
    brand_aliases,
    user_id,
    model = 'anthropic/claude-4.5-sonnet' // Default Claude model
  } = jobData;

  console.log(`🚀 ${engine} job started:`, { 
    prompt_id, 
    prompt: prompt_text?.substring(0, 50) + '...',
    locale,
    website_domain,
    model
  });
  
  if (!prompt_id || !website_domain) {
    throw new Error('prompt_id and website_domain are required for tracking');
  }
  
  // 1. Call Claude via OpenRouter API
  const result = await queryClaude(prompt_text, model);
  console.log('✅ Claude API response received via OpenRouter:', { 
    model: result.model,
    sources_count: result.sources?.length || 0,
    tokens_used: result.usage?.total_tokens || 0
  });

  // Convert Claude response to DataForSEO-like format for normalization
  const dataforseoFormat = {
    tasks: [{
      cost: result.usage?.total_tokens ? (result.usage.total_tokens * 0.00001) : 0, // Rough cost estimate
      result: [{
        markdown: result.text,
        answer: result.text,
        sources: result.sources,
        citations: result.sources.map((source, index) => ({
          number: index + 1,
          url: source.url,
          title: source.title,
          text: `Citation ${index + 1}`
        })),
        model: result.model
      }]
    }]
  };

  // 2. Normalize with brand analysis
  const normalized = await normalizeResponse(
    'claude',
    dataforseoFormat,
    { website_domain, brand_name, brand_aliases },
    { locale }
  );
  
  // 3. Save to tracking table
  const saved = await saveTrackingResult(prompt_id, normalized);
  console.log('✅ Tracking result saved:', saved.id);
  
  // 4. Queue brand extraction
  await queueBrandExtraction(
    saved.id,              // resultId
    normalized.answer_text, // answerText
    prompt_id,             // promptId
    website_id             // websiteId
  );
  
  // 5. Return result
  return {
    success: true,
    result_id: saved.id,
    engine: 'claude',
    model: result.model,
    was_mentioned: normalized.was_mentioned,
    sentiment: normalized.sentiment,
    ranking_position: normalized.ranking_position,
    tokens_used: result.usage?.total_tokens || 0
  };
}

const worker = new Worker('prompt-claude', async job => runJob(job.data), { 
  connection: {
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
    password: REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: null,
  },
  concurrency: 10
});

worker.on('error', (err) => {
  console.error('❌ Claude Worker error:', err);
});

worker.on('failed', (job, err) => {
  console.error('❌ Claude Job failed:', job.id, err.message);
});

worker.on('completed', (job) => {
  console.log('✅ Claude Job completed:', job.id);
});

console.log('worker.claude started (Claude via OpenRouter) with concurrency: 10');
console.log('Connecting to Redis:', { host: REDIS_HOST, port: REDIS_PORT, hasPassword: !!REDIS_PASSWORD });

// Catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
