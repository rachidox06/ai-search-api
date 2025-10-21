#!/usr/bin/env node
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  API_URL,
  CRON_SCHEDULE = '0 2 * * *', // Default: 2 AM daily
  MAX_API_CALLS_PER_RUN = '500',
  DRY_RUN = 'false'
} = process.env;

// Validate required env vars
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !API_URL) {
  console.error('❌ Missing required environment variables:');
  console.error('   - SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  console.error('   - API_URL');
  process.exit(1);
}

// Ensure API_URL has protocol and remove trailing slash
let apiUrl = API_URL;
if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
  apiUrl = `https://${apiUrl}`;
  console.log(`⚠️  Added https:// to API_URL: ${apiUrl}`);
}
// Remove trailing slash to prevent double slashes in URL construction
apiUrl = apiUrl.replace(/\/$/, '');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const MAX_CALLS = parseInt(MAX_API_CALLS_PER_RUN);
const ENGINES = ['chatgpt', 'perplexity', 'gemini', 'google'];
const ENGINES_PER_PROMPT = ENGINES.length; // 4
const MAX_PROMPTS = Math.floor(MAX_CALLS / ENGINES_PER_PROMPT);

console.log('🚀 AI Search Cron Scheduler Started');
console.log('====================================');
console.log(`📅 Schedule: ${CRON_SCHEDULE}`);
console.log(`🔢 Max API calls per run: ${MAX_CALLS}`);
console.log(`📝 Max prompts per run: ${MAX_PROMPTS} (${ENGINES_PER_PROMPT} engines each)`);
console.log(`🎯 API URL: ${apiUrl}`);
console.log(`🧪 Dry run: ${DRY_RUN === 'true' ? 'YES (no API calls)' : 'NO'}`);
console.log('====================================\n');

async function fetchActivePrompts() {
  try {
    console.log('📋 Fetching active prompts from Supabase...');
    
    const { data, error } = await supabase
      .from('prompts')
      .select(`
        id,
        content,
        website_id,
        websites!website_id (
          id,
          domain,
          brand_name,
          brand_aliases
        )
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(MAX_PROMPTS);
    
    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }
    
    if (!data || data.length === 0) {
      console.log('⚠️  No active prompts found');
      return [];
    }
    
    console.log(`✅ Found ${data.length} active prompt(s)`);
    return data;
    
  } catch (error) {
    console.error('❌ Failed to fetch prompts:', error.message);
    throw error;
  }
}

async function processPrompt(prompt) {
  const { id, content, website_id, websites } = prompt;
  
  if (!websites) {
    console.error(`⚠️  Skipping prompt ${id}: No website data found`);
    return { success: false, error: 'no_website_data' };
  }
  
  const payload = {
    prompt_id: id,
    prompt_text: content,
    website_id: website_id,
    engines: ENGINES,
    locale: 'US'
  };
  
  try {
    console.log(`  📤 Queuing prompt: ${id}`);
    console.log(`     Website: ${websites.domain}`);
    console.log(`     Engines: ${ENGINES.join(', ')}`);
    
    if (DRY_RUN === 'true') {
      console.log('     🧪 DRY RUN - Skipping actual API call');
      return { 
        success: true, 
        prompt_id: id, 
        job_ids: { dry_run: true },
        dry_run: true 
      };
    }
    
    const response = await fetch(`${apiUrl}/api/v1/prompt-runs/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`     ❌ API error (${response.status}): ${errorText}`);
      return { 
        success: false, 
        error: errorText,
        status: response.status 
      };
    }
    
    const result = await response.json();
    console.log(`     ✅ Queued successfully`);
    console.log(`     Job IDs:`, result.job_ids);
    
    return { success: true, ...result };
    
  } catch (error) {
    console.error(`     ❌ Failed to process prompt ${id}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function runDailyCron() {
  const startTime = Date.now();
  console.log('\n🔄 Starting daily prompt refresh...');
  console.log(`⏰ Time: ${new Date().toISOString()}\n`);
  
  try {
    // Fetch active prompts
    const prompts = await fetchActivePrompts();
    
    if (prompts.length === 0) {
      console.log('✅ No prompts to process. Job complete.\n');
      return;
    }
    
    // Process each prompt sequentially
    const results = [];
    let apiCallsUsed = 0;
    
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      
      // Check if we've hit the limit
      if (apiCallsUsed + ENGINES_PER_PROMPT > MAX_CALLS) {
        console.log(`\n⚠️  Reached API call limit (${MAX_CALLS}). Stopping.`);
        console.log(`   Processed: ${i}/${prompts.length} prompts`);
        break;
      }
      
      console.log(`\n[${i + 1}/${prompts.length}] Processing prompt...`);
      const result = await processPrompt(prompt);
      results.push(result);
      
      if (result.success && !result.dry_run) {
        apiCallsUsed += ENGINES_PER_PROMPT;
      }
      
      // Small delay between requests to be nice to the API
      if (i < prompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log('\n====================================');
    console.log('📊 Daily Cron Summary');
    console.log('====================================');
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📞 API calls used: ${apiCallsUsed}/${MAX_CALLS}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('====================================\n');
    
  } catch (error) {
    console.error('\n❌ Cron job failed:', error.message);
    console.error(error);
  }
}

// Schedule the cron job
cron.schedule(CRON_SCHEDULE, () => {
  console.log('\n⏰ Cron triggered!');
  runDailyCron().catch(err => {
    console.error('Fatal error in cron job:', err);
  });
}, {
  scheduled: true,
  timezone: "UTC"
});

console.log('✅ Cron scheduler is running...');
console.log('   Waiting for next scheduled run...\n');

// Run immediately on startup if SKIP_INITIAL_RUN is not true
if (process.env.SKIP_INITIAL_RUN !== 'true') {
  console.log('🚀 Running initial job on startup...');
  runDailyCron().catch(err => {
    console.error('Fatal error in initial run:', err);
  });
}

// Keep process alive
process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

