import OpenAI from 'openai';
import { config } from '../config';
import { ExtractedBrand } from '../types';
import dns from 'dns/promises';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

const BRAND_EXTRACTION_PROMPT = `
Extract every distinct brand or company referenced in the following text. The text may be in any language (English, French, German, Spanish, etc.).

Return ONLY a JSON array of objects (no prose, no code fences). Each object must follow this schema exactly:

[
  {
    "name": "Company or brand name (not product name) - in the original language from the text",
    "domain": "Primary domain name for this brand or company (e.g., apple.com, hubspot.com) OR null if unknown",
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
- For "domain", provide the primary international website domain for the brand or company (without https:// or www):
  * Example: "Apple" / "애플" / "Apple Inc." → "apple.com"
  * Example: "HubSpot" → "hubspot.com"
  * Example: "Carrefour" → "carrefour.com"
  * Example: "Deutsche Bank" → "db.com"
  * If you know the brand but are unsure of the exact domain, provide your best inference based on the brand name
  * Only use null if the brand is completely unknown or impossible to infer a domain for
  * Do not invent random or fake-sounding domains - use logical, standard domain patterns
- **Do NOT extract celebrities or individual people - only extract actual companies and brands.**
- Merge duplicate or variant mentions (including different language variants) into a single entry using the most canonical company name.
- Estimate sentiment from the surrounding context in the text's language; use 50 if tone is neutral or ambiguous.
- "ranking_position" must reflect the first mention order within the text.
- Exclude generic terms, product categories, and people.
- Exclude huge aggregators like Amazon, Best Buy, Walmart, etc. because they are only destinations to buy products, not brands.


Text:
{text}
`;

export class BrandExtractorService {
  /**
   * Verify if a domain exists using DNS lookup
   * Returns true if domain resolves, false otherwise
   */
  private async verifyDomain(domain: string): Promise<boolean> {
    if (!domain) return false;
    
    try {
      // Try to resolve the domain - this checks if DNS records exist
      await dns.resolve(domain);
      return true;
    } catch (error) {
      console.log(`[BrandExtractor] DNS verification failed for domain: ${domain}`);
      return false;
    }
  }

  /**
   * Verify domains for all brands in parallel
   * Sets domain to null for brands with non-existent domains
   * Adds domain_verified flag to indicate DNS verification status
   */
  private async verifyBrandDomains(brands: ExtractedBrand[]): Promise<ExtractedBrand[]> {
    const verificationPromises = brands.map(async (brand) => {
      // If domain was already null (OpenAI wasn't confident), mark as unverified
      if (!brand.domain) {
        return {
          ...brand,
          domain_verified: false
        };
      }

      // Perform DNS verification
      const isValid = await this.verifyDomain(brand.domain);
      
      if (!isValid) {
        console.log(`[BrandExtractor] ⚠️  Invalid domain detected for "${brand.name}": ${brand.domain} - setting to null`);
        return {
          ...brand,
          domain: null,
          domain_verified: false
        };
      }
      
      // Domain exists and verified
      return {
        ...brand,
        domain_verified: true
      };
    });

    return Promise.all(verificationPromises);
  }

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
            content: 'You are a multilingual brand extraction expert. Extract brands and companies from text in any language (English, French, German, Spanish, etc.) accurately. Always return valid JSON. For domains, provide your best inference based on the brand name - use standard domain patterns. Do not invent random domains.'
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
      const parsedBrands = this.parseBrandResponse(content);
      
      // Verify domains using DNS lookup and add domain_verified flag
      const brands = await this.verifyBrandDomains(parsedBrands);
      
      // Log verification summary
      const verifiedCount = brands.filter(b => b.domain_verified).length;
      const unverifiedCount = brands.filter(b => !b.domain_verified).length;
      const nullifiedCount = parsedBrands.filter(b => b.domain !== null).length - verifiedCount;
      
      console.log(`[BrandExtractor] 📊 DNS verification: ${verifiedCount} verified, ${unverifiedCount} unverified (${nullifiedCount} invalidated)`);
      
      if (nullifiedCount > 0) {
        console.log(`[BrandExtractor] ⚠️  ${nullifiedCount} domain(s) failed DNS check and were set to null`);
      }
      
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
      
      // Validate structure (domain can be null or string)
      // Note: domain_verified will be added during DNS verification step
      return parsed.filter((item: any) => 
        item.name && 
        typeof item.name === 'string' &&
        (item.domain === null || typeof item.domain === 'string') &&
        typeof item.sentiment === 'number' &&
        typeof item.ranking_position === 'number'
      ).map((item: any) => ({
        ...item,
        domain_verified: false // Will be updated during DNS verification
      }));
      
    } catch (error: any) {
      console.error('[BrandExtractor] Parse error:', error.message);
      console.error('[BrandExtractor] Content:', content);
      return [];
    }
  }
}

