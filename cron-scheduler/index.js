#!/usr/bin/env node
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { sendCronSummary } from './slackNotifier.js';
import { getEnabledEngines, shouldRunPrompt, calculateNextRunAt } from './libs/locationMapping.js';

dotenv.config();

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  API_URL,
  CRON_SCHEDULE = '0 * * * *', // Default: Every hour (changed from daily for per-prompt scheduling)
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

// Function to get actual costs from prompt_tracking_results for a batch of prompts
async function getActualCostsForPrompts(promptIds, batchStartTime) {
  try {
    console.log(`💰 Fetching actual costs for ${promptIds.length} prompts...`);
    
    const { data, error } = await supabase
      .from('prompt_tracking_results')
      .select('prompt_id, engine, cost, checked_at')
      .in('prompt_id', promptIds)
      .gte('checked_at', batchStartTime) // Only results from this batch
      .order('checked_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching actual costs:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.log('⚠️  No actual cost data found yet (jobs may still be running)');
      return null;
    }

    // Group by engine and calculate totals and counts
    const costsByEngine = {
      chatgpt: 0,
      google: 0,
      gemini: 0,
      perplexity: 0,
      claude: 0
    };

    const countsByEngine = {
      chatgpt: 0,
      google: 0,
      gemini: 0,
      perplexity: 0,
      claude: 0
    };

    let totalActualCost = 0;
    let resultsCount = 0;

    data.forEach(result => {
      const cost = parseFloat(result.cost || 0);
      totalActualCost += cost;
      resultsCount++;
      
      if (costsByEngine.hasOwnProperty(result.engine)) {
        costsByEngine[result.engine] += cost;
        countsByEngine[result.engine]++;
      }
    });

    // Calculate average cost per prompt per engine
    const avgCostPerPromptByEngine = {};
    Object.keys(costsByEngine).forEach(engine => {
      avgCostPerPromptByEngine[engine] = countsByEngine[engine] > 0 
        ? costsByEngine[engine] / countsByEngine[engine]
        : 0;
    });

    console.log(`✅ Found ${resultsCount} completed results with actual costs`);
    console.log(`💰 Total actual cost: $${totalActualCost.toFixed(6)}`);
    
    // Log per-engine averages
    Object.keys(avgCostPerPromptByEngine).forEach(engine => {
      if (countsByEngine[engine] > 0) {
        console.log(`   ${engine}: $${avgCostPerPromptByEngine[engine].toFixed(6)}/prompt (${countsByEngine[engine]} results)`);
      }
    });

    return {
      totalActualCost,
      costsByEngine,
      countsByEngine,
      avgCostPerPromptByEngine,
      resultsCount,
      completedPrompts: [...new Set(data.map(r => r.prompt_id))].length
    };

  } catch (error) {
    console.error('❌ Error in getActualCostsForPrompts:', error);
    return null;
  }
}

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

console.log('🚀 AI Search Cron Scheduler Started (Per-Prompt Scheduling)');
console.log('====================================');
console.log(`📅 Schedule: ${CRON_SCHEDULE} (hourly check for due prompts)`);
console.log(`🔢 Max API calls per run: ${MAX_CALLS}`);
console.log(`📝 Max prompts per run: ~${MAX_PROMPTS} (varies by tracking_config)`);
console.log(`🎯 API URL: ${apiUrl}`);
console.log(`🧪 Dry run: ${DRY_RUN === 'true' ? 'YES (no API calls)' : 'NO'}`);
console.log(`\n⏰ Scheduling Mode: PER-PROMPT (based on next_run_at)`);
console.log(`   Each prompt runs on its own schedule based on when it was created/last run`);
console.log(`   No more fixed 2 AM global schedule!`);
console.log(`\n💰 Max cost per prompt (all engines): $${COST_PER_PROMPT.toFixed(4)}`);
console.log(`   - ChatGPT: $${COST_PER_ENGINE.chatgpt.toFixed(4)}`);
console.log(`   - Google: $${COST_PER_ENGINE.google.toFixed(4)}`);
console.log(`   - Gemini: $${COST_PER_ENGINE.gemini.toFixed(4)}`);
console.log(`   - Perplexity: $${COST_PER_ENGINE.perplexity.toFixed(4)}`);
console.log(`   - Claude: $${COST_PER_ENGINE.claude.toFixed(4)}`);
console.log('====================================\n');

async function fetchActivePrompts() {
  try {
    console.log('📋 Fetching prompts due for execution...');

    const now = new Date().toISOString();

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
        next_run_at,
        is_active,
        websites!website_id (
          id,
          domain,
          brand_name,
          brand_aliases
        )
      `)
      .eq('is_active', true) // IMPORTANT: Only fetch active prompts
      .lte('next_run_at', now) // NEW: Only fetch prompts due to run (next_run_at <= NOW)
      .order('next_run_at', { ascending: true }) // Process oldest scheduled first
      .limit(MAX_PROMPTS);

    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.log('✅ No prompts due for execution at this time');
      return [];
    }

    console.log(`✅ Found ${data.length} prompt(s) due for execution`);
    
    // Log upcoming schedule for visibility
    data.forEach(p => {
      const overdue = p.next_run_at ? 
        ((new Date() - new Date(p.next_run_at)) / 1000 / 60).toFixed(0) : 
        'never run';
      console.log(`   - Prompt ${p.id}: scheduled ${p.next_run_at} (${overdue} min ago)`);
    });

    return data;

  } catch (error) {
    console.error('❌ Failed to fetch prompts:', error.message);
    throw error;
  }
}

async function processPrompt(prompt) {
  const { id, content, website_id, websites, location, tracking_config, check_frequency } = prompt;

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
    console.log(`     Frequency: ${check_frequency}`);

    if (DRY_RUN === 'true') {
      console.log('     🧪 DRY RUN - Skipping actual API call');
      
      // Still calculate next run time for testing
      const nextRunAt = calculateNextRunAt(check_frequency);
      console.log(`     📅 Would schedule next run at: ${nextRunAt}`);
      
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

    // Calculate next run time
    const now = new Date();
    const nextRunAt = calculateNextRunAt(check_frequency, now);

    // Update last_run_at AND next_run_at in Supabase
    try {
      const { error: updateError } = await supabase
        .from('prompts')
        .update({ 
          last_run_at: now.toISOString(),
          next_run_at: nextRunAt
        })
        .eq('id', id);

      if (updateError) {
        console.error(`     ⚠️  Failed to update run times:`, updateError.message);
      } else {
        console.log(`     📅 Updated last_run_at: ${now.toISOString()}`);
        console.log(`     📅 Scheduled next_run_at: ${nextRunAt}`);
        
        // Calculate and display time until next run
        const hoursUntilNext = ((new Date(nextRunAt) - now) / 1000 / 60 / 60).toFixed(1);
        console.log(`     ⏰ Next run in: ${hoursUntilNext} hours`);
      }
    } catch (updateErr) {
      console.error(`     ⚠️  Error updating run times:`, updateErr.message);
    }

    return { success: true, engines_count: enabledEngines.length, ...result };

  } catch (error) {
    console.error(`     ❌ Failed to process prompt ${id}:`, error.message);
    return { success: false, error: error.message, engines_count: 0 };
  }
}

async function runDailyCron() {
  const startTime = Date.now();
  const batchStartTime = new Date().toISOString();
  console.log('\n🔄 Starting daily prompt refresh...');
  console.log(`⏰ Time: ${batchStartTime}\n`);
  
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

    // Calculate estimated costs (current system)
    const estimatedTotalCost = successful * COST_PER_PROMPT;
    const estimatedCostBreakdown = {
      chatgpt: successful * COST_PER_ENGINE.chatgpt,
      google: successful * COST_PER_ENGINE.google,
      gemini: successful * COST_PER_ENGINE.gemini,
      perplexity: successful * COST_PER_ENGINE.perplexity,
      claude: successful * COST_PER_ENGINE.claude
    };

    // Get processed prompt IDs for actual cost lookup
    const processedPromptIds = results
      .filter(r => r.success && !r.dry_run)
      .map(r => r.prompt_id || prompts[results.indexOf(r)]?.id)
      .filter(Boolean);

    console.log('\n====================================');
    console.log('📊 Daily Cron Summary');
    console.log('====================================');
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📞 API calls used: ${apiCallsUsed}/${MAX_CALLS}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`\n💰 Estimated Cost Summary (Hardcoded Rates):`);
    console.log(`   Total estimated: $${estimatedTotalCost.toFixed(4)}`);
    console.log(`   Cost per prompt: $${COST_PER_PROMPT.toFixed(4)}`);
    console.log(`   Avg per engine: $${AVG_COST_PER_ENGINE.toFixed(4)}`);
    console.log(`\n   Estimated breakdown by engine:`);
    console.log(`   - ChatGPT: $${estimatedCostBreakdown.chatgpt.toFixed(4)}`);
    console.log(`   - Google: $${estimatedCostBreakdown.google.toFixed(4)}`);
    console.log(`   - Gemini: $${estimatedCostBreakdown.gemini.toFixed(4)}`);
    console.log(`   - Perplexity: $${estimatedCostBreakdown.perplexity.toFixed(4)}`);
    console.log(`   - Claude: $${estimatedCostBreakdown.claude.toFixed(4)}`);
    console.log('====================================\n');

    // Send initial summary to Slack with estimated costs (only if we processed prompts)
    if (successful > 0 || failed > 0) {
      console.log('📊 Sending initial Slack notification with estimated costs...');
      await sendCronSummary({
        date: new Date().toISOString().split('T')[0],
        total_prompts: prompts.length,
        successful,
        failed,
        duration,
        api_calls_used: apiCallsUsed,
        max_api_calls: MAX_CALLS,
        total_cost: estimatedTotalCost,
        cost_per_prompt: COST_PER_PROMPT,
        avg_cost_per_engine: AVG_COST_PER_ENGINE,
        cost_breakdown: estimatedCostBreakdown,
        is_estimated: true // Flag to indicate these are estimates
      });

      // Schedule actual cost calculation and follow-up notification
      if (processedPromptIds.length > 0) {
        console.log(`📊 Scheduling actual cost calculation for ${processedPromptIds.length} prompts...`);
        
        // Wait a bit for jobs to complete, then send actual costs
        setTimeout(async () => {
          try {
            console.log('\n💰 Calculating actual costs from database...');
            const actualCosts = await getActualCostsForPrompts(processedPromptIds, batchStartTime);
            
            if (actualCosts) {
              const variance = actualCosts.totalActualCost - estimatedTotalCost;
              const variancePercent = estimatedTotalCost > 0 
                ? ((variance / estimatedTotalCost) * 100).toFixed(1)
                : 0;

              console.log(`💰 Actual vs Estimated Cost Analysis:`);
              console.log(`   Estimated: $${estimatedTotalCost.toFixed(6)}`);
              console.log(`   Actual: $${actualCosts.totalActualCost.toFixed(6)}`);
              console.log(`   Variance: $${variance.toFixed(6)} (${variancePercent}%)`);
              console.log(`   Completed: ${actualCosts.completedPrompts}/${processedPromptIds.length} prompts`);

              // Send follow-up Slack notification with actual costs
              await sendCronSummary({
                date: new Date().toISOString().split('T')[0],
                total_prompts: prompts.length,
                successful: actualCosts.completedPrompts,
                failed,
                duration,
                api_calls_used: apiCallsUsed,
                max_api_calls: MAX_CALLS,
                total_cost: actualCosts.totalActualCost,
                cost_per_prompt: actualCosts.completedPrompts > 0 ? actualCosts.totalActualCost / actualCosts.completedPrompts : 0,
                avg_cost_per_engine: actualCosts.totalActualCost / 5, // Rough average
                cost_breakdown: actualCosts.costsByEngine,
                counts_by_engine: actualCosts.countsByEngine,
                avg_cost_per_prompt_by_engine: actualCosts.avgCostPerPromptByEngine,
                is_actual: true, // Flag to indicate these are actual costs
                estimated_cost: estimatedTotalCost,
                cost_variance: variance,
                variance_percent: variancePercent
              });
            } else {
              console.log('⚠️  Could not retrieve actual costs - jobs may still be running');
            }
          } catch (error) {
            console.error('❌ Error calculating actual costs:', error);
          }
        }, 120000); // Wait 2 minutes for jobs to complete
      }
    } else {
      console.log('📊 No prompts processed - skipping Slack notification');
    }
    
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

