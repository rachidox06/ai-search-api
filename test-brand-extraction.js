#!/usr/bin/env node
// Test script for brand extraction
// Usage: node test-brand-extraction.js

import { createClient } from '@supabase/supabase-js';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const PROMPT_ID = '878c7d5e-b211-4660-a09f-e56418b3fd3a';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Connect to Redis
const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  maxRetriesPerRequest: null,
});

const brandQueue = new Queue('brand-extraction-queue', { connection });

console.log('\n🧪 Brand Extraction Test Script');
console.log('================================\n');

async function main() {
  try {
    // 1. Fetch existing results for this prompt
    console.log(`📋 Fetching results for prompt: ${PROMPT_ID}...\n`);
    
    const { data: results, error } = await supabase
      .from('prompt_tracking_results')
      .select('*')
      .eq('prompt_id', PROMPT_ID)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Error fetching results:', error);
      process.exit(1);
    }
    
    if (!results || results.length === 0) {
      console.log('⚠️  No results found for this prompt ID.');
      console.log('\nOptions:');
      console.log('1. Make a new API request first to generate results');
      console.log('2. Use a different prompt_id that has results\n');
      process.exit(0);
    }
    
    console.log(`✅ Found ${results.length} result(s):\n`);
    
    // Display results
    results.forEach((result, i) => {
      console.log(`Result ${i + 1}:`);
      console.log(`  - ID: ${result.id}`);
      console.log(`  - Engine: ${result.engine}`);
      console.log(`  - Model: ${result.model || 'N/A'}`);
      console.log(`  - Answer length: ${result.answer_text?.length || 0} chars`);
      console.log(`  - Has answer: ${result.answer_text ? 'Yes' : 'No'}`);
      console.log(`  - Already extracted: ${result.extracted_brands ? 'Yes' : 'No'}`);
      
      if (result.extracted_brands) {
        console.log(`  - Brands found: ${result.extracted_brands.length}`);
      }
      console.log('');
    });
    
    // 2. Queue brand extraction jobs for results with answer_text
    const resultsWithAnswers = results.filter(r => r.answer_text && r.answer_text.trim().length > 0);
    
    if (resultsWithAnswers.length === 0) {
      console.log('⚠️  No results have answer_text to extract brands from.\n');
      process.exit(0);
    }
    
    console.log(`\n📤 Queueing brand extraction for ${resultsWithAnswers.length} result(s)...\n`);
    
    const queuedJobs = [];
    
    for (const result of resultsWithAnswers) {
      const job = await brandQueue.add('extract-brands', {
        resultId: result.id,
        answerText: result.answer_text,
        promptId: result.prompt_id,
        websiteId: result.prompt_id, // Using prompt_id as placeholder
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });
      
      queuedJobs.push({
        resultId: result.id,
        jobId: job.id,
        engine: result.engine,
        textLength: result.answer_text.length
      });
      
      console.log(`  ✅ Queued job ${job.id} for result ${result.id} (${result.engine})`);
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All jobs queued successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📊 Summary:');
    console.log(`  - Total results: ${results.length}`);
    console.log(`  - Jobs queued: ${queuedJobs.length}`);
    console.log(`  - Queue: brand-extraction-queue\n`);
    
    console.log('🎯 Next steps:');
    console.log('  1. Make sure brand-extraction-worker is running:');
    console.log('     cd brand-extraction-worker && npm run dev\n');
    console.log('  2. Watch the worker logs for processing\n');
    console.log('  3. Check results in Supabase after ~10-30 seconds:\n');
    console.log('     SELECT id, engine, extracted_brands, brand_extraction_cost');
    console.log(`     FROM prompt_tracking_results`);
    console.log(`     WHERE prompt_id = '${PROMPT_ID}';`);
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await connection.quit();
    await brandQueue.close();
  }
}

main();

