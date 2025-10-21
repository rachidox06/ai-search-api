# 🚀 START HERE - Brand Extraction Worker

## ✅ Project Successfully Created!

Your brand extraction worker is ready to use! This service will automatically analyze AI responses from your API and extract brand mentions, sentiment, and rankings.

---

## 🎯 What This Does

Whenever your API generates an AI response (from ChatGPT, Gemini, etc.), this worker will:

1. **Analyze the response** using OpenAI GPT-4o-mini
2. **Extract all brand mentions** with details:
   - Brand name
   - Official website
   - Sentiment score (0-100)
   - Ranking position (order of appearance)
3. **Save results** to your Supabase database
4. **Track costs** for each extraction

---

## 🏃 Quick Start (5 minutes)

### Option 1: Use the Quick Start Script
```bash
cd brand-extraction-worker
./quick-start.sh
```

### Option 2: Manual Setup
```bash
cd brand-extraction-worker

# 1. Create environment file
cp .env.example .env
# Edit .env with your credentials

# 2. Start Redis (pick one)
docker run -d -p 6379:6379 redis:alpine
# OR
brew install redis && brew services start redis

# 3. Install and build
npm install
npm run build

# 4. Start the worker
npm run dev

# 5. Test it (in another terminal)
npm run test
```

---

## 📁 Project Structure

```
brand-extraction-worker/
│
├── 📚 DOCUMENTATION
│   ├── START_HERE.md ............... ← You are here!
│   ├── PROJECT_SUMMARY.md .......... Project overview & features
│   ├── SETUP.md .................... Detailed setup guide
│   ├── INTEGRATION_GUIDE.md ........ How to integrate with your API
│   ├── CHECKLIST.md ................ Setup progress tracker
│   └── README.md ................... Complete documentation
│
├── 🔧 CONFIGURATION
│   ├── .env.example ................ Environment variables template
│   ├── package.json ................ Dependencies & scripts
│   ├── tsconfig.json ............... TypeScript configuration
│   ├── Dockerfile .................. Railway deployment config
│   └── quick-start.sh .............. Automated setup script
│
├── 💻 SOURCE CODE (src/)
│   ├── index.ts .................... Main entry point
│   ├── config/index.ts ............. Configuration & env vars
│   ├── types/index.ts .............. TypeScript interfaces
│   ├── queue/
│   │   ├── consumer.ts ............. BullMQ worker (processes jobs)
│   │   └── processor.ts ............ Job processing logic
│   ├── services/
│   │   ├── brandExtractor.ts ....... OpenAI integration
│   │   └── supabase.ts ............. Database operations
│   └── test.ts ..................... Test script
│
└── 📦 BUILD OUTPUT (dist/)
    └── Compiled JavaScript files
```

---

## 🎓 Documentation Guide

Read these files in order:

### 1️⃣ **START_HERE.md** (this file)
Quick overview and immediate next steps

### 2️⃣ **PROJECT_SUMMARY.md**
Complete project overview, architecture, and features

### 3️⃣ **SETUP.md**
Step-by-step setup instructions for local development

### 4️⃣ **INTEGRATION_GUIDE.md**
How to integrate with your existing API (`ai-search-api`)

### 5️⃣ **CHECKLIST.md**
Track your setup progress with checkboxes

### 6️⃣ **README.md**
Complete reference documentation

---

## 🔑 Required Environment Variables

Create a `.env` file with these values:

```env
# OpenAI - Get from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-...

# Supabase - Get from your Supabase project settings
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...    # Use SERVICE ROLE key!

# Redis - Use localhost for local development
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false
```

⚠️ **Important:** Use the **Service Role Key** for Supabase, not the anon key!

---

## 🗄️ Database Setup

Run this SQL in your Supabase SQL Editor:

```sql
-- Add columns for brand extraction data
ALTER TABLE prompt_tracking_results 
ADD COLUMN IF NOT EXISTS extracted_brands JSONB,
ADD COLUMN IF NOT EXISTS brand_extraction_cost NUMERIC(10, 6);

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_extracted_brands 
ON prompt_tracking_results USING GIN (extracted_brands);
```

---

## 🧪 Testing

### Test the Worker Alone

Terminal 1 - Start the worker:
```bash
cd brand-extraction-worker
npm run dev
```

Terminal 2 - Add a test job:
```bash
npm run test
```

You should see:
- ✅ Test job added to queue
- ✅ Worker picks up job
- ✅ Brands extracted
- ✅ Results saved to database

### Check the Results

Query your database:
```sql
SELECT 
  id, 
  extracted_brands, 
  brand_extraction_cost 
FROM prompt_tracking_results 
WHERE id = 'test-result-123';
```

---

## 🔗 Integration with Your API

To integrate with your main API at `/Users/rachid/ai-search-api`:

### 1. Install BullMQ in Main API
```bash
cd /Users/rachid/ai-search-api
npm install bullmq ioredis
```

### 2. Create Queue Client

Create `/Users/rachid/ai-search-api/libs/brandExtractionQueue.js`:

```javascript
const { Queue } = require('bullmq');
const { Redis } = require('ioredis');

const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  maxRetriesPerRequest: null,
});

const queue = new Queue('brand-extraction-queue', { connection });

async function queueBrandExtraction(resultId, answerText, promptId, websiteId) {
  await queue.add('extract-brands', {
    resultId,
    answerText,
    promptId,
    websiteId
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }
  });
}

module.exports = { queueBrandExtraction };
```

### 3. Use in Your API

After saving a result:
```javascript
const { queueBrandExtraction } = require('./libs/brandExtractionQueue');

// After saving result to database
await queueBrandExtraction(
  result.id,
  result.answer_text,
  result.prompt_id,
  result.website_id
);
```

📚 **Full integration details:** See `INTEGRATION_GUIDE.md`

---

## 🚀 Deployment to Railway

### 1. Add Redis to Railway
```
Railway Dashboard → New → Database → Redis
```

### 2. Deploy Worker
```bash
cd brand-extraction-worker
railway login
railway init
railway up
```

### 3. Set Environment Variables
Add all variables from your `.env` file to Railway's environment variables section.

📚 **Full deployment guide:** See `SETUP.md` and `README.md`

---

## 📊 What Success Looks Like

### Worker Console Output:
```
🚀 Brand Extraction Worker Starting...
📋 Queue: brand-extraction-queue
⚡ Concurrency: 10
✅ Worker is running and waiting for jobs...

[Processor] Starting extraction for result abc-123
[Processor] ✅ Extracted 3 brands
[Processor] Cost: $0.000234
[Supabase] ✅ Successfully saved brands
[Worker] ✅ Job completed
```

### Database Results:
```json
{
  "id": "abc-123",
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

---

## 💰 Cost Estimates

- **Short response (200 words):** ~$0.0001 per extraction
- **Medium response (500 words):** ~$0.0002 per extraction  
- **Long response (1000 words):** ~$0.0005 per extraction

**Example:** 10,000 extractions/month = $2-5/month

---

## ⚙️ Configuration

Edit `src/config/index.ts` to adjust:

```typescript
{
  concurrency: 10,        // Process 10 jobs in parallel
  maxRetries: 3,          // Retry failed jobs up to 3 times
  model: 'gpt-4o-mini',   // OpenAI model to use
  temperature: 0.3,       // Lower = more consistent
}
```

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| ❌ "Missing environment variable" | Create `.env` file with all required variables |
| ❌ "connect ECONNREFUSED" | Start Redis: `redis-server` or check Docker |
| ❌ "Invalid API Key" | Check `OPENAI_API_KEY` in `.env` |
| ❌ Jobs not processing | 1) Worker running? 2) Redis connected? 3) Check logs |
| ❌ Database errors | Use Supabase **service role key**, not anon key |

Full troubleshooting guide in `PROJECT_SUMMARY.md`

---

## 📚 Next Steps

Choose your path:

### 🎯 I want to test it locally first
1. ✅ Follow the "Quick Start" section above
2. ✅ Review `SETUP.md` for detailed instructions
3. ✅ Use `CHECKLIST.md` to track progress

### 🔗 I want to integrate with my API
1. ✅ Set up worker locally first (Quick Start)
2. ✅ Follow `INTEGRATION_GUIDE.md`
3. ✅ Test end-to-end flow

### 🚀 I want to deploy to production
1. ✅ Test locally first
2. ✅ Follow deployment section in `README.md`
3. ✅ Monitor logs and costs

### 📖 I want to understand how it works
1. ✅ Read `PROJECT_SUMMARY.md`
2. ✅ Review code in `src/` (well-commented)
3. ✅ Check out `README.md` for architecture

---

## ✨ Features Included

✅ Parallel processing (10 concurrent jobs)
✅ Automatic retries with exponential backoff
✅ Rate limiting (50 jobs/second)
✅ Cost tracking per extraction
✅ Detailed logging and monitoring
✅ TypeScript for type safety
✅ Docker support for deployment
✅ Railway-ready configuration
✅ Comprehensive documentation
✅ Test suite included

---

## 🎉 You're Ready!

The brand extraction worker is fully set up and ready to use. Start with the Quick Start section above, then explore the documentation as needed.

**Questions?** Everything is documented in the files listed above!

**Need help?** Check `PROJECT_SUMMARY.md` for troubleshooting tips!

---

**Built with:** Node.js 20, TypeScript, BullMQ, OpenAI, Supabase, Redis

**Status:** ✅ Ready for development and production

**Documentation:** ✅ Complete and comprehensive

**Next:** Follow the Quick Start guide above! 🚀

