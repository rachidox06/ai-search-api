# Brand Extraction Worker - Quick Setup Guide

## ✅ Project Created Successfully!

The brand extraction worker has been set up and is ready to use.

## 📁 What Was Created

```
brand-extraction-worker/
├── src/
│   ├── index.ts                 # ✅ Main entry point
│   ├── queue/
│   │   ├── consumer.ts          # ✅ BullMQ worker
│   │   └── processor.ts         # ✅ Job processor
│   ├── services/
│   │   ├── brandExtractor.ts    # ✅ OpenAI integration
│   │   └── supabase.ts          # ✅ Database operations
│   ├── types/
│   │   └── index.ts             # ✅ TypeScript interfaces
│   └── config/
│       └── index.ts             # ✅ Configuration
├── package.json                 # ✅ Dependencies installed
├── tsconfig.json                # ✅ TypeScript config
├── Dockerfile                   # ✅ Railway deployment
├── .env.example                 # ✅ Environment template
├── .gitignore                   # ✅ Git ignore rules
└── README.md                    # ✅ Full documentation
```

## 🚀 Next Steps

### 1. Set Up Environment Variables

Create a `.env` file in the `brand-extraction-worker` directory:

```bash
cd brand-extraction-worker
cp .env.example .env
```

Then edit `.env` with your actual credentials:

```env
# OpenAI
OPENAI_API_KEY=sk-proj-...

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...

# Redis (for local testing, use localhost)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false
```

### 2. Set Up Local Redis (for testing)

**Option A: Docker**
```bash
docker run -d -p 6379:6379 redis:alpine
```

**Option B: Homebrew (macOS)**
```bash
brew install redis
brew services start redis
```

### 3. Update Supabase Schema

Add the new columns to your `prompt_tracking_results` table:

```sql
ALTER TABLE prompt_tracking_results 
ADD COLUMN IF NOT EXISTS extracted_brands JSONB,
ADD COLUMN IF NOT EXISTS brand_extraction_cost NUMERIC(10, 6);
```

### 4. Run the Worker

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

You should see:
```
🚀 Brand Extraction Worker Starting...
📋 Queue: brand-extraction-queue
⚡ Concurrency: 10
🔄 Max Retries: 3
🤖 OpenAI Model: gpt-4o-mini

✅ Worker is running and waiting for jobs...
Press CTRL+C to stop
```

### 5. Test the Worker

Open a **new terminal** and run the test script:

```bash
cd brand-extraction-worker
npm run test
```

This will add a test job to the queue. You should see output in the worker terminal showing:
- Brand extraction in progress
- Brands found
- Cost calculation
- Database update

## 🔗 Integrate with Your Main API

To add brand extraction jobs from your existing API (`index.js`), add this code:

```javascript
const { Queue } = require('bullmq');
const { Redis } = require('ioredis');

// Create queue connection
const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
});

const brandExtractionQueue = new Queue('brand-extraction-queue', { 
  connection: redisConnection 
});

// After saving a result, queue brand extraction
async function queueBrandExtraction(resultId, answerText, promptId, websiteId) {
  await brandExtractionQueue.add('extract-brands', {
    resultId,
    answerText,
    promptId,
    websiteId
  }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  });
  
  console.log(`✅ Queued brand extraction for result ${resultId}`);
}
```

## 📊 Monitoring

The worker provides detailed logs:

- `[Worker] ✅ Job completed` - Job processed successfully
- `[Worker] ❌ Job failed` - Job failed (will retry)
- `[Processor] Extracted X brands` - Brands found
- `[Processor] Cost: $X.XXXXXX` - OpenAI cost
- `[Supabase] Successfully saved` - Data saved to DB

## 🐳 Deploy to Railway

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

### 3. Set Environment Variables in Railway
Add all the variables from your `.env` file to Railway's environment variables section.

## 🛠️ Configuration Options

Edit `src/config/index.ts` to customize:

| Setting | Default | Description |
|---------|---------|-------------|
| `concurrency` | 10 | Parallel jobs |
| `maxRetries` | 3 | Retry attempts |
| `retryDelay` | 2000ms | Delay between retries |
| `model` | gpt-4o-mini | OpenAI model |
| `temperature` | 0.3 | AI creativity |
| `maxTokens` | 2000 | Max response length |

## 💡 Example Brand Extraction Output

Input text:
```
"Here are some great project management tools: Asana, Monday.com, and Trello."
```

Output:
```json
[
  {
    "name": "Asana",
    "website": "https://asana.com",
    "sentiment": 75,
    "ranking_position": 1
  },
  {
    "name": "Monday.com",
    "website": "https://monday.com",
    "sentiment": 75,
    "ranking_position": 2
  },
  {
    "name": "Trello",
    "website": "https://trello.com",
    "sentiment": 70,
    "ranking_position": 3
  }
]
```

## 🆘 Troubleshooting

**Error: Missing required environment variable**
- Make sure you created a `.env` file with all required variables

**Error: connect ECONNREFUSED**
- Redis is not running. Start Redis locally or check connection settings

**Error: Invalid API key**
- Check your `OPENAI_API_KEY` in `.env`

**No jobs processing**
- Make sure the worker is running (`npm run dev`)
- Check that jobs are being added to the correct queue name

## 📚 Resources

- [BullMQ Documentation](https://docs.bullmq.io/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Supabase Documentation](https://supabase.com/docs)
- [Railway Documentation](https://docs.railway.app/)

---

**Need Help?** Check the full README.md for more details.

