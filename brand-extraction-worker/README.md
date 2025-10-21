# Brand Extraction Worker

A standalone Node.js/TypeScript worker service that processes brand extraction jobs using OpenAI and BullMQ.

## Features

- ✅ Processes jobs in parallel (10 concurrent jobs by default)
- ✅ Automatic retries with exponential backoff
- ✅ Rate limiting (50 jobs/second)
- ✅ Cost tracking per extraction
- ✅ Supabase integration for storing results
- ✅ Redis queue with BullMQ
- ✅ Railway-ready with Dockerfile

## Architecture

```
Redis Queue → BullMQ Worker → OpenAI API → Supabase DB
```

## Setup

### 1. Install Dependencies

```bash
cd brand-extraction-worker
npm install
```

### 2. Configure Environment Variables

Create a `.env` file:

```env
# OpenAI
OPENAI_API_KEY=sk-...

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false
```

### 3. Run the Worker

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

## Testing

Run the test script to add a sample job to the queue:

```bash
npm run test
```

This will add a test job with sample text containing brand names.

## How It Works

### 1. Job Structure

Jobs are added to the Redis queue with the following structure:

```typescript
{
  resultId: string;      // prompt_tracking_results.id
  answerText: string;    // Full AI response text to analyze
  promptId: string;      // For reference
  websiteId: string;     // For reference
}
```

### 2. Brand Extraction

The worker uses OpenAI's GPT-4o-mini to extract brands from the answer text. For each brand, it extracts:

- **name**: Brand name as it appears in the text
- **website**: Official homepage URL (null if unknown)
- **sentiment**: Score from 0-100 (0 = negative, 50 = neutral, 100 = positive)
- **ranking_position**: Order of appearance (1-based)

### 3. Cost Tracking

The worker tracks OpenAI API costs:
- GPT-4o-mini: $0.15/M input tokens, $0.60/M output tokens
- Total cost is saved with the extraction results

### 4. Result Storage

Results are temporarily stored in the `prompt_tracking_results` table:
- `extracted_brands`: JSONB array of brand objects
- `brand_extraction_cost`: Total extraction cost in USD

## Configuration

Edit `src/config/index.ts` to adjust:

- **Concurrency**: Number of parallel jobs (default: 10)
- **Max Retries**: Retry attempts on failure (default: 3)
- **Rate Limiting**: Jobs per second (default: 50)
- **OpenAI Model**: Model to use (default: gpt-4o-mini)

## Deployment to Railway

### 1. Add Redis to Railway

```
Railway Dashboard → New → Database → Redis
```

Copy the Redis credentials (host, port, password).

### 2. Deploy the Worker

```bash
# From the brand-extraction-worker directory
railway login
railway init
railway up
```

### 3. Add Environment Variables

In Railway dashboard, add:
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_TLS=true`

## Adding Jobs to the Queue

From your main API or any Node.js service:

```typescript
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const connection = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
});

const queue = new Queue('brand-extraction-queue', { connection });

// Add a job
await queue.add('extract-brands', {
  resultId: 'result-uuid',
  answerText: 'Your AI response text here...',
  promptId: 'prompt-uuid',
  websiteId: 'website-uuid'
}, {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000
  }
});
```

## Monitoring

The worker logs:
- ✅ Job completion with brand count
- ❌ Job failures with error messages
- 💰 Processing costs
- ⏱️ Processing time

## Project Structure

```
brand-extraction-worker/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── queue/
│   │   ├── consumer.ts          # BullMQ worker setup
│   │   └── processor.ts         # Job processing logic
│   ├── services/
│   │   ├── brandExtractor.ts    # OpenAI integration
│   │   └── supabase.ts          # Supabase client
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   └── config/
│       └── index.ts             # Configuration & env vars
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example
```

## License

MIT

