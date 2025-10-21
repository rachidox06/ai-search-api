# Integration Guide: Connecting Brand Extraction Worker to Your API

This guide shows how to integrate the brand extraction worker with your existing `ai-search-api` project.

## Step 1: Install BullMQ in Main API

From your main project directory (`/Users/rachid/ai-search-api`):

```bash
npm install bullmq ioredis
```

## Step 2: Add Redis Configuration to Main API

Add these environment variables to your main API's `.env`:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false
```

## Step 3: Create Queue Client in Main API

Create a new file: `/Users/rachid/ai-search-api/libs/brandExtractionQueue.js`

```javascript
const { Queue } = require('bullmq');
const { Redis } = require('ioredis');

// Create Redis connection
const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  maxRetriesPerRequest: null, // Required for BullMQ
});

// Create the brand extraction queue
const brandExtractionQueue = new Queue('brand-extraction-queue', { 
  connection: redisConnection 
});

/**
 * Queue a brand extraction job
 * @param {string} resultId - The prompt_tracking_results.id
 * @param {string} answerText - The full AI response text
 * @param {string} promptId - The prompt ID for reference
 * @param {string} websiteId - The website ID for reference
 */
async function queueBrandExtraction(resultId, answerText, promptId, websiteId) {
  if (!answerText || answerText.trim().length === 0) {
    console.log(`[BrandQueue] Skipping empty answer text for result ${resultId}`);
    return null;
  }

  try {
    const job = await brandExtractionQueue.add('extract-brands', {
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
        age: 3600, // Remove completed jobs after 1 hour
        count: 1000 // Keep max 1000 completed jobs
      },
      removeOnFail: {
        age: 86400 // Remove failed jobs after 24 hours
      }
    });
    
    console.log(`[BrandQueue] ✅ Queued brand extraction for result ${resultId} (job ${job.id})`);
    return job.id;
  } catch (error) {
    console.error(`[BrandQueue] ❌ Failed to queue brand extraction:`, error.message);
    return null;
  }
}

/**
 * Get queue statistics
 */
async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    brandExtractionQueue.getWaitingCount(),
    brandExtractionQueue.getActiveCount(),
    brandExtractionQueue.getCompletedCount(),
    brandExtractionQueue.getFailedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    total: waiting + active + completed + failed
  };
}

/**
 * Close the queue connection
 */
async function closeQueue() {
  await brandExtractionQueue.close();
  await redisConnection.quit();
}

module.exports = {
  queueBrandExtraction,
  getQueueStats,
  closeQueue,
  brandExtractionQueue
};
```

## Step 4: Update Your Result Persistence Logic

In your `index.js` or wherever you save results, add the queue call:

```javascript
const { queueBrandExtraction } = require('./libs/brandExtractionQueue');

// After saving a result to the database
async function saveResultAndQueueExtraction(result) {
  // Your existing code to save result to Supabase
  const { data, error } = await supabase
    .from('prompt_tracking_results')
    .insert({
      id: result.id,
      prompt_id: result.promptId,
      website_id: result.websiteId,
      answer_text: result.answerText,
      // ... other fields
    })
    .select()
    .single();

  if (!error && data) {
    // Queue brand extraction job
    await queueBrandExtraction(
      data.id,
      data.answer_text,
      data.prompt_id,
      data.website_id
    );
  }

  return { data, error };
}
```

## Step 5: Add Queue Monitoring Endpoint (Optional)

Add this endpoint to your API to monitor the queue:

```javascript
// In your Express app
app.get('/api/brand-extraction/stats', async (req, res) => {
  const { getQueueStats } = require('./libs/brandExtractionQueue');
  
  try {
    const stats = await getQueueStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

## Step 6: Database Schema Update

Make sure your `prompt_tracking_results` table has these columns:

```sql
-- Add to your Supabase database
ALTER TABLE prompt_tracking_results 
ADD COLUMN IF NOT EXISTS extracted_brands JSONB,
ADD COLUMN IF NOT EXISTS brand_extraction_cost NUMERIC(10, 6);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_extracted_brands ON prompt_tracking_results USING GIN (extracted_brands);
```

## Step 7: Start Everything

### Terminal 1: Start Redis (local development)
```bash
redis-server
```

### Terminal 2: Start the Brand Extraction Worker
```bash
cd brand-extraction-worker
npm run dev
```

### Terminal 3: Start Your Main API
```bash
cd ai-search-api
npm start
```

## Testing the Integration

### 1. Test with a Real Request

Make a request to your API that generates an AI response. The brand extraction should happen automatically.

### 2. Check Queue Statistics

```bash
curl http://localhost:YOUR_PORT/api/brand-extraction/stats
```

Response:
```json
{
  "success": true,
  "stats": {
    "waiting": 0,
    "active": 1,
    "completed": 15,
    "failed": 0,
    "total": 16
  }
}
```

### 3. Check Database for Results

```sql
SELECT 
  id, 
  answer_text,
  extracted_brands,
  brand_extraction_cost
FROM prompt_tracking_results
WHERE extracted_brands IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

## Example: Complete Flow

```javascript
// Your API receives a search query
POST /api/search
{
  "query": "best project management tools",
  "websiteId": "site-123"
}

// 1. Your API calls ChatGPT/Gemini/etc
const aiResponse = await callAI(query);

// 2. Save result to database
const result = await saveResult({
  promptId: 'prompt-123',
  websiteId: 'site-123',
  answerText: aiResponse.text,
  // ... other fields
});

// 3. Queue brand extraction (happens automatically in saveResult)
await queueBrandExtraction(
  result.id,
  result.answerText,
  'prompt-123',
  'site-123'
);

// 4. Worker picks up the job and processes it
// 5. Worker calls OpenAI to extract brands
// 6. Worker saves results back to database
// 7. Your database now has extracted_brands populated!
```

## Production Deployment

### Railway Setup

1. **Deploy Main API to Railway**
   - Set all environment variables including Redis credentials

2. **Deploy Worker to Railway**
   - Use the same Redis instance
   - Set all environment variables

3. **Add Redis on Railway**
   - Railway Dashboard → Add Database → Redis
   - Copy credentials to both services

### Environment Variables for Production

**Main API:**
```env
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=xxxxx
REDIS_TLS=true
```

**Worker:**
```env
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=xxxxx
REDIS_TLS=true
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...
```

## Monitoring in Production

### 1. Worker Logs
```bash
railway logs --service brand-extraction-worker
```

### 2. Queue Metrics via BullMQ Dashboard (Optional)

Install the BullMQ dashboard:
```bash
npm install -g bull-board
bull-board --redis redis://localhost:6379
```

Then visit: `http://localhost:3000`

## Troubleshooting

### Issue: Jobs not being processed
**Solution:** Make sure the worker is running and connected to the same Redis instance

### Issue: High costs
**Solution:** Reduce concurrency in `src/config/index.ts` or implement rate limiting

### Issue: Database timeouts
**Solution:** Increase Supabase connection pool size or add connection retry logic

### Issue: Jobs failing repeatedly
**Solution:** Check worker logs for specific errors. Most common issues:
- Invalid OpenAI API key
- Supabase permissions (need service role key)
- Network connectivity

## Next Steps

1. ✅ Set up local Redis for testing
2. ✅ Create `.env` files for both main API and worker
3. ✅ Update database schema
4. ✅ Add queue integration to your API
5. ✅ Test locally
6. ✅ Deploy to Railway
7. 🎉 Monitor and optimize!

## Performance Tips

1. **Batch Processing**: Queue multiple jobs at once for better throughput
2. **Concurrency**: Adjust based on your OpenAI rate limits
3. **Caching**: Consider caching brand extractions for similar texts
4. **Filtering**: Skip brand extraction for short or generic responses

## Questions?

Check the main README.md or SETUP.md for more details!

