import { Worker } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { normalizeGemini } from './libs/normalize.js';
import { savePromptRun } from './libs/persist.js';

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

  // Process grounding data to create enhanced response with hyperlinks
  let enhancedText = text;
  const citations = [];
  const sources = [];

  if (groundingMetadata?.groundingSupports && groundingMetadata?.groundingChunks) {
    // Sort supports by startIndex in reverse order to avoid index shifting
    const sortedSupports = [...groundingMetadata.groundingSupports]
      .sort((a, b) => b.segment.startIndex - a.segment.startIndex);

    // Process each grounding support to add hyperlinks
    sortedSupports.forEach((support, index) => {
      const chunkIndex = support.groundingChunkIndices[0]; // Use first chunk
      const chunk = groundingMetadata.groundingChunks[chunkIndex];

      if (chunk?.web) {
        const citationNumber = index + 1;
        const hyperlinkText = `${support.segment.text} [${citationNumber}]`;

        // Replace the segment text with hyperlinked version
        const start = support.segment.startIndex;
        const end = support.segment.endIndex;
        enhancedText = enhancedText.substring(0, start) + hyperlinkText + enhancedText.substring(end);

        // Add to citations array
        citations.push({
          number: citationNumber,
          url: chunk.web.uri,
          title: chunk.web.title || 'Source',
          text: support.segment.text
        });

        // Add to sources if not already present
        if (!sources.find(s => s.url === chunk.web.uri)) {
          sources.push({
            url: chunk.web.uri,
            title: chunk.web.title || 'Source'
          });
        }
      }
    });
  }

  return {
    text: enhancedText,
    originalText: text,
    groundingMetadata: groundingMetadata,
    citations: citations,
    sources: sources,
    searchQueries: groundingMetadata?.webSearchQueries || []
  };
}

async function runJob({prompt, locale='US', user_id, session_id}) {
  const result = await queryGemini(prompt);

  // Create a formatted response with citations
  let formattedAnswer = result.enhancedText || result.text;

  // Add citations section if we have citations
  if (result.citations && result.citations.length > 0) {
    formattedAnswer += '\n\n## Sources:\n';
    result.citations.forEach(citation => {
      formattedAnswer += `${citation.number}. [${citation.title}](${citation.url})\n`;
    });
  }

  const payload = {
    engine: 'gemini',
    provider: 'google',
    answer: formattedAnswer,
    enhanced_answer: result.enhancedText,
    original_answer: result.originalText,
    raw: result,
    search_results: result.sources || [],
    citations: result.citations || [],
    search_queries: result.searchQueries || []
  };

  // Normalize and persist to Supabase
  const normalized = normalizeGemini({ prompt, user_id, session_id }, payload);
  await savePromptRun(normalized);

  return payload;
}

new Worker('prompt-gemini', async job=>runJob(job.data), { connection:{ host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD }});
console.log('worker.gemini started (Google API)');
