#!/usr/bin/env node
// Test script to make direct Perplexity API call and see raw response
// Usage: node test-perplexity-raw.js
// OR: PERPLEXITY_API_KEY=your_key node test-perplexity-raw.js

const { PERPLEXITY_API_KEY } = process.env;

console.log('\n🧪 Perplexity Raw API Test');
console.log('===========================\n');

async function testPerplexityAPI() {
  if (!PERPLEXITY_API_KEY) {
    console.error('❌ Missing PERPLEXITY_API_KEY in .env file');
    process.exit(1);
  }

  try {
    const url = 'https://api.perplexity.ai/chat/completions';
    
    const payload = {
      model: 'sonar',
      search_mode: 'web',
      messages: [
        {
          role: 'system',
          content: 'Provide detailed, well-researched answers and include citations to sources whenever possible.'
        },
        {
          role: 'user',
          content: 'What are the best project management tools for remote teams?'
        }
      ]
    };

    console.log('📤 Sending request to Perplexity API...');
    console.log(`Endpoint: ${url}`);
    console.log('\nPayload:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n' + '─'.repeat(60) + '\n');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error: ${response.status} ${response.statusText}`);
      console.error(errorText);
      process.exit(1);
    }

    const data = await response.json();

    console.log('✅ RAW PERPLEXITY RESPONSE:');
    console.log('═'.repeat(60));
    console.log(JSON.stringify(data, null, 2));
    console.log('═'.repeat(60));
    console.log('');

    // Check for citations
    console.log('🔍 Citation Analysis:');
    console.log('─'.repeat(60));
    
    if (data.choices && data.choices[0]) {
      const message = data.choices[0].message;
      
      console.log(`✓ Message content exists: ${!!message.content}`);
      console.log(`✓ Message content length: ${message.content?.length || 0} chars`);
      console.log('');
      
      if (message.citations) {
        console.log(`✓ Citations field exists: YES`);
        console.log(`✓ Citations count: ${message.citations.length}`);
        console.log(`✓ Citations array:`, message.citations);
      } else {
        console.log(`✗ Citations field: NOT FOUND`);
      }
      console.log('');
      
      // Check for other possible citation fields
      console.log('Other fields in message object:');
      Object.keys(message).forEach(key => {
        console.log(`  - ${key}: ${typeof message[key]}`);
      });
    }
    
    console.log('');
    console.log('Other top-level fields in response:');
    Object.keys(data).forEach(key => {
      console.log(`  - ${key}: ${typeof data[key]}`);
    });
    
    console.log('\n' + '─'.repeat(60));
    console.log('✅ Test complete!');
    console.log('─'.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testPerplexityAPI();

