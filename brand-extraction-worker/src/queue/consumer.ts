import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config';
import { BrandExtractionJob } from '../types';
import { processBrandExtraction } from './processor';
import { alertBrandExtractionFailed } from '../services/alerting';

export function createWorker(): Worker<BrandExtractionJob> {
  const connection = new Redis({
    ...config.redis,
    // Override maxRetriesPerRequest for worker (must be null for BullMQ)
    maxRetriesPerRequest: null,
  });
  
  const worker = new Worker<BrandExtractionJob>(
    config.queue.name,
    async (job: Job<BrandExtractionJob>) => {
      return await processBrandExtraction(job);
    },
    {
      connection,
      concurrency: config.queue.concurrency, // Process 10 jobs in parallel
      limiter: {
        max: 50,        // Max 50 jobs
        duration: 1000, // per second (rate limiting)
      },
      settings: {
        backoffStrategy: (attemptsMade: number) => {
          // Exponential backoff: 2s, 4s, 8s
          return Math.pow(2, attemptsMade) * config.queue.retryDelay;
        }
      }
    }
  );
  
  // Event listeners
  worker.on('completed', (job: Job<BrandExtractionJob>, result: any) => {
    console.log(`[Worker] ✅ Job ${job.id} completed for result ${job.data.resultId}`);
    console.log(`[Worker] Extracted ${result.brands.length} brands in ${result.processingTime}ms`);
  });
  
  worker.on('failed', async (job: Job<BrandExtractionJob> | undefined, error: Error) => {
    if (job) {
      console.error(`[Worker] ❌ Job ${job.id} failed for result ${job.data.resultId}:`, error.message);
      console.error(`[Worker] Attempt ${job.attemptsMade} of ${config.queue.maxRetries}`);
      
      // Alert on final failure (after all retries)
      if (job.attemptsMade >= config.queue.maxRetries) {
        await alertBrandExtractionFailed({
          resultId: job.data.resultId,
          error: error.message,
          attemptsMade: job.attemptsMade
        });
      }
    }
  });
  
  worker.on('error', (error: Error) => {
    console.error('[Worker] Error:', error);
  });
  
  return worker;
}

