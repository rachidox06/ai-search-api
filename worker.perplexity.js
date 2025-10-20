import { Worker } from 'bullmq';
import { normalizeResponse, normalizePerplexity } from './libs/normalize.js';
import { saveTrackingResult, savePromptRun } from './libs/persist.js';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, PERPLEXITY_API_KEY } = process.env;

// Function to query Perplexity API
async function queryPerplexity(prompt, model = 'sonar') {
  if (!PERPLEXITY_API_KEY) {
    throw new Error('Missing PERPLEXITY_API_KEY');
  }

  const url = 'https://api.perplexity.ai/chat/completions';

  const payload = {
    model: model,
    search_mode: 'web',
    messages: [
      {
        role: 'system',
        content: 'Be precise and concise.'
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
    prompt_id,
    prompt_text,
    locale = 'US',
    engine = 'perplexity',
    website_id,
    website_domain,
    brand_name,
    brand_aliases,
    // Legacy
    prompt,
    user_id,
    session_id
  } = jobData;

  const actualPrompt = prompt_text || prompt;

  console.log(`🚀 ${engine} job started:`, { 
    prompt_id, 
    prompt: actualPrompt?.substring(0, 50) + '...',
    locale,
    website_domain
  });
  
  // 1. Call Perplexity API (currently via DataForSEO or direct)
  const perplexityResponse = await queryPerplexity(actualPrompt);
  console.log('✅ Perplexity API response received');

  // NEW FLOW: For tracking with brand context
  if (prompt_id && website_domain) {
    try {
      // Convert to DataForSEO format if needed
      const dataforseoFormat = perplexityResponse.tasks ? perplexityResponse : {
        tasks: [{
          cost: perplexityResponse.usage?.cost?.total_cost || 0,
          result: [{
            text: extractAnswer(perplexityResponse),
            items: perplexityResponse.items,
            annotations: perplexityResponse.annotations,
            model: perplexityResponse.model
          }]
        }]
      };

      // 2. Normalize with brand analysis
      const normalized = normalizeResponse(
        'perplexity',
        dataforseoFormat,
        { website_domain, brand_name, brand_aliases },
        { locale }
      );
      
      // 3. Save to tracking table
      const saved = await saveTrackingResult(prompt_id, normalized);
      console.log('✅ Tracking result saved:', saved.id);
      
      // 4. Return result
      return {
        success: true,
        result_id: saved.id,
        engine: 'perplexity',
        was_mentioned: normalized.was_mentioned,
        sentiment: normalized.sentiment,
        ranking_position: normalized.ranking_position
      };
    } catch (error) {
      console.error('❌ Failed to save tracking result:', error.message);
      throw error;
    }
  }

  // LEGACY FLOW
  const answer = extractAnswer(perplexityResponse);
  const payload = {
    engine: 'perplexity',
    provider: 'perplexity',
    answer,
    raw: perplexityResponse,
    search_results: perplexityResponse.search_results || [],
    usage: perplexityResponse.usage || {}
  };

  try {
    const normalized = normalizePerplexity(
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

const worker = new Worker('prompt-perplexity', async job=>runJob(job.data), { 
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
