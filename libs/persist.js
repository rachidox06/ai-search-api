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
        sentiment: normalizedData.sentiment,
        
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
// END OF PERSIST.JS - Legacy functions removed
// ============================================================================
