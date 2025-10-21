# ✅ Railway Deployment Checklist

## Quick Overview

**What was changed:**
- ✅ Created `brand-extraction-worker/` (new service)
- ✅ Created `libs/brandQueue.js` (brand extraction queue helper)
- ✅ Updated `worker.chatgpt.js` (added brand extraction)
- ✅ Updated `worker.gemini.js` (added brand extraction)
- ✅ Updated `worker.google.js` (added brand extraction)
- ✅ Updated `worker.perplexity.js` (added brand extraction)

---

## STEP 1: Database Setup (Do this FIRST!)

```sql
-- Run in Supabase SQL Editor
ALTER TABLE prompt_tracking_results 
ADD COLUMN IF NOT EXISTS extracted_brands JSONB,
ADD COLUMN IF NOT EXISTS brand_extraction_cost NUMERIC(10, 6);

CREATE INDEX IF NOT EXISTS idx_extracted_brands 
ON prompt_tracking_results USING GIN (extracted_brands);
```

✅ Done? ☐

---

## STEP 2: Push Code to GitHub

```bash
cd /Users/rachid/ai-search-api

# Check what was changed
git status

# Add all changes
git add brand-extraction-worker/
git add libs/brandQueue.js
git add worker.chatgpt.js
git add worker.gemini.js
git add worker.google.js
git add worker.perplexity.js

# Commit
git commit -m "Add brand extraction worker and integrate with all workers"

# Push
git push origin main
```

✅ Done? ☐

---

## STEP 3: Deploy Brand Extraction Worker to Railway

### 3.1 Create New Service

1. Go to Railway dashboard (your existing project)
2. Click **"+ New"** → **"GitHub Repo"**
3. Select your repo
4. Configure:
   - **Service Name:** `brand-extraction-worker`
   - **Root Directory:** `brand-extraction-worker`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
5. Click **"Deploy"**

✅ Done? ☐

### 3.2 Add Environment Variables

In Railway → `brand-extraction-worker` → **Variables**:

```env
OPENAI_API_KEY=sk-proj-your-key-here
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=<copy-from-your-redis-service>
REDIS_TLS=true
```

**To get Redis credentials:**
- Railway → Your Redis Service → Variables tab
- Copy: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

✅ Done? ☐

### 3.3 Verify Deployment

Check logs in Railway. Should see:
```
🚀 Brand Extraction Worker Starting...
✅ Worker is running and waiting for jobs...
```

✅ Done? ☐

---

## STEP 4: Redeploy Existing Workers

Railway should auto-deploy when you pushed to git. If not:

For each service (chatgpt.worker, gemini.worker, google.worker, perplexity.worker):
1. Go to Railway → Click the service
2. Click **"Deployments"**
3. Click **"Deploy"** on latest commit

✅ Done? ☐

---

## STEP 5: Verify Integration

### Check Worker Logs

**chatgpt.worker logs should show:**
```
✅ Brand extraction queue initialized
worker.chatgpt started (DataForSEO) with concurrency: 10
```

✅ Done? ☐

---

## STEP 6: Test End-to-End

### Make a test API request:

```bash
curl -X POST https://your-api-url.railway.app/api/v1/tracking/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt_id": "878c7d5e-b211-4660-a09f-e56418b3fd3a",
    "prompt_text": "What are the best project management tools?",
    "engines": ["chatgpt"],
    "locale": "US",
    "website_id": "your-website-id"
  }'
```

### Check Logs:

**1. chatgpt.worker:**
```
[BrandQueue] ✅ Queued brand extraction for result abc-123
```

**2. brand-extraction-worker:**
```
[Processor] ✅ Extracted 3 brands
[Supabase] ✅ Successfully saved brands
```

✅ Done? ☐

### Check Database:

```sql
SELECT 
  id, engine, extracted_brands, brand_extraction_cost
FROM prompt_tracking_results
WHERE prompt_id = '878c7d5e-b211-4660-a09f-e56418b3fd3a'
ORDER BY created_at DESC LIMIT 1;
```

Should show extracted brands!

✅ Done? ☐

---

## Environment Variables Summary

### 🔴 Redis (Already exists - NO CHANGES)
```
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=auto-generated
```

### 🟢 brand-extraction-worker (NEW SERVICE)
```
OPENAI_API_KEY=sk-proj-...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=<from-redis-service>
REDIS_TLS=true
```

### 🟡 All 4 Workers (NO NEW VARIABLES NEEDED)
They already have Redis configured!

### 🔵 Main API (NO CHANGES NEEDED)
Already has Redis configured!

---

## What Each Service Does

```
┌─────────────────────┐
│    Main API         │  Receives requests
└─────────────────────┘
          │
          ▼
┌─────────────────────┐
│   Redis Queue       │  Stores jobs
└─────────────────────┘
          │
    ┌─────┴─────┬──────────┬──────────┬────────────┐
    ▼           ▼          ▼          ▼            ▼
┌─────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐
│chatgpt  │ │gemini  │ │google  │ │perplexity│ │  brand-     │
│worker   │ │worker  │ │worker  │ │worker    │ │  extraction │
└─────────┘ └────────┘ └────────┘ └──────────┘ └─────────────┘
     │           │          │          │              │
     └───────────┴──────────┴──────────┴──────────────┘
                     │
                     ▼
              ┌─────────────┐
              │  Supabase   │  Saves results
              └─────────────┘
```

**Flow:**
1. API receives request
2. Worker processes (chatgpt/gemini/etc)
3. Worker saves result to DB
4. **Worker queues brand extraction job** ← NEW!
5. **Brand extraction worker processes** ← NEW!
6. **Brands saved to DB** ← NEW!

---

## 🚨 Troubleshooting

### Brand extraction jobs not processing

**Check:**
1. Is brand-extraction-worker running? (Railway logs)
2. Environment variables set? (OPENAI_API_KEY, etc.)
3. Redis connection working?

### Workers not queuing brand extraction

**Check:**
1. Did git push succeed?
2. Did Railway redeploy workers?
3. Check worker logs for "[BrandQueue]" messages

### Database errors

**Check:**
1. Did you run the ALTER TABLE statements?
2. Using SUPABASE_SERVICE_KEY (not anon key)?

---

## 🎉 Success Criteria

All of these should be ✅:

- [ ] Database columns added
- [ ] Code pushed to GitHub
- [ ] brand-extraction-worker deployed on Railway
- [ ] Environment variables configured
- [ ] All 4 workers redeployed
- [ ] Test request made
- [ ] Brand extraction job processed
- [ ] Database has extracted_brands data
- [ ] Logs show success messages

**If all checked: YOU'RE LIVE!** 🚀

---

## 📚 Full Documentation

- **RAILWAY_DEPLOYMENT_GUIDE.md** - Detailed step-by-step guide
- **brand-extraction-worker/START_HERE.md** - Worker documentation
- **brand-extraction-worker/INTEGRATION_GUIDE.md** - Integration details

---

## 💰 Cost Estimate

- **OpenAI:** ~$2-5/month for 10,000 extractions
- **Railway:** ~$5/month for brand-extraction-worker
- **Total new cost:** ~$7-10/month

---

**Need help?** Check RAILWAY_DEPLOYMENT_GUIDE.md for full details!

