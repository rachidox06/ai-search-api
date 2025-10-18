import { Worker } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, GEMINI_API_KEY } = process.env;

// Function to query Google Gemini API
async function queryGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

  // Use gemini-2.5-flash for search capabilities and citations
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.1,  // Lower temperature for more factual responses
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 4096,  // Allow longer responses
    },
    tools: [{
      google_search: {}
    }],
    systemInstruction: "You are a helpful AI assistant with access to Google Search. When answering questions, provide comprehensive, well-researched answers with specific facts, data, and citations from reliable sources. Include links to your sources whenever possible. Be thorough but concise."
  });

  const result = await model.generateContent(prompt);
  const response = await result.response;

  // Extract text and any grounding metadata
  const text = response.text();
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

  return {
    text: text,
    groundingMetadata: groundingMetadata,
    sources: groundingMetadata?.groundingSupports?.map(support => ({
      uri: support.uri,
      title: support.title,
      segment: support.segment
    })) || []
  };
}

async function runJob({prompt, locale='US'}) {
  const result = await queryGemini(prompt);

  return {
    engine: 'gemini',
    provider: 'google',
    answer: result.text,
    raw: result,
    search_results: result.sources || [],
    citations: result.sources || []
  };
}

new Worker('prompt-gemini', async job=>runJob(job.data), { connection:{ host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD }});
console.log('worker.gemini started (Google API)');
