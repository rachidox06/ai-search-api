# 🚂 Railway Deployment Guide - Brand Extraction Worker

## 📋 Complete Setup Checklist

- [ ] Add database columns to Supabase
- [ ] Deploy brand-extraction-worker to Railway
- [ ] Configure environment variables
- [ ] Update all 4 existing workers with brand extraction integration
- [ ] Test the full flow

---

## STEP 1: Database Setup (5 minutes)

### Add Required Columns to Supabase

**Open Supabase SQL Editor** and run:

```sql
-- Add brand extraction columns
ALTER TABLE prompt_tracking_results 
ADD COLUMN IF NOT EXISTS extracted_brands JSONB,
ADD COLUMN IF NOT EXISTS brand_extraction_cost NUMERIC(10, 6);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_extracted_brands 
ON prompt_tracking_results USING GIN (extracted_brands);

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'prompt_tracking_results' 
  AND column_name IN ('extracted_brands', 'brand_extraction_cost');
```

**Expected Output:**
```
column_name            | data_type
-----------------------|----------
extracted_brands       | jsonb
brand_extraction_cost  | numeric
```

✅ **Checkpoint:** Columns added successfully

---

## STEP 2: Deploy Brand Extraction Worker to Railway (10 minutes)

### 2.1 Push Code to GitHub (if not already)

```bash
cd /Users/rachid/ai-search-api

# Add brand-extraction-worker to git
git add brand-extraction-worker/
git commit -m "Add brand extraction worker"
git push origin main  # or your branch name
```

### 2.2 Create New Service on Railway

1. **Go to your Railway project** (where you have the other workers)

2. **Click "+ New" → "GitHub Repo"**

3. **Select your repository** (same repo as your other services)

4. **Configure the service:**
   - Service Name: `brand-extraction-worker`
   - Root Directory: `brand-extraction-worker`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`

5. **Click "Deploy"**

### 2.3 Configure Environment Variables

In Railway dashboard → `brand-extraction-worker` → **Variables** tab:

```env
# OpenAI (REQUIRED)
OPENAI_API_KEY=sk-proj-your-key-here

# Supabase (REQUIRED) - Same as your other services
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Redis (REQUIRED) - Use your existing Railway Redis
# Get these from your Redis service in Railway
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password-from-railway
REDIS_TLS=true
```

**🔍 How to get Redis credentials:**
- In Railway → Click on your **Redis service**
- Click **"Variables"** tab
- Copy: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- **Important:** Use `redis.railway.internal` for REDIS_HOST (internal network)

### 2.4 Verify Deployment

**Check logs in Railway:**

You should see:
```
🚀 Brand Extraction Worker Starting...
📋 Queue: brand-extraction-queue
⚡ Concurrency: 10
✅ Worker is running and waiting for jobs...
```

✅ **Checkpoint:** Worker deployed and running

---

## STEP 3: Update Your 4 Existing Workers (15 minutes)

We need to update all 4 workers to automatically queue brand extraction jobs after saving results.

### 3.1 Create Brand Queue Library

**Create new file:** `/Users/rachid/ai-search-api/libs/brandQueue.js`

```javascript
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
```

### 3.2 Update worker.chatgpt.js

**Edit:** `/Users/rachid/ai-search-api/worker.chatgpt.js`

**Add import at the top (line 3):**
```javascript
import { Worker } from 'bullmq';
import { normalizeResponse } from './libs/normalize.js';
import { saveTrackingResult } from './libs/persist.js';
import { queueBrandExtraction } from './libs/brandQueue.js'; // ← ADD THIS
```

**Update the runJob function** (around line 103-114):

```javascript
async function runJob(jobData) {
  // ... existing code ...
  
  // 2. Normalize response with brand analysis
  const normalized = normalizeResponse(
    'chatgpt',
    dataforseoResponse,
    { website_domain, brand_name, brand_aliases },
    { locale }
  );
  
  // 3. Save to tracking table
  const saved = await saveTrackingResult(prompt_id, normalized);
  console.log('✅ Tracking result saved:', saved.id);
  
  // 4. Queue brand extraction ← ADD THIS BLOCK
  await queueBrandExtraction(
    saved.id,              // resultId
    normalized.answer_text, // answerText
    prompt_id,             // promptId
    website_id             // websiteId
  );
  
  // 5. Return result for job queue
  return {
    success: true,
    result_id: saved.id,
    engine: 'chatgpt',
    was_mentioned: normalized.was_mentioned,
    sentiment: normalized.sentiment,
    ranking_position: normalized.ranking_position
  };
}
```

### 3.3 Update worker.gemini.js

**Same changes as worker.chatgpt.js:**

**Add import:**
```javascript
import { queueBrandExtraction } from './libs/brandQueue.js';
```

**After saveTrackingResult (around line 103-104):**
```javascript
const saved = await saveTrackingResult(prompt_id, normalized);
console.log('✅ Tracking result saved:', saved.id);

// Queue brand extraction ← ADD THIS
await queueBrandExtraction(
  saved.id,
  normalized.answer_text,
  prompt_id,
  website_id
);
```

### 3.4 Update worker.google.js

**Same changes:**

**Add import:**
```javascript
import { queueBrandExtraction } from './libs/brandQueue.js';
```

**After saveTrackingResult:**
```javascript
const saved = await saveTrackingResult(prompt_id, normalized);
console.log('✅ Tracking result saved:', saved.id);

// Queue brand extraction ← ADD THIS
await queueBrandExtraction(
  saved.id,
  normalized.answer_text,
  prompt_id,
  website_id
);
```

### 3.5 Update worker.perplexity.js

**Same changes:**

**Add import:**
```javascript
import { queueBrandExtraction } from './libs/brandQueue.js';
```

**After saveTrackingResult:**
```javascript
const saved = await saveTrackingResult(prompt_id, normalized);
console.log('✅ Tracking result saved:', saved.id);

// Queue brand extraction ← ADD THIS
await queueBrandExtraction(
  saved.id,
  normalized.answer_text,
  prompt_id,
  website_id
);
```

✅ **Checkpoint:** All 4 workers updated with brand extraction integration

---

## STEP 4: Deploy Updated Workers to Railway (10 minutes)

### 4.1 Commit and Push Changes

```bash
cd /Users/rachid/ai-search-api

# Add the new library and updated workers
git add libs/brandQueue.js
git add worker.chatgpt.js
git add worker.gemini.js
git add worker.google.js
git add worker.perplexity.js

git commit -m "Add brand extraction integration to all workers"
git push origin main
```

### 4.2 Redeploy Workers on Railway

Railway should automatically redeploy when you push. If not:

1. Go to Railway dashboard
2. For each worker service (chatgpt.worker, gemini.worker, google.worker, perplexity.worker):
   - Click the service
   - Click "Deployments"
   - Click "Deploy" on the latest commit

### 4.3 Verify Workers Are Running

Check logs for each worker. You should see:
```
✅ Brand extraction queue initialized
worker.chatgpt started (DataForSEO) with concurrency: 10
```

✅ **Checkpoint:** All workers redeployed with brand extraction

---

## STEP 5: Environment Variables Summary

### 🔴 Redis Service (Already exists - no changes needed)
```env
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=auto-generated-by-railway
```

### 🔵 Main API Service (dependable-upliftment)
**No changes needed** - already has Redis vars

### 🟢 Brand Extraction Worker (NEW SERVICE)
```env
# OpenAI
OPENAI_API_KEY=sk-proj-...

# Supabase (same as other services)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Redis (from Railway Redis service)
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=<copy-from-redis-service>
REDIS_TLS=true
```

### 🟡 All 4 Existing Workers (chatgpt, gemini, google, perplexity)
**No new environment variables needed** - they already have Redis connection configured!

---

## STEP 6: Testing (5 minutes)

### Test the Complete Flow

**1. Make an API request:**

```bash
curl -X POST https://your-api-url.railway.app/api/v1/tracking/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt_id": "878c7d5e-b211-4660-a09f-e56418b3fd3a",
    "prompt_text": "What are the best project management tools?",
    "engines": ["chatgpt"],
    "locale": "US",
    "website_id": "your-website-id-from-db"
  }'
```

**2. Check Railway logs:**

**chatgpt.worker logs:**
```
🚀 chatgpt job started: { prompt_id: '878c...', ... }
✅ DataForSEO ChatGPT API response received
✅ Tracking result saved: abc-123
[BrandQueue] ✅ Queued brand extraction for result abc-123 (job 1)
```

**brand-extraction-worker logs:**
```
[Processor] Starting extraction for result abc-123
[Processor] Text length: 450 characters
[Processor] ✅ Extracted 3 brands
[Processor] Cost: $0.000234
[Supabase] ✅ Successfully saved brands for abc-123
[Worker] ✅ Job 1 completed
```

**3. Check database:**

```sql
SELECT 
  id,
  engine,
  answer_text,
  extracted_brands,
  brand_extraction_cost
FROM prompt_tracking_results
WHERE prompt_id = '878c7d5e-b211-4660-a09f-e56418b3fd3a'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected result:**
```json
{
  "id": "abc-123",
  "engine": "chatgpt",
  "answer_text": "Here are some great project management tools...",
  "extracted_brands": [
    {
      "name": "Asana",
      "website": "https://asana.com",
      "sentiment": 75,
      "ranking_position": 1
    },
    {
      "name": "Monday.com",
      "website": "https://monday.com",
      "sentiment": 80,
      "ranking_position": 2
    }
  ],
  "brand_extraction_cost": 0.000234
}
```

✅ **Checkpoint:** Brand extraction working end-to-end!

---

## 🎯 Quick Reference: What Changed

### New Files Created:
1. ✅ `brand-extraction-worker/` - Complete new service
2. ✅ `libs/brandQueue.js` - Queue helper library

### Files Modified:
1. ✅ `worker.chatgpt.js` - Added brand queue integration
2. ✅ `worker.gemini.js` - Added brand queue integration
3. ✅ `worker.google.js` - Added brand queue integration
4. ✅ `worker.perplexity.js` - Added brand queue integration

### Railway Services:
- ✅ Added: `brand-extraction-worker` (new service)
- ✅ Updated: All 4 existing workers (auto-redeploy from git push)
- ✅ No changes: Main API, Redis

### Database Changes:
- ✅ Added: `extracted_brands` column (JSONB)
- ✅ Added: `brand_extraction_cost` column (NUMERIC)
- ✅ Added: Index on `extracted_brands`

---

## 🔍 Monitoring

### Check Queue Health

Add this endpoint to your main API (optional):

```javascript
// In index.js
app.get('/api/v1/brand-extraction/stats', async (req, reply) => {
  if (!redisAvailable) return reply.code(503).send({ error: 'redis_unavailable' });
  
  const { Queue } = await import('bullmq');
  const brandQueue = new Queue('brand-extraction-queue', { connection });
  
  const [waiting, active, completed, failed] = await Promise.all([
    brandQueue.getWaitingCount(),
    brandQueue.getActiveCount(),
    brandQueue.getCompletedCount(),
    brandQueue.getFailedCount(),
  ]);
  
  return {
    queue: 'brand-extraction-queue',
    waiting,
    active,
    completed,
    failed,
    total: waiting + active
  };
});
```

### Railway Logs to Monitor

**Brand Extraction Worker:**
- ✅ Job completion messages
- ❌ Job failure messages
- 💰 Cost tracking
- ⏱️ Processing time

**Existing Workers:**
- ✅ "[BrandQueue] Queued brand extraction" messages

---

## ⚠️ Troubleshooting

### Issue: Brand extraction jobs not being processed

**Check:**
1. Is `brand-extraction-worker` service running on Railway?
   - Railway Dashboard → brand-extraction-worker → check status
2. Are environment variables set correctly?
   - Check OPENAI_API_KEY, SUPABASE_SERVICE_KEY, REDIS_* vars
3. Check Redis connection
   - Verify REDIS_HOST, REDIS_PORT, REDIS_PASSWORD match

### Issue: Workers can't queue brand extraction jobs

**Check:**
1. Did you push the updated worker code?
   - `git log` should show the commit
2. Did Railway redeploy the workers?
   - Check "Deployments" tab in Railway
3. Check worker logs for "[BrandQueue]" messages

### Issue: High OpenAI costs

**Solution:**
- Reduce concurrency in `brand-extraction-worker/src/config/index.ts`
- Change from 10 to 5 concurrent jobs
- Redeploy the service

### Issue: Database permission errors

**Check:**
- Using SUPABASE_SERVICE_KEY (not anon key)?
- Service role key has full access?

---

## 💰 Cost Estimates

### OpenAI API Costs:
- **Per extraction:** ~$0.0001 - $0.0005
- **1000 extractions:** ~$0.10 - $0.50
- **10,000 extractions/month:** ~$2 - $5

### Railway Costs:
- **Brand extraction worker:** ~$5/month (starter plan)
- **No additional cost** for existing services (already running)

---

## ✅ Final Checklist

Before marking as complete, verify:

- [ ] Database columns added to Supabase
- [ ] `brand-extraction-worker` deployed to Railway
- [ ] Environment variables configured for brand worker
- [ ] `libs/brandQueue.js` created
- [ ] All 4 workers updated with brand queue integration
- [ ] All 4 workers redeployed on Railway
- [ ] Test API request made
- [ ] Brand extraction job processed successfully
- [ ] Database has `extracted_brands` populated
- [ ] Monitoring logs show success messages

**If all checked:** 🎉 **You're done! Brand extraction is live!**

---

## 📚 Additional Resources

- **Railway Docs:** https://docs.railway.app/
- **BullMQ Docs:** https://docs.bullmq.io/
- **OpenAI Pricing:** https://openai.com/pricing
- **Supabase Docs:** https://supabase.com/docs

---

## 🆘 Need Help?

If you encounter issues:

1. **Check Railway logs** for all services
2. **Run SQL query** to verify database schema
3. **Test Redis connection** from worker logs
4. **Verify environment variables** are set correctly
5. **Check git commit** was pushed and deployed

All detailed troubleshooting steps are in this guide!

