#!/usr/bin/env node
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { sendCronSummary } from './slackNotifier.js';
import { getEnabledEngines, shouldRunPrompt } from './libs/locationMapping.js';

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
const DEFAULT_ENGINES = ['chatgpt', 'perplexity', 'gemini', 'google', 'claude'];
const MAX_ENGINES_PER_PROMPT = DEFAULT_ENGINES.length; // 5
const MAX_PROMPTS = Math.floor(MAX_CALLS / MAX_ENGINES_PER_PROMPT);

// Cost per engine (in USD)
const COST_PER_ENGINE = {
  chatgpt: 0.004,
  google: 0.004,
  gemini: 0.0052,
  perplexity: 0.007,
  claude: 0.01
};

// Calculate average cost per prompt (all 5 engines)
const COST_PER_PROMPT = Object.values(COST_PER_ENGINE).reduce((sum, cost) => sum + cost, 0);
const AVG_COST_PER_ENGINE = COST_PER_PROMPT / DEFAULT_ENGINES.length;

console.log('🚀 AI Search Cron Scheduler Started');
console.log('====================================');
console.log(`📅 Schedule: ${CRON_SCHEDULE}`);
console.log(`🔢 Max API calls per run: ${MAX_CALLS}`);
console.log(`📝 Max prompts per run: ~${MAX_PROMPTS} (varies by tracking_config)`);
console.log(`🎯 API URL: ${apiUrl}`);
console.log(`🧪 Dry run: ${DRY_RUN === 'true' ? 'YES (no API calls)' : 'NO'}`);
console.log(`\n💰 Max cost per prompt (all engines): $${COST_PER_PROMPT.toFixed(4)}`);
console.log(`   - ChatGPT: $${COST_PER_ENGINE.chatgpt.toFixed(4)}`);
console.log(`   - Google: $${COST_PER_ENGINE.google.toFixed(4)}`);
console.log(`   - Gemini: $${COST_PER_ENGINE.gemini.toFixed(4)}`);
console.log(`   - Perplexity: $${COST_PER_ENGINE.perplexity.toFixed(4)}`);
console.log(`   - Claude: $${COST_PER_ENGINE.claude.toFixed(4)}`);
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
        location,
        language,
        check_frequency,
        tracking_config,
        last_run_at,
        is_active,
        websites!website_id (
          id,
          domain,
          brand_name,
          brand_aliases
        )
      `)
      .eq('is_active', true) // IMPORTANT: Only fetch active prompts
      .order('created_at', { ascending: true })
      .limit(MAX_PROMPTS * 2); // Fetch more since we'll filter by frequency

    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.log('⚠️  No active prompts found');
      return [];
    }

    // Filter prompts based on is_active, check_frequency, and last_run_at
    const filteredPrompts = data.filter(prompt => {
      // Double-check is_active (defensive check, already filtered by SQL)
      if (!prompt.is_active) {
        console.log(`⏭️  Skipping inactive prompt ${prompt.id}`);
        return false;
      }

      // Check if prompt should run based on frequency
      const shouldRun = shouldRunPrompt(prompt.check_frequency, prompt.last_run_at);
      if (!shouldRun) {
        console.log(`⏭️  Skipping prompt ${prompt.id} (${prompt.check_frequency}, last run: ${prompt.last_run_at})`);
      }
      return shouldRun;
    });

    // Limit to MAX_PROMPTS after filtering
    const limitedPrompts = filteredPrompts.slice(0, MAX_PROMPTS);

    console.log(`✅ Found ${data.length} active prompt(s), ${filteredPrompts.length} due to run, processing ${limitedPrompts.length}`);
    return limitedPrompts;

  } catch (error) {
    console.error('❌ Failed to fetch prompts:', error.message);
    throw error;
  }
}

async function processPrompt(prompt) {
  const { id, content, website_id, websites, location, tracking_config } = prompt;

  if (!websites) {
    console.error(`⚠️  Skipping prompt ${id}: No website data found`);
    return { success: false, error: 'no_website_data' };
  }

  // Get enabled engines from tracking_config
  const enabledEngines = getEnabledEngines(tracking_config);

  const payload = {
    prompt_id: id,
    prompt_text: content,
    website_id: website_id,
    engines: enabledEngines,
    location: location || 'United States' // Use location from DB, default to US
  };
  
  try {
    console.log(`  📤 Queuing prompt: ${id}`);
    console.log(`     Website: ${websites.domain}`);
    console.log(`     Location: ${location || 'United States'}`);
    console.log(`     Engines: ${enabledEngines.join(', ')} (${enabledEngines.length})`);

    if (DRY_RUN === 'true') {
      console.log('     🧪 DRY RUN - Skipping actual API call');
      return {
        success: true,
        prompt_id: id,
        job_ids: { dry_run: true },
        dry_run: true,
        engines_count: enabledEngines.length
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

    // Update last_run_at timestamp in Supabase
    try {
      const { error: updateError } = await supabase
        .from('prompts')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', id);

      if (updateError) {
        console.error(`     ⚠️  Failed to update last_run_at:`, updateError.message);
      } else {
        console.log(`     📅 Updated last_run_at`);
      }
    } catch (updateErr) {
      console.error(`     ⚠️  Error updating last_run_at:`, updateErr.message);
    }

    return { success: true, engines_count: enabledEngines.length, ...result };

  } catch (error) {
    console.error(`     ❌ Failed to process prompt ${id}:`, error.message);
    return { success: false, error: error.message, engines_count: 0 };
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

      // Get enabled engines count for this prompt
      const enabledEngines = getEnabledEngines(prompt.tracking_config);
      const enginesCount = enabledEngines.length;

      // Check if we've hit the limit
      if (apiCallsUsed + enginesCount > MAX_CALLS) {
        console.log(`\n⚠️  Reached API call limit (${MAX_CALLS}). Stopping.`);
        console.log(`   Processed: ${i}/${prompts.length} prompts`);
        break;
      }

      console.log(`\n[${i + 1}/${prompts.length}] Processing prompt...`);
      const result = await processPrompt(prompt);
      results.push(result);

      if (result.success && !result.dry_run) {
        apiCallsUsed += result.engines_count || enginesCount;
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

    // Calculate costs
    const totalCost = successful * COST_PER_PROMPT;
    const costBreakdown = {
      chatgpt: successful * COST_PER_ENGINE.chatgpt,
      google: successful * COST_PER_ENGINE.google,
      gemini: successful * COST_PER_ENGINE.gemini,
      perplexity: successful * COST_PER_ENGINE.perplexity,
      claude: successful * COST_PER_ENGINE.claude
    };

    console.log('\n====================================');
    console.log('📊 Daily Cron Summary');
    console.log('====================================');
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📞 API calls used: ${apiCallsUsed}/${MAX_CALLS}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`\n💰 Cost Summary:`);
    console.log(`   Total cost: $${totalCost.toFixed(4)}`);
    console.log(`   Cost per prompt: $${COST_PER_PROMPT.toFixed(4)}`);
    console.log(`   Avg per engine: $${AVG_COST_PER_ENGINE.toFixed(4)}`);
    console.log(`\n   Breakdown by engine:`);
    console.log(`   - ChatGPT: $${costBreakdown.chatgpt.toFixed(4)}`);
    console.log(`   - Google: $${costBreakdown.google.toFixed(4)}`);
    console.log(`   - Gemini: $${costBreakdown.gemini.toFixed(4)}`);
    console.log(`   - Perplexity: $${costBreakdown.perplexity.toFixed(4)}`);
    console.log(`   - Claude: $${costBreakdown.claude.toFixed(4)}`);
    console.log('====================================\n');

    // Send summary to Slack
    await sendCronSummary({
      date: new Date().toISOString().split('T')[0],
      total_prompts: prompts.length,
      successful,
      failed,
      duration,
      api_calls_used: apiCallsUsed,
      max_api_calls: MAX_CALLS,
      total_cost: totalCost,
      cost_per_prompt: COST_PER_PROMPT,
      avg_cost_per_engine: AVG_COST_PER_ENGINE,
      cost_breakdown: costBreakdown
    });
    
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

