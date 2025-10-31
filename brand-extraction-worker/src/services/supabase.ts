import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

/**
 * Create a new Supabase client instance
 * Each job should create its own client to avoid connection conflicts
 */
export function createSupabaseClient(): SupabaseClient {
  return createClient(
    config.supabase.url,
    config.supabase.serviceKey
  );
}

/**
 * Types for database operations
 */
interface ResultWithPromptData {
  id: string;
  prompt_id: string;
  engine: string;
  model: string | null;
  checked_at: string;
  total_citations: number;
  answer_length: number | null;
  citations: any[] | null;
  prompts: {
    id: string;
    website_id: string;
    content: string;
    location: string;
    language: string;
    device: string;
    source: string;
    tag: any[] | null;
    websites: {
      id: string;
      domain: string;
    };
  };
}

interface BrandMentionInsert {
  result_id: string;
  brand_name: string;
  ranking: number | null;
  sentiment: number | null;
  brand_website: string | null;
  domain_verified: boolean;
  canonical_brand_id: string | null;
}

interface AnalyticsFactInsert {
  website_id: string;
  date: string;
  engine: string;
  tag: string;
  location: string;
  language: string;
  device: string;
  model: string | null;
  prompt_source: string;
  prompt_id: string;
  prompt_content: string | null;
  result_id: string;
  brand_slug: string;
  brand_name: string;
  brand_website: string | null;
  canonical_brand_id: string | null;
  is_own_brand: boolean;
  mention_count: number;
  ranking_position: number | null;
  sentiment_score: number | null;
  total_citations: number;
  own_brand_citations: number;
  response_length: number | null;
  has_answer: boolean;
  checked_at: string;
}

interface PromptCitationInsert {
  result_id: string;
  citation_number: number;
  citation_url: string;
  citation_title: string | null;
  citation_domain: string | null;
  is_own_website: boolean;
  citation_snippet: string | null;
  rank_absolute: number | null;
}

/**
 * Save brand extraction result to database
 * @param client - Supabase client instance (created per job)
 * @param resultId - Result ID to update
 * @param brands - Extracted brands array
 * @param cost - Extraction cost
 */
export async function saveBrandExtractionResult(
  client: SupabaseClient,
  resultId: string,
  brands: any[],
  cost: number
): Promise<void> {
  console.log(`[Supabase] Saving brands for result ${resultId}`);
  console.log(`[Supabase] Brands:`, JSON.stringify(brands, null, 2));
  console.log(`[Supabase] Cost: $${cost.toFixed(6)}`);
  
  // Update the existing extracted_brands column
  const { error } = await client
    .from('prompt_tracking_results')
    .update({
      extracted_brands: brands,
      brand_extraction_cost: cost,
      updated_at: new Date().toISOString()
    })
    .eq('id', resultId);
    
  if (error) {
    throw new Error(`Failed to save brands: ${error.message}`);
  }
  
  console.log(`[Supabase] ✅ Successfully saved brands for ${resultId}`);
}

/**
 * Fetch answer_text for a result
 * @param client - Supabase client instance
 * @param resultId - Result ID to fetch
 */
export async function getAnswerText(
  client: SupabaseClient,
  resultId: string
): Promise<string | null> {
  const { data, error } = await client
    .from('prompt_tracking_results')
    .select('answer_text')
    .eq('id', resultId)
    .single();
    
  if (error || !data) {
    throw new Error(`Failed to fetch answer text: ${error?.message}`);
  }
  
  return data.answer_text;
}

/**
 * Fetch result with prompt and website data needed for analytics
 */
export async function getResultWithPromptData(
  client: SupabaseClient,
  resultId: string
): Promise<ResultWithPromptData> {
  const { data, error } = await client
    .from('prompt_tracking_results')
    .select(`
      id,
      prompt_id,
      engine,
      model,
      checked_at,
      total_citations,
      answer_length,
      citations,
      prompts!inner (
        id,
        website_id,
        content,
        location,
        language,
        device,
        source,
        tag,
        websites!inner (
          id,
          domain
        )
      )
    `)
    .eq('id', resultId)
    .single();
    
  if (error || !data) {
    throw new Error(`Failed to fetch result data: ${error?.message}`);
  }
  
  return data as any;
}

/**
 * Normalize brand name locally (replaces DB call for performance)
 * This replicates the Postgres normalize_brand_name function logic
 */
export function normalizeBrandName(brandName: string): string {
  if (!brandName) {
    return '';
  }
  
  let normalized = brandName.toLowerCase().trim();
  
  // Remove domain extensions (.com, .io, .co, etc.)
  normalized = normalized.replace(/\.(com|io|co|org|net|ai|app|tech)$/gi, '');
  
  // Remove common business suffixes
  normalized = normalized.replace(/\s+(crm|software|platform|tool|app|inc|ltd|llc|corporation|corp|company|co|limited)$/gi, '');
  
  // Remove special characters (keep alphanumeric and spaces)
  normalized = normalized.replace(/[^a-z0-9\s]/g, '');
  
  // Normalize multiple spaces to single space
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Final trim
  return normalized.trim();
}

/**
 * Call is_own_brand_fuzzy_batch Postgres function for multiple brands
 * Much faster than calling is_own_brand_fuzzy once per brand
 */
export async function isOwnBrandFuzzyBatch(
  client: SupabaseClient,
  websiteId: string,
  brandNames: string[]
): Promise<boolean[]> {
  if (!brandNames || brandNames.length === 0) {
    return [];
  }
  
  const { data, error } = await client.rpc('is_own_brand_fuzzy_batch', {
    p_website_id: websiteId,
    brand_names_input: brandNames
  });
  
  if (error) {
    console.warn(`[Supabase] Failed to check is_own_brand_batch: ${error.message}`);
    // Fallback: all false
    return brandNames.map(() => false);
  }
  
  // Data is an array of {brand_name, is_own} objects
  // Map to just the is_own boolean values in same order
  if (!data || !Array.isArray(data)) {
    return brandNames.map(() => false);
  }
  
  return data.map((row: any) => row.is_own === true);
}

/**
 * Find or create canonical brands in batch
 * Calls the find_or_create_canonical_brands_batch Postgres function
 * Returns array of canonical brand IDs in the same order as input brands
 */
export async function findOrCreateCanonicalBrandsBatch(
  client: SupabaseClient,
  brands: Array<{ name: string; domain: string | null; domain_verified: boolean; sentiment: number | null; ranking_position: number | null }>
): Promise<string[]> {
  if (!brands || brands.length === 0) {
    return [];
  }
  
  console.log(`[Supabase] Finding/creating ${brands.length} canonical brands...`);
  
  const brandsForRPC = brands.map(brand => ({
    name: brand.name,
    domain: brand.domain || null,
    domain_verified: brand.domain_verified || false,
    sentiment: brand.sentiment || null,
    ranking_position: brand.ranking_position || null
  }));
  
  const { data, error } = await client.rpc('find_or_create_canonical_brands_batch', {
    p_brands: brandsForRPC
  });
  
  if (error) {
    console.error(`[Supabase] Failed to find/create canonical brands: ${error.message}`);
    // Fallback: return null for all brands
    console.warn(`[Supabase] Using NULL canonical_brand_id fallback`);
    return brands.map(() => null as any);
  }
  
  if (!data || !Array.isArray(data) || data.length !== brands.length) {
    console.error(`[Supabase] Canonical brands batch mismatch: expected ${brands.length}, got ${data?.length || 0}`);
    return brands.map(() => null as any);
  }
  
  console.log(`[Supabase] ✅ Got ${data.length} canonical brand IDs`);
  return data;
}

/**
 * Calculate own brand citations count
 */
export function calculateOwnBrandCitations(
  citations: any[] | null,
  websiteDomain: string
): number {
  if (!citations || citations.length === 0) {
    return 0;
  }
  
  return citations.filter(citation => {
    const domain = citation.domain || '';
    const url = citation.url || '';
    return domain.toLowerCase().includes(websiteDomain.toLowerCase()) ||
           url.toLowerCase().includes(websiteDomain.toLowerCase());
  }).length;
}


/**
 * Insert analytics facts AND brand mentions directly (replacing trigger logic)
 * OPTIMIZED: Uses local normalization + batch RPC for is_own_brand + canonical brands
 * Now tracks zero-brand results with placeholder row for analytics
 * NEW: Integrates canonical_brands table via batch RPC
 */
export async function insertAnalyticsFacts(
  client: SupabaseClient,
  resultData: ResultWithPromptData,
  brands: any[]
): Promise<void> {
  // Common setup for all cases
  const websiteId = resultData.prompts.websites.id;
  const websiteDomain = resultData.prompts.websites.domain;
  const tags = resultData.prompts.tag || [];
  const tagArray = Array.isArray(tags) ? tags : ['untagged'];
  const finalTags = tagArray.length === 0 ? ['untagged'] : tagArray;
  
  const date = new Date(resultData.checked_at).toISOString().split('T')[0];
  const ownBrandCitations = calculateOwnBrandCitations(resultData.citations, websiteDomain);
  
  const facts: AnalyticsFactInsert[] = [];
  const mentions: BrandMentionInsert[] = [];
  
  // Filter valid brands
  const validBrands = !brands ? [] : brands.filter(brand => brand.name && brand.name.trim());
  
  // CASE 1: No brands found - Insert placeholder row(s) for tracking
  if (validBrands.length === 0) {
    console.log(`[Supabase] No brands found - inserting placeholder for zero-brand tracking`);
    
    // Insert one row per tag to track zero-brand results
    for (const tag of finalTags) {
      facts.push({
        website_id: websiteId,
        date,
        engine: resultData.engine,
        tag: tag,
        location: resultData.prompts.location || 'United States',
        language: resultData.prompts.language || 'en',
        device: resultData.prompts.device || 'desktop',
        model: resultData.model,
        prompt_source: resultData.prompts.source || 'user_added',
        prompt_id: resultData.prompt_id,
        prompt_content: resultData.prompts.content,
        result_id: resultData.id,
        brand_slug: 'no_brands',
        brand_name: 'No Brands Found',
        brand_website: null,
        canonical_brand_id: null, // No canonical brand for zero-brand case
        is_own_brand: false,
        mention_count: 0,
        ranking_position: null,
        sentiment_score: null,
        total_citations: resultData.total_citations || 0,
        own_brand_citations: ownBrandCitations,
        response_length: resultData.answer_length,
        has_answer: (resultData.answer_length || 0) > 0,
        checked_at: resultData.checked_at
      });
    }
    // No brand_mentions to insert for zero-brand case
  } 
  // CASE 2: Brands found - Insert normal rows
  else {
    // ============================================
    // STEP 1: Find or create canonical brands (BATCH)
    // ============================================
    const brandsForCanonical = validBrands.map(brand => ({
      name: brand.name.trim(),
      domain: brand.domain && brand.domain.trim() ? brand.domain.trim() : null,
      domain_verified: brand.domain_verified || false,
      sentiment: brand.sentiment ? parseFloat(brand.sentiment) : null,
      ranking_position: brand.ranking_position ? parseInt(brand.ranking_position) : null
    }));
    
    const canonicalBrandIds = await findOrCreateCanonicalBrandsBatch(client, brandsForCanonical);
    
    // ============================================
    // STEP 2: Batch fuzzy matching for is_own_brand
    // ============================================
    const brandNames = validBrands.map(brand => brand.name.trim());
    console.log(`[Supabase] Checking ${brandNames.length} brands for is_own_brand...`);
    const isOwnBrandResults = await isOwnBrandFuzzyBatch(client, websiteId, brandNames);
    
    console.log(`[Supabase] ✅ is_own_brand batch check complete`);
    
    // ============================================
    // STEP 3: Prepare analytics_facts and brand_mentions rows
    // ============================================
    for (let i = 0; i < validBrands.length; i++) {
      const brand = validBrands[i];
      const brandName = brandNames[i];
      const canonicalBrandId = canonicalBrandIds[i];
      const isOwnBrand = isOwnBrandResults[i] || false;
      
      // PERFORMANCE: Use local normalization (no DB call)
      const brandSlug = normalizeBrandName(brandName);
      
      // Create analytics_facts rows (one per tag)
      for (const tag of finalTags) {
        facts.push({
          website_id: websiteId,
          date,
          engine: resultData.engine,
          tag: tag,
          location: resultData.prompts.location || 'United States',
          language: resultData.prompts.language || 'en',
          device: resultData.prompts.device || 'desktop',
          model: resultData.model,
          prompt_source: resultData.prompts.source || 'user_added',
          prompt_id: resultData.prompt_id,
          prompt_content: resultData.prompts.content,
          result_id: resultData.id,
          
          // NEW: canonical_brand_id
          canonical_brand_id: canonicalBrandId,
          
          // Keep old fields for backwards compatibility
          brand_slug: brandSlug,
          brand_name: brandName,
          brand_website: brand.domain && brand.domain.trim() ? brand.domain.trim() : null,
          
          is_own_brand: isOwnBrand,
          mention_count: 1,
          ranking_position: brand.ranking_position ? parseInt(brand.ranking_position) : null,
          sentiment_score: brand.sentiment ? parseFloat(brand.sentiment) : null,
          total_citations: resultData.total_citations || 0,
          own_brand_citations: ownBrandCitations,
          response_length: resultData.answer_length,
          has_answer: (resultData.answer_length || 0) > 0,
          checked_at: resultData.checked_at
        });
      }
      
      // Create brand_mentions row (one per brand, not per tag)
      mentions.push({
        result_id: resultData.id,
        brand_name: brandName,
        brand_website: brand.domain && brand.domain.trim() ? brand.domain.trim() : null,
        domain_verified: brand.domain_verified || false,
        ranking: brand.ranking_position ? parseInt(brand.ranking_position) : null,
        sentiment: brand.sentiment ? parseInt(brand.sentiment) : null,
        
        // NEW: canonical_brand_id
        canonical_brand_id: canonicalBrandId
      });
    }
  }
  
  // ============================================
  // STEP 4: Insert into analytics_facts
  // ============================================
  if (facts.length === 0) {
    console.log(`[Supabase] No analytics facts to insert (unexpected)`);
    return;
  }
  
  console.log(`[Supabase] Inserting ${facts.length} analytics facts (${validBrands.length || 0} brands × ${finalTags.length} tags)`);
  
  // Use upsert with conflict resolution on (result_id, brand_slug, tag)
  const { error: factsError } = await client
    .from('analytics_facts')
    .upsert(facts, {
      onConflict: 'result_id,brand_slug,tag',
      ignoreDuplicates: false
    });
    
  if (factsError) {
    throw new Error(`Failed to insert analytics facts: ${factsError.message}`);
  }
  
  console.log(`[Supabase] ✅ Inserted ${facts.length} analytics facts`);
  
  // ============================================
  // STEP 5: Insert into brand_mentions
  // ============================================
  if (mentions.length > 0) {
    console.log(`[Supabase] Inserting ${mentions.length} brand mentions`);
    
    const { error: mentionsError } = await client
      .from('brand_mentions')
      .insert(mentions);
      
    if (mentionsError) {
      throw new Error(`Failed to insert brand mentions: ${mentionsError.message}`);
    }
    
    console.log(`[Supabase] ✅ Inserted ${mentions.length} brand mentions`);
  }
}

/**
 * Insert prompt citations directly (replacing trigger logic)
 */
export async function insertPromptCitations(
  client: SupabaseClient,
  resultId: string,
  citations: any[] | null
): Promise<void> {
  if (!citations || citations.length === 0) {
    console.log(`[Supabase] No citations to insert for result ${resultId}`);
    return;
  }
  
  const citationInserts: PromptCitationInsert[] = citations
    .filter(citation => citation.url && citation.number)
    .map(citation => ({
      result_id: resultId,
      citation_number: parseInt(citation.number),
      citation_url: citation.url,
      citation_title: citation.title || null,
      citation_domain: citation.domain?.includes('vertexaisearch.cloud.google.com')
        ? citation.title
        : citation.domain || null,
      is_own_website: citation.is_own_website === true,
      citation_snippet: citation.snippet && citation.snippet.trim() ? citation.snippet : null,
      rank_absolute: citation.number ? parseInt(citation.number) : null
    }));
  
  if (citationInserts.length === 0) {
    console.log(`[Supabase] No valid citations to insert`);
    return;
  }
  
  console.log(`[Supabase] Inserting ${citationInserts.length} citations`);
  
  const { error } = await client
    .from('prompt_citations')
    .insert(citationInserts);
    
  if (error) {
    throw new Error(`Failed to insert citations: ${error.message}`);
  }
  
  console.log(`[Supabase] ✅ Inserted ${citationInserts.length} citations`);
}

/**
 * MAIN: Save all brand extraction data to related tables
 * This replaces the trigger-based logic with direct Railway inserts
 * NOW: Includes canonical brands integration
 */
export async function saveCompleteExtractionResult(
  client: SupabaseClient,
  resultId: string,
  brands: any[],
  cost: number
): Promise<void> {
  console.log(`[Supabase] 🚀 Starting complete extraction save for result ${resultId}`);
  console.log(`[Supabase] Processing ${brands.length} brands`);
  
  try {
    // Step 1: Update extracted_brands column in prompt_tracking_results
    await saveBrandExtractionResult(client, resultId, brands, cost);
    
    // Step 2: Fetch all necessary data for downstream inserts
    console.log(`[Supabase] Fetching result and prompt data...`);
    const resultData = await getResultWithPromptData(client, resultId);
    
    // Step 3: Insert into analytics_facts AND brand_mentions
    // This now also handles canonical brands via batch RPC
    // Replaces both sync_brand_mentions and populate_analytics_facts triggers
    await insertAnalyticsFacts(client, resultData, brands);
    
    // Step 4: Insert into prompt_citations (replaces sync_prompt_citations trigger)
    await insertPromptCitations(client, resultId, resultData.citations);
    
    console.log(`[Supabase] ✅✅✅ Complete extraction save successful for ${resultId}`);
    
  } catch (error: any) {
    console.error(`[Supabase] ❌ Failed to save complete extraction:`, error.message);
    throw error;
  }
}

