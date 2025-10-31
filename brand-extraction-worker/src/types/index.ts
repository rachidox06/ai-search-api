export interface BrandExtractionJob {
  resultId: string;           // prompt_tracking_results.id
  answerText: string;         // Full AI response text
  promptId: string;           // For reference
  websiteId: string;          // For reference
}

export interface ExtractedBrand {
  name: string;
  domain: string | null;      // Primary domain for the brand (null if uncertain)
  domain_verified: boolean;   // Whether domain passed DNS verification
  sentiment: number;          // 0-100
  ranking_position: number;   // Order of appearance
}

export interface BrandExtractionResult {
  resultId: string;
  brands: ExtractedBrand[];
  cost: number;               // Extraction cost in USD
  tokensUsed: number;
  processingTime: number;     // milliseconds
  model: string;              // e.g., "gpt-4o-mini"
}

