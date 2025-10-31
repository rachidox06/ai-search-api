import { Job } from 'bullmq';
import { BrandExtractionJob, BrandExtractionResult } from '../types';
import { BrandExtractorService } from '../services/brandExtractor';
import { createSupabaseClient, saveCompleteExtractionResult } from '../services/supabase';
import { config } from '../config';

const brandExtractor = new BrandExtractorService();

export async function processBrandExtraction(job: Job<BrandExtractionJob>): Promise<BrandExtractionResult> {
  const { resultId, answerText } = job.data;
  
  console.log(`[Processor] Starting extraction for result ${resultId}`);
  console.log(`[Processor] Text length: ${answerText?.length || 0} characters`);
  
  if (!answerText || answerText.trim().length === 0) {
    console.warn(`[Processor] No answer text for result ${resultId}, skipping`);
    return {
      resultId,
      brands: [],
      cost: 0,
      tokensUsed: 0,
      processingTime: 0,
      model: config.openai.model
    };
  }
  
  // Create a dedicated Supabase client for THIS job
  // This avoids connection conflicts when processing 10+ jobs concurrently
  const supabaseClient = createSupabaseClient();
  
  try {
    // Fetch context: prompt content and website brand name
    const { data: resultData, error: fetchError } = await supabaseClient
      .from('prompt_tracking_results')
      .select(`
        prompts!inner (
          content,
          websites!inner (
            brand_name
          )
        )
      `)
      .eq('id', resultId)
      .single();
    
    if (fetchError || !resultData) {
      console.error(`[Processor] Failed to fetch context for ${resultId}:`, fetchError?.message);
      throw new Error(`Failed to fetch prompt context: ${fetchError?.message}`);
    }
    
    const promptContent = (resultData.prompts as any)?.content || '';
    const trackedBrand = (resultData.prompts as any)?.websites?.brand_name || 'Unknown Brand';
    
    console.log(`[Processor] Context - Tracked Brand: "${trackedBrand}", Prompt: "${promptContent.substring(0, 100)}..."`);
    
    // Extract brands using OpenAI with context
    const extraction = await brandExtractor.extractBrands(answerText, {
      trackedBrand,
      promptContent
    });
    
    console.log(`[Processor] ✅ Extracted ${extraction.brands.length} brands`);
    console.log(`[Processor] Cost: $${extraction.cost.toFixed(6)}`);
    console.log(`[Processor] Processing time: ${extraction.processingTime}ms`);
    
    // Save to database using this job's dedicated client
    // This now saves to ALL tables: prompt_tracking_results, brand_mentions, analytics_facts, prompt_citations
    await saveCompleteExtractionResult(
      supabaseClient,
      resultId,
      extraction.brands,
      extraction.cost
    );
    
    return {
      resultId,
      brands: extraction.brands,
      cost: extraction.cost,
      tokensUsed: extraction.tokensUsed,
      processingTime: extraction.processingTime,
      model: config.openai.model
    };
    
  } catch (error: any) {
    console.error(`[Processor] ❌ Failed to extract brands for ${resultId}:`, error.message);
    throw error; // BullMQ will handle retry
  }
}

