import { Worker } from 'bullmq';

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

async function runJob({ prompt, locale = 'US' }) {
  if (!DATAFORSEO_USERNAME) throw new Error('Missing DATAFORSEO_USERNAME');
  if (!DATAFORSEO_PASSWORD) throw new Error('Missing DATAFORSEO_PASSWORD');

  const dataforseoResponse = await queryDataForSEOChatGPT(prompt, locale);
  const answer = extractAnswer(dataforseoResponse);

  return {
    engine: 'chatgpt',
    provider: 'dataforseo',
    provider_response: dataforseoResponse,
    answer,
    raw: dataforseoResponse
  };
}

new Worker('prompt-chatgpt', async job => runJob(job.data), { connection:{ host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD }});
console.log('worker.chatgpt started (DataForSEO)');
