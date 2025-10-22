import OpenAI from 'openai';
import { config } from '../config';
import { ExtractedBrand } from '../types';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const BRAND_EXTRACTION_PROMPT = `
Extract every distinct brand or company referenced in the following text.

Return ONLY a JSON array of objects (no prose, no code fences). Each object must follow this schema exactly:

[
  {
    "name": "Company or brand name (not product name)",
    "domain": "Primary domain name for this brand or company (e.g., apple.com, hubspot.com)",
    "sentiment": 0-100 integer score reflecting how positively the brand is portrayed (0 = very negative, 50 = neutral, 100 = very positive),
    "ranking_position": integer representing the 1-based order of appearance of the brand in the answer text (first occurrence = 1)
  }
]

Rules:
- For "name", always use the company or parent brand name, NOT the product name.
  * Example: If "iPhone" is mentioned, extract "Apple" (not "iPhone")
  * Example: If "HubSpot CRM" is mentioned, extract "HubSpot" (not "HubSpot CRM")
- For "domain", provide the primary website domain for the brand or company (without https:// or www).
  * Example: "Apple" → "apple.com"
  * Example: "HubSpot" → "hubspot.com"
- **Do NOT extract celebrities or individual people - only extract actual companies and brands.**
- Merge duplicate or variant mentions into a single entry using the most canonical company name.
- Estimate sentiment from the surrounding context; use 50 if tone is neutral or ambiguous.
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
            content: 'You are a brand extraction expert. Extract brands from text accurately.'
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

