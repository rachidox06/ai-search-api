import { Worker } from 'bullmq';
import { normalizePerplexity } from './libs/normalize.js';
import { savePromptRun } from './libs/persist.js';

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

async function runJob({prompt, locale='US', user_id, session_id}){
  console.log('🚀 Perplexity job started:', { prompt: prompt.substring(0, 50) + '...', locale, has_user_id: !!user_id, has_session_id: !!session_id });
  
  const perplexityResponse = await queryPerplexity(prompt);
  const answer = extractAnswer(perplexityResponse);
  console.log('✅ Perplexity API response received');

  const payload = {
    engine: 'perplexity',
    provider: 'perplexity',
    answer,
    raw: perplexityResponse,
    search_results: perplexityResponse.search_results || [],
    usage: perplexityResponse.usage || {}
  };

  // Normalize and persist to Supabase
  try {
    const normalized = normalizePerplexity({ prompt, user_id, session_id }, payload);
    await savePromptRun(normalized);
    console.log('💾 Data persisted to Supabase');
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
