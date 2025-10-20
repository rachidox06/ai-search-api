import { Worker } from 'bullmq';
import { normalizeResponse } from './libs/normalize.js';
import { saveTrackingResult } from './libs/persist.js';

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
    prompt_id,       // REQUIRED: UUID from Next.js
    prompt_text,     // REQUIRED: The actual prompt
    locale = 'US',
    engine = 'chatgpt',
    website_id,
    website_domain,  // REQUIRED: for brand tracking
    brand_name,
    brand_aliases,
    user_id
  } = jobData;

  console.log(`🚀 ${engine} job started:`, { 
    prompt_id, 
    prompt: prompt_text?.substring(0, 50) + '...',
    locale,
    website_domain
  });
  
  if (!DATAFORSEO_USERNAME) throw new Error('Missing DATAFORSEO_USERNAME');
  if (!DATAFORSEO_PASSWORD) throw new Error('Missing DATAFORSEO_PASSWORD');
  if (!prompt_id || !website_domain) {
    throw new Error('prompt_id and website_domain are required for tracking');
  }

  // 1. Call DataForSEO API
  const dataforseoResponse = await queryDataForSEOChatGPT(prompt_text, locale);
  console.log('✅ DataForSEO ChatGPT API response received');

  // 2. Normalize response with brand analysis
  const normalized = normalizeResponse(
    'chatgpt',
    dataforseoResponse,
    { website_domain, brand_name, brand_aliases },
    { locale }
  );
  
  // 3. Save to tracking table
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
}

new Worker('prompt-chatgpt', async job => runJob(job.data), { 
  connection: { host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD },
  concurrency: 10
});
console.log('worker.chatgpt started (DataForSEO) with concurrency: 10');
