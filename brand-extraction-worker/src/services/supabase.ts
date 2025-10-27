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

