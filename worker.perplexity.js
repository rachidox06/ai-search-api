import { Worker } from 'bullmq';
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

async function runJob({prompt, locale='US'}){
  const perplexityResponse = await queryPerplexity(prompt);
  const answer = extractAnswer(perplexityResponse);

  return {
    engine: 'perplexity',
    provider: 'perplexity',
    answer,
    raw: perplexityResponse,
    search_results: perplexityResponse.search_results || [],
    usage: perplexityResponse.usage || {}
  };
}

new Worker('prompt-perplexity', async job=>runJob(job.data), { connection:{ host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD }});
console.log('worker.perplexity started (Perplexity API)');
