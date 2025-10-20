import { Worker } from 'bullmq';
import { normalizeDataforseoGoogle } from './libs/normalize.js';
import { savePromptRun } from './libs/persist.js';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, DATAFORSEO_USERNAME, DATAFORSEO_PASSWORD } = process.env;

// Helper function to create Basic Auth header
function createBasicAuthHeader(username, password) {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' };
}
// Function to query DataForSEO Google AI Mode API
async function queryDataForSEOGoogleAI(prompt, locale = 'US') {
  const url = 'https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced';

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
async function runJob({prompt, locale='US', user_id, session_id}){
  console.log('🚀 Google job started:', { prompt: prompt.substring(0, 50) + '...', locale, has_user_id: !!user_id, has_session_id: !!session_id });
  
  if (!DATAFORSEO_USERNAME) throw new Error('Missing DATAFORSEO_USERNAME');
  if (!DATAFORSEO_PASSWORD) throw new Error('Missing DATAFORSEO_PASSWORD');

  const dataforseoResponse = await queryDataForSEOGoogleAI(prompt, locale);
  const answer = extractAnswer(dataforseoResponse);
  console.log('✅ DataForSEO Google API response received');

  const payload = {
    engine: 'google',
    provider: 'dataforseo',
    provider_response: dataforseoResponse,
    answer,
    raw: dataforseoResponse
  };

  // Normalize and persist to Supabase
  try {
    const normalized = normalizeDataforseoGoogle({ prompt, user_id, session_id }, payload);
    await savePromptRun(normalized);
    console.log('💾 Data persisted to Supabase');
  } catch (error) {
    console.error('❌ Failed to persist to Supabase:', error.message);
  }

  return payload;
}
const worker = new Worker('prompt-google', async job=>runJob(job.data), { 
  connection: { host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD },
  concurrency: 10
});

worker.on('error', (err) => {
  console.error('❌ Worker error:', err);
});

worker.on('failed', (job, err) => {
  console.error('❌ Job failed:', job.id, err.message);
});

worker.on('completed', (job) => {
  console.log('✅ Job completed:', job.id);
});

console.log('worker.google started (DataForSEO) with concurrency: 10');
console.log('Connecting to Redis:', { host: REDIS_HOST, port: REDIS_PORT, hasPassword: !!REDIS_PASSWORD });

// Catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
