import { Job } from 'bullmq';
import { BrandExtractionJob, BrandExtractionResult } from '../types';
import { BrandExtractorService } from '../services/brandExtractor';
import { SupabaseService } from '../services/supabase';
import { config } from '../config';

const brandExtractor = new BrandExtractorService();
const supabase = new SupabaseService();

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
  
  try {
    // Extract brands using OpenAI
    const extraction = await brandExtractor.extractBrands(answerText);
    
    console.log(`[Processor] ✅ Extracted ${extraction.brands.length} brands`);
    console.log(`[Processor] Cost: $${extraction.cost.toFixed(6)}`);
    console.log(`[Processor] Processing time: ${extraction.processingTime}ms`);
    
    // Save to database
    await supabase.saveBrandExtractionResult(
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

