import { Worker } from 'bullmq';
import { normalizeResponse, normalizeDataforseoChatGPT } from './libs/normalize.js';
import { saveTrackingResult, savePromptRun } from './libs/persist.js';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, DATAFORSEO_USERNAME, DATAFORSEO_PASSWORD } = process.env;

// Helper function to create Basic Auth header
function createBasicAuthHeader(username, password) {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' };
}

// Function to query DataForSEO ChatGPT API
async function queryDataForSEOChatGPT(prompt, locale = 'US') {
  const url = 'https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced';

  // Map locale to location_code (DataForSEO format)
  const locationCodeMap = {
    'US': 2840,  // United States
    'UK': 2826,  // United Kingdom
    'CA': 2124,  // Canada
    'AU': 2036,  // Australia
    'DE': 2276,  // Germany
    'FR': 2250,  // France
    'JP': 2392   // Japan
  };

  const locationCode = locationCodeMap[locale] || 2840; // Default to US

  const payload = [{
    "language_code": "en",
    "location_code": locationCode,
    "keyword": encodeURI(prompt)
  }];

  const response = await fetch(url, {
    method: 'POST',
    headers: createBasicAuthHeader(DATAFORSEO_USERNAME, DATAFORSEO_PASSWORD),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API failed: ${response.status} ${await response.text()}`);
  }

  return await response.json();
}

// Function to extract answer from DataForSEO response
function extractAnswer(dataforseoResponse) {
  // Based on DataForSEO API response structure
  // Response structure: response['data']['tasks']
  if (dataforseoResponse && dataforseoResponse.tasks && dataforseoResponse.tasks.length > 0) {
    const task = dataforseoResponse.tasks[0];
    if (task && task.result && task.result.length > 0) {
      const result = task.result[0];
      // Try different possible fields for the answer
      return result.content || result.text || result.response || result.answer || null;
    }
  }
  return null;
}

async function runJob(jobData) {
  const {
    prompt_id,       // UUID from Next.js
    prompt_text,     // The actual prompt (support old format too)
    locale = 'US',   // 'US', 'UK', etc.
    engine = 'chatgpt',
    website_id,      // UUID
    website_domain,  // 'example.com'
    brand_name,      // 'Example'
    brand_aliases,   // ['Example Inc']
    // Legacy support
    prompt,
    user_id,
    session_id
  } = jobData;

  // Support both old and new formats
  const actualPrompt = prompt_text || prompt;
  
  console.log(`🚀 ${engine} job started:`, { 
    prompt_id, 
    prompt: actualPrompt?.substring(0, 50) + '...',
    locale,
    website_domain
  });
  
  if (!DATAFORSEO_USERNAME) throw new Error('Missing DATAFORSEO_USERNAME');
  if (!DATAFORSEO_PASSWORD) throw new Error('Missing DATAFORSEO_PASSWORD');

  // 1. Call DataForSEO API
  const dataforseoResponse = await queryDataForSEOChatGPT(actualPrompt, locale);
  console.log('✅ DataForSEO ChatGPT API response received');

  // NEW FLOW: Use new normalization if prompt_id exists
  if (prompt_id && website_domain) {
    try {
      // 2. Normalize response with brand analysis
      const normalized = normalizeResponse(
        'chatgpt',
        dataforseoResponse,
        { website_domain, brand_name, brand_aliases },
        { locale }
      );
      
      // 3. Save to new tracking table
      const saved = await saveTrackingResult(prompt_id, normalized);
      console.log('✅ Tracking result saved:', saved.id);
      
      // 4. Return result for job queue
      return {
        success: true,
        result_id: saved.id,
        engine: 'chatgpt',
        was_mentioned: normalized.was_mentioned,
        sentiment: normalized.sentiment,
        ranking_position: normalized.ranking_position
      };
    } catch (error) {
      console.error('❌ Failed to save tracking result:', error.message);
      throw error;
    }
  }

  // LEGACY FLOW: Use old normalization for backward compatibility
  const answer = extractAnswer(dataforseoResponse);
  const payload = {
    engine: 'chatgpt',
    provider: 'dataforseo',
    provider_response: dataforseoResponse,
    answer,
    raw: dataforseoResponse
  };

  try {
    const normalized = normalizeDataforseoChatGPT(
      { prompt: actualPrompt, user_id, session_id }, 
      payload
    );
    await savePromptRun(normalized);
    console.log('💾 Legacy data persisted to Supabase');
  } catch (error) {
    console.error('❌ Failed to persist to Supabase:', error.message);
  }

  return payload;
}

new Worker('prompt-chatgpt', async job => runJob(job.data), { 
  connection: { host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD },
  concurrency: 10
});
console.log('worker.chatgpt started (DataForSEO) with concurrency: 10');
