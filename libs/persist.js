import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// Validate environment variables
if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL is not set in environment variables');
  console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')).join(', ') || 'none with SUPABASE');
  throw new Error('SUPABASE_URL environment variable is required');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is not set in environment variables');
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
console.log('✅ Supabase client initialized successfully');

// ============================================================================
// NEW FUNCTION: Save to prompt_tracking_results table
// ============================================================================

export async function saveTrackingResult(prompt_id, normalizedData) {
  try {
    const { data, error } = await supabase
      .from('prompt_tracking_results')
      .insert({
        prompt_id,
        engine: normalizedData.engine,
        model: normalizedData.model,
        checked_at: normalizedData.checked_at,
        
        // Content
        answer_text: normalizedData.answer_text,
        answer_markdown: normalizedData.answer_markdown,
        answer_length: normalizedData.answer_length,
        
        // Analysis
        was_mentioned: normalizedData.was_mentioned,
        brand_mentioned: normalizedData.brand_mentioned,
        sentiment: normalizedData.sentiment,
        ranking_position: normalizedData.ranking_position,
        
        // Citations (JSONB array - NOT separate table)
        total_citations: normalizedData.total_citations,
        citations: normalizedData.citations,
        
        // Provider
        provider: normalizedData.provider,
        cost: normalizedData.cost,
        provider_raw: normalizedData.provider_raw,
        
        // Metadata & extra
        metadata: normalizedData.metadata,
        extra: normalizedData.extra
      })
      .select()
      .single();
    
    if (error) {
      console.error('❌ Failed to save to Supabase (prompt_tracking_results):', error);
      throw error;
    }
    
    console.log('✅ Saved tracking result to Supabase:', data.id);
    return data;
  } catch (err) {
    console.error('❌ Error in saveTrackingResult:', err);
    throw err;
  }
}

// ============================================================================
// LEGACY FUNCTION: Save to prompt_runs table (Keep for backward compatibility)
// ============================================================================

export async function savePromptRun(row) {
  const body = {
    user_id: row.user_id ?? null,
    session_id: row.session_id ?? null,
    prompt_text: row.prompt_text,
    prompt_meta: row.prompt_meta ?? null,

    provider: row.provider,
    engine: row.engine,
    model: row.model ?? null,
    request_id: row.request_id ?? null,
    status: row.status ?? 'done',

    latency_ms: row.latency_ms ?? null,
    usage: row.usage ?? null,
    cost_usd: row.cost_usd ?? null,
    cost_breakdown: row.cost_breakdown ?? null,
    currency: row.currency ?? 'USD',

    content_format: row.content_format ?? 'markdown',
    answer_markdown: row.answer_markdown ?? null,
    answer_json: row.answer_json ?? null,
    answer_plain: row.answer_plain ?? null,

    citations: row.citations ?? null,
    search_results: row.search_results ?? null,
    check_url: row.check_url ?? null,
    source_count: row.source_count ?? (row.citations?.length ?? null),

    provider_raw: row.provider_raw,
    extra: row.extra ?? null
  };

  console.log('📝 Saving to Supabase:', {
    provider: body.provider,
    engine: body.engine,
    prompt: body.prompt_text?.substring(0, 50) + '...',
    has_answer: !!body.answer_markdown,
    citations_count: body.citations?.length || 0,
    has_request_id: !!body.request_id
  });

  // Use insert instead of upsert since some providers (like Gemini) don't have request_id
  // If request_id exists and is duplicate, it will fail gracefully
  const { data, error } = await supabase
    .from('prompt_runs')
    .insert(body)
    .select();

  if (error) {
    console.error('❌ Supabase save failed:', error);
    throw error;
  }
  
  console.log('✅ Saved to Supabase successfully, id:', data?.[0]?.id);
  return data?.[0];
}
