// Master worker file - starts all 4 workers
// This ensures all engines are processing jobs

console.log('🚀 Starting all workers...');

// Import all workers - this will start them
import './worker.gemini.js';
import './worker.google.js';
import './worker.perplexity.js';
import './worker.chatgpt.js';

console.log('✅ All 4 workers started:');
console.log('  - Gemini (Google API)');
console.log('  - Google (DataForSEO AI Overview)');
console.log('  - Perplexity');
console.log('  - ChatGPT (DataForSEO)');
console.log('📡 Workers are now listening for jobs...');

// Keep process alive
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, shutting down workers...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('⚠️  SIGINT received, shutting down workers...');
  process.exit(0);
});

