import { Worker } from 'bullmq';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, OXYLABS_USERNAME, OXYLABS_PASSWORD } = process.env;

// Helper function to create Basic Auth header
function createBasicAuthHeader(username, password) {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' };
}

// Function to query Oxylabs ChatGPT API
async function queryOxylabsChatGPT(prompt, locale = 'US') {
  const url = 'https://realtime.oxylabs.io/v1/queries';

  // Map locale to geo_location format (you may need to adjust this mapping)
  const geoLocationMap = {
    'US': 'United States',
    'UK': 'United Kingdom',
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'JP': 'Japan'
  };

  const geoLocation = geoLocationMap[locale] || 'United States';

  const payload = {
    source: 'chatgpt',
    prompt: prompt,
    parse: true,
    search: true,
    geo_location: geoLocation
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: createBasicAuthHeader(OXYLABS_USERNAME, OXYLABS_PASSWORD),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Oxylabs API failed: ${response.status} ${await response.text()}`);
  }

  return await response.json();
}

// Function to extract answer from Oxylabs response
function extractAnswer(oxylabsResponse) {
  // Based on Oxylabs ChatGPT response structure
  // You may need to adjust this based on the actual response format
  if (oxylabsResponse && oxylabsResponse.results && oxylabsResponse.results.length > 0) {
    const result = oxylabsResponse.results[0];
    // Try different possible fields for the answer
    return result.content || result.text || result.response || result.answer || null;
  }
  return null;
}

async function runJob({ prompt, locale = 'US' }) {
  if (!OXYLABS_USERNAME) throw new Error('Missing OXYLABS_USERNAME');
  if (!OXYLABS_PASSWORD) throw new Error('Missing OXYLABS_PASSWORD');

  const oxylabsResponse = await queryOxylabsChatGPT(prompt, locale);
  const answer = extractAnswer(oxylabsResponse);

  return {
    engine: 'chatgpt',
    provider: 'oxylabs',
    provider_response: oxylabsResponse,
    answer,
    raw: oxylabsResponse
  };
}

new Worker('prompt-chatgpt', async job => runJob(job.data), { connection:{ host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD }});
console.log('worker.chatgpt started (Oxylabs)');
