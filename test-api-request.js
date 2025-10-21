#!/usr/bin/env node
// Test script to make API request and trigger brand extraction
// Usage: node test-api-request.js

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:4000';
const PROMPT_ID = '878c7d5e-b211-4660-a09f-e56418b3fd3a';

console.log('\n🧪 API Request Test Script');
console.log('===========================\n');

async function main() {
  try {
    // Test request payload
    const payload = {
      prompt_id: PROMPT_ID,
      prompt_text: 'What are the best project management tools for remote teams?',
      engines: ['chatgpt'],  // Start with just one engine for testing
      locale: 'US',
      website_id: 'test-website-123'  // You'll need to provide a real website_id from your DB
    };
    
    console.log('📤 Sending request to API...');
    console.log(`Endpoint: ${API_URL}/api/v1/tracking/run`);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('');
    
    const response = await fetch(`${API_URL}/api/v1/tracking/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ API Error:', data);
      console.error(`Status: ${response.status}`);
      
      if (data.error === 'website_not_found') {
        console.log('\n💡 Tip: You need a valid website_id from your database.');
        console.log('   Run this query in Supabase to get one:');
        console.log('   SELECT id, domain, brand_name FROM websites LIMIT 1;');
      }
      
      process.exit(1);
    }
    
    console.log('✅ API Response:', JSON.stringify(data, null, 2));
    console.log('');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Request successful!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('🎯 What happens next:');
    console.log('  1. Worker processes the prompt (check worker logs)');
    console.log('  2. Result is saved to prompt_tracking_results');
    console.log('  3. Brand extraction job is queued (after we add integration)');
    console.log('  4. Brand extraction worker processes it\n');
    
    console.log('📊 Job IDs:', data.job_ids);
    console.log('');
    
    console.log('⏱️  Wait ~10-30 seconds, then check results:');
    console.log(`  SELECT * FROM prompt_tracking_results WHERE prompt_id = '${PROMPT_ID}';`);
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();

