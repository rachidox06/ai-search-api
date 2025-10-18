import { Worker } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, GEMINI_API_KEY } = process.env;

// Function to query Google Gemini API
async function queryGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();

  return text;
}

async function runJob({prompt, locale='US'}) {
  const answer = await queryGemini(prompt);

  return {
    engine: 'gemini',
    provider: 'google',
    answer,
    raw: answer
  };
}

new Worker('prompt-gemini', async job=>runJob(job.data), { connection:{ host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD }});
console.log('worker.gemini started (Google API)');
