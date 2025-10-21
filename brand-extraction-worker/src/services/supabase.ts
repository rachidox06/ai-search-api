import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// For testing, just log the results
// Later this will store in brand_mentions table
export class SupabaseService {
  private client;
  
  constructor() {
    this.client = createClient(
      config.supabase.url,
      config.supabase.serviceKey
    );
  }
  
  // FOR TESTING: Just log and update extracted_brands JSONB column
  async saveBrandExtractionResult(resultId: string, brands: any[], cost: number) {
    console.log(`[Supabase] Saving brands for result ${resultId}`);
    console.log(`[Supabase] Brands:`, JSON.stringify(brands, null, 2));
    console.log(`[Supabase] Cost: $${cost.toFixed(6)}`);
    
    // For now, update the existing extracted_brands column
    const { error } = await this.client
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
  
  // Fetch answer_text for a result
  async getAnswerText(resultId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('prompt_tracking_results')
      .select('answer_text')
      .eq('id', resultId)
      .single();
      
    if (error || !data) {
      throw new Error(`Failed to fetch answer text: ${error?.message}`);
    }
    
    return data.answer_text;
  }
}

