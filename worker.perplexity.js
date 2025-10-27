import { Worker } from 'bullmq';
import { normalizeResponse } from './libs/normalize.js';
import { saveTrackingResult } from './libs/persist.js';
import { queueBrandExtraction } from './libs/brandQueue.js';
import { mapLocationToISO, mapLocationToCoordinates } from './libs/locationMapping.js';
import { alertJobFailed, alertBrandExtractionNotQueued } from './libs/alerting.js';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, PERPLEXITY_API_KEY } = process.env;

// Function to query Perplexity API
async function queryPerplexity(prompt, location = 'United States', model = 'sonar') {
  if (!PERPLEXITY_API_KEY) {
    throw new Error('Missing PERPLEXITY_API_KEY');
  }

  const url = 'https://api.perplexity.ai/chat/completions';

  // Get ISO country code and coordinates for location
  const countryCode = mapLocationToISO(location);
  const coordinates = mapLocationToCoordinates(location);

  const payload = {
    model: model,
    search_mode: 'web',
    web_search_options: {
      user_location: {
        country: countryCode,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude
      }
    },
    messages: [
      {
        role: 'system',
        content: 'Provide detailed, well-researched answers and include citations to sources whenever possible.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Perplexity API failed: ${response.status} ${await response.text()}`);
  }

  return await response.json();
}

// Function to extract answer from Perplexity response
function extractAnswer(perplexityResponse) {
  if (perplexityResponse && perplexityResponse.choices && perplexityResponse.choices.length > 0) {
    const choice = perplexityResponse.choices[0];
    if (choice && choice.message) {
      return choice.message.content || null;
    }
  }
  return null;
}

async function runJob(jobData){
  const {
    prompt_id,       // REQUIRED: UUID from Next.js
    prompt_text,     // REQUIRED: The actual prompt
    location = 'United States', // Location name (e.g., "United States")
    locale = 'US',   // Deprecated: kept for backward compatibility
    engine = 'perplexity',
    website_id,
    website_domain,  // REQUIRED: for brand tracking
    brand_name,
    brand_aliases,
    user_id
  } = jobData;

  // Use location if provided, otherwise fall back to locale
  const searchLocation = location || (locale === 'US' ? 'United States' : locale);

  console.log(`🚀 ${engine} job started:`, {
    prompt_id,
    prompt: prompt_text?.substring(0, 50) + '...',
    location: searchLocation,
    website_domain
  });

  if (!prompt_id || !website_domain) {
    throw new Error('prompt_id and website_domain are required for tracking');
  }

  // 1. Call Perplexity API with location
  const perplexityResponse = await queryPerplexity(prompt_text, searchLocation);
  console.log('✅ Perplexity API response received');

  // Store the raw Perplexity API response (unmodified)
  const rawPerplexityResponse = perplexityResponse;

  // Extract citations from Perplexity response (they're at the top level, not in message)
  const citations = perplexityResponse?.citations || [];
  const citationsArray = Array.isArray(citations) ? citations : [];
  
  // Extract search_results for richer citation data
  const searchResults = perplexityResponse?.search_results || [];
  
  console.log('📚 Citations found:', citationsArray.length);
  console.log('🔍 Search results found:', searchResults.length);

  // Convert to DataForSEO format if needed
  const dataforseoFormat = perplexityResponse.tasks ? perplexityResponse : {
    tasks: [{
      cost: perplexityResponse.usage?.cost?.total_cost || 0,
      result: [{
        text: extractAnswer(perplexityResponse),
        items: perplexityResponse.items,
        citations: citationsArray,
        search_results: searchResults,
        model: perplexityResponse.model
      }]
    }]
  };

  // 2. Normalize with brand analysis (pass raw response separately)
  const normalized = await normalizeResponse(
    'perplexity',
    dataforseoFormat,
    { website_domain, brand_name, brand_aliases },
    { location: searchLocation },
    rawPerplexityResponse // Pass the unmodified raw Perplexity API response
  );
  
  // 3. Save to tracking table
  const saved = await saveTrackingResult(prompt_id, normalized);
  console.log('✅ Tracking result saved:', saved.id);
  
  // 4. Queue brand extraction
  const brandJobId = await queueBrandExtraction(
    saved.id,              // resultId
    normalized.answer_markdown, // answerText
    prompt_id,             // promptId
    website_id             // websiteId
  );
  
  // Alert if brand extraction was not queued
  if (!brandJobId) {
    await alertBrandExtractionNotQueued({
      resultId: saved.id,
      reason: normalized.answer_markdown ? 'queue_error' : 'empty_markdown'
    });
  }
  
  // 5. Return result
  return {
    success: true,
    result_id: saved.id,
    engine: 'perplexity',
    was_mentioned: normalized.was_mentioned,
    sentiment: normalized.sentiment,
    ranking_position: normalized.ranking_position
  };
}

const worker = new Worker('prompt-perplexity', async job=>runJob(job.data), { 
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
  console.error('❌ Worker error:', err);
});

worker.on('failed', async (job, err) => {
  console.error('❌ Job failed:', job.id, err.message);
  
  // Alert on final failure (after all retries)
  if (job && job.attemptsMade >= 3) {
    await alertJobFailed({
      engine: 'perplexity',
      promptId: job.data.prompt_id,
      jobId: job.id,
      error: err.message,
      attemptsMade: job.attemptsMade
    });
  }
});

worker.on('completed', (job) => {
  console.log('✅ Job completed:', job.id);
});

console.log('worker.perplexity started (Perplexity API) with concurrency: 10');
console.log('Connecting to Redis:', { host: REDIS_HOST, port: REDIS_PORT, hasPassword: !!REDIS_PASSWORD });

// Catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
