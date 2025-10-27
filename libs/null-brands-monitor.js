/**
 * NULL Brands Monitor
 * Checks for results with NULL extracted_brands and sends alerts
 * Run periodically to detect brand extraction failures
 */

import { createClient } from '@supabase/supabase-js';
import { alertNullBrands } from './alerting.js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  NULL_BRANDS_CHECK_INTERVAL_MINUTES = '60' // Check every hour by default
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CHECK_INTERVAL = parseInt(NULL_BRANDS_CHECK_INTERVAL_MINUTES);

/**
 * Check for results with NULL extracted_brands older than threshold
 */
async function checkNullBrands() {
  try {
    console.log('\n🔍 Checking for NULL extracted_brands...');
    const checkTime = new Date();
    
    // Find results older than 1 hour with NULL extracted_brands
    const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000)).toISOString();
    
    const { data, error } = await supabase
      .from('prompt_tracking_results')
      .select('id, engine, created_at, answer_text, answer_markdown')
      .is('extracted_brands', null)
      .lt('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(20); // Check last 20 NULL results
    
    if (error) {
      console.error('❌ Query error:', error);
      return;
    }
    
    if (!data || data.length === 0) {
      console.log('✅ No NULL brands found (all good!)');
      return;
    }
    
    console.log(`⚠️  Found ${data.length} results with NULL extracted_brands`);
    
    // Send alert for each NULL brand (with details)
    for (const result of data) {
      const age = Math.round((checkTime.getTime() - new Date(result.created_at).getTime()) / (1000 * 60));
      const ageStr = age < 60 ? `${age}min` : `${Math.round(age / 60)}h`;
      
      const answerLength = result.answer_markdown?.length || result.answer_text?.length || 0;
      
      console.log(`  - Result ${result.id}: engine=${result.engine}, age=${ageStr}, answer_length=${answerLength}`);
      
      await alertNullBrands({
        resultId: result.id,
        engine: result.engine,
        age: ageStr,
        answerLength
      });
      
      // Small delay between alerts to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`📨 Sent ${data.length} NULL brand alerts`);
    
  } catch (error) {
    console.error('❌ Error checking NULL brands:', error);
  }
}

/**
 * Run continuously with interval
 */
async function runMonitor() {
  console.log('🚀 NULL Brands Monitor Started');
  console.log(`📊 Check interval: ${CHECK_INTERVAL} minutes`);
  console.log(`🔗 Supabase: ${SUPABASE_URL}`);
  console.log('====================================\n');
  
  // Run immediately on start
  await checkNullBrands();
  
  // Then run on interval
  setInterval(async () => {
    await checkNullBrands();
  }, CHECK_INTERVAL * 60 * 1000);
}

// Start monitor
runMonitor().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT, shutting down...');
  process.exit(0);
});

