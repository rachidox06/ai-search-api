# 🧪 Local Testing Guide - Brand Extraction

## What You Need to Test Locally

### ✅ Prerequisites

1. **Redis running locally**
   ```bash
   # Option 1: Docker
   docker run -d -p 6379:6379 redis:alpine
   
   # Option 2: Homebrew
   brew services start redis
   ```

2. **Environment variables in main API** (`.env` file)
   ```env
   # Your existing vars...
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=
   REDIS_TLS=false
   SUPABASE_URL=your-url
   SUPABASE_SERVICE_ROLE_KEY=your-key
   ```

3. **Environment variables in brand-extraction-worker** (`brand-extraction-worker/.env`)
   ```env
   OPENAI_API_KEY=sk-proj-...
   SUPABASE_URL=your-url
   SUPABASE_SERVICE_KEY=your-service-key
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=
   REDIS_TLS=false
   ```

4. **Database columns added** (run in Supabase SQL Editor)
   ```sql
   ALTER TABLE prompt_tracking_results 
   ADD COLUMN IF NOT EXISTS extracted_brands JSONB,
   ADD COLUMN IF NOT EXISTS brand_extraction_cost NUMERIC(10, 6);
   ```

---

## 🚀 Testing Steps

### Option 1: Test with Existing Prompt Results

If prompt `878c7d5e-b211-4660-a09f-e56418b3fd3a` already has results in your database:

**Terminal 1 - Start Brand Extraction Worker:**
```bash
cd brand-extraction-worker
npm run dev
```

**Terminal 2 - Queue Brand Extraction:**
```bash
cd ai-search-api
node test-brand-extraction.js
```

This will:
- ✅ Find existing results for that prompt ID
- ✅ Queue brand extraction jobs
- ✅ Worker processes them automatically

---

### Option 2: Make Fresh API Request (Recommended)

**Terminal 1 - Start Redis:**
```bash
redis-server
# OR if using Docker:
docker run -d -p 6379:6379 redis:alpine
```

**Terminal 2 - Start Your Main API:**
```bash
cd ai-search-api
npm start
# Should start on http://localhost:4000
```

**Terminal 3 - Start One of Your Workers (e.g., ChatGPT):**
```bash
cd ai-search-api
node worker.chatgpt.js
```

**Terminal 4 - Start Brand Extraction Worker:**
```bash
cd brand-extraction-worker
npm run dev
```

**Terminal 5 - Make Test Request:**
```bash
cd ai-search-api

# First, get a valid website_id from your database
# Run this in Supabase SQL Editor:
# SELECT id, domain, brand_name FROM websites LIMIT 1;

# Then make the API request:
curl -X POST http://localhost:4000/api/v1/tracking/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt_id": "878c7d5e-b211-4660-a09f-e56418b3fd3a",
    "prompt_text": "What are the best project management tools for remote teams?",
    "engines": ["chatgpt"],
    "locale": "US",
    "website_id": "YOUR_WEBSITE_ID_HERE"
  }'
```

---

## 📋 What You Need to Tell Me

To make a test request, I need:

1. ✅ **Prompt ID:** `878c7d5e-b211-4660-a09f-e56418b3fd3a` (you provided)
2. ❓ **Website ID:** Get from your database
   ```sql
   SELECT id, domain, brand_name FROM websites LIMIT 1;
   ```
3. ❓ **What do you want to test?**
   - A) Extract brands from existing results?
   - B) Make a new API request and extract brands from the result?

---

## 🎯 Expected Flow

### With Brand Extraction Integration:

```
1. API Request (/api/v1/tracking/run)
   ↓
2. Job queued to prompt-chatgpt queue
   ↓
3. worker.chatgpt.js processes it
   ↓
4. Result saved to prompt_tracking_results
   ↓
5. Brand extraction job queued ← WE NEED TO ADD THIS STEP
   ↓
6. brand-extraction-worker processes it
   ↓
7. extracted_brands saved to database
   ↓
8. Done! ✅
```

### Currently (Missing Step 5):

Your workers save results but **don't queue brand extraction yet**. We need to add that integration!

---

## 🔧 What Needs to be Done

### 1. First, let's test if everything works manually:

```bash
# Terminal 1: Start brand worker
cd brand-extraction-worker && npm run dev

# Terminal 2: Manually queue a job
node test-brand-extraction.js
```

### 2. Then, integrate with your workers:

We need to modify your workers (`worker.chatgpt.js`, `worker.gemini.js`, etc.) to automatically queue brand extraction after saving results.

---

## ❓ Tell Me:

1. **Do you have a website_id you can use for testing?**
   Run this in Supabase:
   ```sql
   SELECT id, domain, brand_name FROM websites LIMIT 1;
   ```

2. **Does prompt `878c7d5e-b211-4660-a09f-e56418b3fd3a` already have results?**
   Check with:
   ```sql
   SELECT id, engine, answer_text FROM prompt_tracking_results 
   WHERE prompt_id = '878c7d5e-b211-4660-a09f-e56418b3fd3a';
   ```

3. **What do you want to test first?**
   - A) Manual brand extraction on existing results
   - B) Full flow: API request → worker → auto brand extraction

Once you tell me, I'll give you the exact commands to run! 🚀

