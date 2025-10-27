import { Worker } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { normalizeResponse } from './libs/normalize.js';
import { saveTrackingResult } from './libs/persist.js';
import { queueBrandExtraction } from './libs/brandQueue.js';
import { resolveCitationUrls } from './libs/urlResolver.js';
import { mapLocationToCoordinates } from './libs/locationMapping.js';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, GEMINI_API_KEY } = process.env;

// Function to query Google Gemini API
async function queryGemini(prompt, location = 'United States') {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

  // Get coordinates for location-based grounding
  const coordinates = mapLocationToCoordinates(location);

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
    toolConfig: {
      retrievalConfig: {
        latLng: {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude
        }
      }
    },
    systemInstruction: `You are a helpful AI assistant with access to Google Search. When answering questions, provide comprehensive, well-researched answers with specific facts, data, and citations from reliable sources, particularly relevant to ${location}. Include links to your sources whenever possible. Be thorough but concise.`
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

  // Resolve Vertex AI redirect URLs to final destinations
  console.log(`🔗 Resolving ${citations.length} citation URLs...`);
  const resolvedCitations = await resolveCitationUrls(citations);
  console.log(`✅ URLs resolved`);

  // Also update sources with resolved URLs
  const resolvedSources = await resolveCitationUrls(sources);

  return {
    text: enhancedText,
    originalText: text,
    groundingMetadata: groundingMetadata,
    citations: resolvedCitations,
    sources: resolvedSources,
    searchQueries: groundingMetadata?.webSearchQueries || [],
    rawResponse: response // Include the raw Gemini API response
  };
}

async function runJob(jobData) {
  const {
    prompt_id,       // REQUIRED: UUID from Next.js
    prompt_text,     // REQUIRED: The actual prompt
    location = 'United States', // Location name (e.g., "United States")
    locale = 'US',   // Deprecated: kept for backward compatibility
    engine = 'gemini',
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
  
  // 1. Call Google Gemini API with location
  const result = await queryGemini(prompt_text, searchLocation);
  console.log('✅ Gemini API response received:', {
    citations_count: result.citations?.length || 0,
    search_queries_count: result.searchQueries?.length || 0
  });

  // Convert Gemini response to DataForSEO-like format for normalization
  const dataforseoFormat = {
    tasks: [{
      cost: 0, // Gemini is free/direct API
      result: [{
        markdown: result.enhancedText || result.text,
        answer: result.text,
        sources: result.sources,
        citations: result.citations,
        searchQueries: result.searchQueries, // Pass search queries from groundingMetadata
        model: 'gemini-2.5-flash'
      }]
    }]
  };

  // 2. Normalize with brand analysis (pass raw response separately)
  const normalized = await normalizeResponse(
    'gemini',
    dataforseoFormat,
    { website_domain, brand_name, brand_aliases },
    { location: searchLocation },
    result.rawResponse // Pass the unmodified raw Gemini API response
  );
  
  // 3. Save to tracking table
  const saved = await saveTrackingResult(prompt_id, normalized);
  console.log('✅ Tracking result saved:', saved.id);
  
  // 4. Queue brand extraction
  await queueBrandExtraction(
    saved.id,              // resultId
    normalized.answer_markdown, // answerText
    prompt_id,             // promptId
    website_id             // websiteId
  );
  
  // 5. Return result
  return {
    success: true,
    result_id: saved.id,
    engine: 'gemini',
    was_mentioned: normalized.was_mentioned,
    sentiment: normalized.sentiment,
    ranking_position: normalized.ranking_position
  };
}

new Worker('prompt-gemini', async job=>runJob(job.data), { 
  connection: {
    host: REDIS_HOST,
    port: Number(REDIS_PORT),
    password: REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: null,
  },
  concurrency: 10
});
console.log('worker.gemini started (Google API) with concurrency: 10');
