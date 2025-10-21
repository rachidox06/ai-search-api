import { Queue } from 'bullmq';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD } = process.env;

// Create brand extraction queue (shared by all workers)
let brandExtractionQueue = null;

// Initialize queue with connection
function getBrandQueue() {
  if (!brandExtractionQueue && REDIS_HOST) {
    brandExtractionQueue = new Queue('brand-extraction-queue', {
      connection: {
        host: REDIS_HOST,
        port: Number(REDIS_PORT),
        password: REDIS_PASSWORD
      }
    });
    console.log('✅ Brand extraction queue initialized');
  }
  return brandExtractionQueue;
}

/**
 * Queue a brand extraction job
 * @param {string} resultId - The saved result ID from prompt_tracking_results
 * @param {string} answerText - The answer text to analyze
 * @param {string} promptId - The prompt ID for reference
 * @param {string} websiteId - The website ID for reference
 */
export async function queueBrandExtraction(resultId, answerText, promptId, websiteId) {
  // Skip if no answer text or Redis not available
  if (!answerText || answerText.trim().length === 0) {
    console.log(`[BrandQueue] Skipping extraction for ${resultId} - no answer text`);
    return null;
  }

  if (!REDIS_HOST) {
    console.log('[BrandQueue] Redis not configured, skipping brand extraction');
    return null;
  }

  try {
    const queue = getBrandQueue();
    if (!queue) return null;

    const job = await queue.add('extract-brands', {
      resultId,
      answerText,
      promptId,
      websiteId
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: {
        age: 3600, // Keep for 1 hour
        count: 1000
      },
      removeOnFail: {
        age: 86400 // Keep failed jobs for 24 hours
      }
    });

    console.log(`[BrandQueue] ✅ Queued brand extraction for result ${resultId} (job ${job.id})`);
    return job.id;
  } catch (error) {
    console.error(`[BrandQueue] ❌ Failed to queue brand extraction:`, error.message);
    return null;
  }
}

export default { queueBrandExtraction };

