import OpenAI from 'openai';
import { config } from '../config';
import { ExtractedBrand } from '../types';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const BRAND_EXTRACTION_PROMPT = `
Extract every distinct brand or company referenced in the following text. The text may be in any language (English, French, German, Spanish, etc.).

Return ONLY a JSON array of objects (no prose, no code fences). Each object must follow this schema exactly:

[
  {
    "name": "Company or brand name (not product name) - in the original language from the text",
    "domain": "Primary domain name for this brand or company (e.g., apple.com, hubspot.com)",
    "sentiment": 0-100 integer score reflecting how positively the brand is portrayed (0 = very negative, 50 = neutral, 100 = very positive),
    "ranking_position": integer representing the 1-based order of appearance of the brand in the answer text (first occurrence = 1)
  }
]

Rules:
- **MULTILINGUAL**: The text can be in any language. Extract brands regardless of the language used.
- For "name", use the brand name as it appears in the text (preserve original language):
  * If the mention refers to a standalone product/solution in a DIFFERENT category than the parent company, use the full product name.
    Example: "Google Trends" → extract "Google Trends" (not "Google")
    Example: "AWS" → extract "AWS" (not "Amazon")
  * If the mention refers to a product that is in the SAME category/strongly associated with the parent brand, use the parent company name.
    Example: "Aeropress Coffee" → extract "Aeropress" (not "Aeropress Coffee")
    Example: "iPhone" → extract "Apple" (not "iPhone")
- For "domain", provide the primary international website domain for the brand or company (without https:// or www).
  * Example: "Apple" / "애플" / "Apple Inc." → "apple.com"
  * Example: "HubSpot" → "hubspot.com"
  * Example: "Carrefour" → "carrefour.com"
  * Example: "Deutsche Bank" → "db.com"
- **Do NOT extract celebrities or individual people - only extract actual companies and brands.**
- Merge duplicate or variant mentions (including different language variants) into a single entry using the most canonical company name.
- Estimate sentiment from the surrounding context in the text's language; use 50 if tone is neutral or ambiguous.
- "ranking_position" must reflect the first mention order within the text.
- Exclude generic terms, product categories, and people.

Text:
{text}
`;

export class BrandExtractorService {
  async extractBrands(text: string): Promise<{
    brands: ExtractedBrand[];
    cost: number;
    tokensUsed: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      const prompt = BRAND_EXTRACTION_PROMPT.replace('{text}', text);
      
      const response = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: 'system',
            content: 'You are a multilingual brand extraction expert. Extract brands and companies from text in any language (English, French, German, Spanish, etc.) accurately. Always return valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: config.openai.temperature,
        max_tokens: config.openai.maxTokens,
      });
      
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }
      
      // Parse JSON response
      const brands = this.parseBrandResponse(content);
      
      // Calculate cost
      const promptTokens = response.usage?.prompt_tokens || 0;
      const completionTokens = response.usage?.completion_tokens || 0;
      const totalTokens = response.usage?.total_tokens || 0;
      
      // GPT-4o-mini pricing: $0.15/M input, $0.60/M output
      const inputCost = promptTokens * 0.00000015;
      const outputCost = completionTokens * 0.00000060;
      const cost = inputCost + outputCost;
      
      const processingTime = Date.now() - startTime;
      
      return {
        brands,
        cost,
        tokensUsed: totalTokens,
        processingTime
      };
      
    } catch (error: any) {
      console.error('[BrandExtractor] Error:', error.message);
      throw new Error(`Brand extraction failed: ${error.message}`);
    }
  }
  
  private parseBrandResponse(content: string): ExtractedBrand[] {
    try {
      // Remove markdown code fences if present
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      
      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }
      
      // Validate structure
      return parsed.filter((item: any) => 
        item.name && 
        typeof item.name === 'string' &&
        item.domain &&
        typeof item.domain === 'string' &&
        typeof item.sentiment === 'number' &&
        typeof item.ranking_position === 'number'
      );
      
    } catch (error: any) {
      console.error('[BrandExtractor] Parse error:', error.message);
      console.error('[BrandExtractor] Content:', content);
      return [];
    }
  }
}

