import { createWorker } from './queue/consumer';
import { config } from './config';

async function main() {
  console.log('🚀 Brand Extraction Worker Starting...');
  console.log(`📋 Queue: ${config.queue.name}`);
  console.log(`⚡ Concurrency: ${config.queue.concurrency}`);
  console.log(`🔄 Max Retries: ${config.queue.maxRetries}`);
  console.log(`🤖 OpenAI Model: ${config.openai.model}`);
  console.log('');
  
  const worker = createWorker();
  
  console.log('✅ Worker is running and waiting for jobs...');
  console.log('Press CTRL+C to stop');
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await worker.close();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await worker.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

