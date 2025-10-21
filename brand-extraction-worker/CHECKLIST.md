# ✅ Brand Extraction Worker - Setup Checklist

Use this checklist to track your setup progress.

## 📋 Initial Setup

- [ ] Review `PROJECT_SUMMARY.md` for overview
- [ ] Review `README.md` for detailed documentation
- [ ] Review `SETUP.md` for setup instructions

## 🔧 Local Development Setup

### Redis Setup
- [ ] Install Redis locally
  - Docker: `docker run -d -p 6379:6379 redis:alpine`
  - OR Homebrew: `brew install redis && brew services start redis`
- [ ] Verify Redis is running: `redis-cli ping` (should return "PONG")

### Environment Configuration
- [ ] Navigate to worker directory: `cd brand-extraction-worker`
- [ ] Copy environment template: `cp .env.example .env`
- [ ] Add OpenAI API key to `.env`
- [ ] Add Supabase URL to `.env`
- [ ] Add Supabase Service Role Key to `.env` (not anon key!)
- [ ] Set Redis connection details (use `localhost` for local)

### Database Setup
- [ ] Open Supabase SQL Editor
- [ ] Run schema migration:
  ```sql
  ALTER TABLE prompt_tracking_results 
  ADD COLUMN IF NOT EXISTS extracted_brands JSONB,
  ADD COLUMN IF NOT EXISTS brand_extraction_cost NUMERIC(10, 6);
  
  CREATE INDEX IF NOT EXISTS idx_extracted_brands 
  ON prompt_tracking_results USING GIN (extracted_brands);
  ```
- [ ] Verify columns were added successfully

### Worker Setup
- [ ] Install dependencies: `npm install`
- [ ] Build the project: `npm run build`
- [ ] Verify build succeeded (check `dist/` folder exists)

## 🧪 Testing

### Test the Worker
- [ ] Start the worker: `npm run dev`
- [ ] Verify worker started successfully (check console output)
- [ ] Open a new terminal window
- [ ] Run test script: `npm run test`
- [ ] Check worker terminal for processing logs
- [ ] Verify test job completed successfully
- [ ] Check Supabase for `extracted_brands` data:
  ```sql
  SELECT * FROM prompt_tracking_results 
  WHERE id = 'test-result-123';
  ```

### Verify Extraction Quality
- [ ] Review extracted brands in database
- [ ] Verify brand names are correct
- [ ] Check sentiment scores make sense
- [ ] Confirm ranking positions are accurate
- [ ] Review extraction cost

## 🔗 Integration with Main API

### Install Dependencies in Main API
- [ ] Navigate to main API: `cd /Users/rachid/ai-search-api`
- [ ] Install BullMQ: `npm install bullmq ioredis`
- [ ] Add Redis env vars to main API's `.env`

### Create Queue Client
- [ ] Create `libs/brandExtractionQueue.js` in main API
- [ ] Copy code from `INTEGRATION_GUIDE.md`
- [ ] Update imports in your main API code

### Integrate with Result Persistence
- [ ] Import queue client in your API: `require('./libs/brandExtractionQueue')`
- [ ] Add queue call after saving results
- [ ] Test: Make API request that generates AI response
- [ ] Verify job was queued (check worker logs)
- [ ] Verify brands were extracted and saved

### Add Monitoring (Optional)
- [ ] Add queue stats endpoint to API
- [ ] Test endpoint: `GET /api/brand-extraction/stats`
- [ ] Verify stats are returned correctly

## 🚀 Production Deployment

### Railway Setup
- [ ] Sign up for Railway account (if needed)
- [ ] Install Railway CLI: `npm install -g @railway/cli`
- [ ] Login: `railway login`

### Add Redis to Railway
- [ ] Open Railway Dashboard
- [ ] Click "New" → "Database" → "Redis"
- [ ] Note Redis connection details

### Deploy Worker to Railway
- [ ] Navigate to worker: `cd brand-extraction-worker`
- [ ] Initialize Railway project: `railway init`
- [ ] Deploy: `railway up`
- [ ] Wait for deployment to complete

### Configure Environment Variables in Railway
- [ ] Open Railway Dashboard → Worker Service → Variables
- [ ] Add `OPENAI_API_KEY`
- [ ] Add `SUPABASE_URL`
- [ ] Add `SUPABASE_SERVICE_KEY`
- [ ] Add `REDIS_HOST` (from Railway Redis)
- [ ] Add `REDIS_PORT` (from Railway Redis)
- [ ] Add `REDIS_PASSWORD` (from Railway Redis)
- [ ] Add `REDIS_TLS=true`
- [ ] Save and redeploy

### Deploy Main API to Railway (if not already)
- [ ] Deploy main API to Railway
- [ ] Add Redis connection details to main API's env vars
- [ ] Verify both services can access Redis

### Verify Production Deployment
- [ ] Check worker logs: `railway logs --service brand-extraction-worker`
- [ ] Make API request that should trigger brand extraction
- [ ] Verify job was processed in logs
- [ ] Check database for extracted brands
- [ ] Monitor costs in OpenAI dashboard

## 📊 Monitoring & Optimization

### Set Up Monitoring
- [ ] Create OpenAI API key with spending limits
- [ ] Set up Supabase monitoring/alerts
- [ ] Set up Railway deployment notifications
- [ ] Bookmark Railway logs URL for quick access

### Performance Tuning
- [ ] Monitor average processing time
- [ ] Monitor OpenAI API costs
- [ ] Adjust concurrency if needed (edit `src/config/index.ts`)
- [ ] Implement caching for frequently extracted content (optional)
- [ ] Add filtering for short/generic responses (optional)

### Error Handling
- [ ] Test retry behavior (simulate failures)
- [ ] Verify failed jobs are retried correctly
- [ ] Set up alerts for persistent failures
- [ ] Document common errors and solutions

## 🎓 Optional Enhancements

- [ ] Add BullMQ Dashboard for visual queue monitoring
- [ ] Implement batch processing for higher throughput
- [ ] Add webhook notifications for completed jobs
- [ ] Create analytics dashboard for extracted brands
- [ ] Implement A/B testing for different prompts
- [ ] Add support for other LLM providers (Claude, Gemini)
- [ ] Create brand database for faster lookups
- [ ] Add sentiment analysis improvements
- [ ] Implement brand deduplication across results

## 📚 Documentation Review

- [ ] Read through all documentation files
- [ ] Bookmark important docs for reference
- [ ] Share docs with team members (if applicable)
- [ ] Create internal documentation (if needed)

## 🔒 Security Checklist

- [ ] Verify `.env` is in `.gitignore`
- [ ] Use Supabase Service Role Key (not anon key)
- [ ] Enable TLS for Redis in production
- [ ] Set OpenAI API key spending limits
- [ ] Review Supabase Row Level Security policies
- [ ] Rotate keys regularly (set reminder)
- [ ] Never commit secrets to git
- [ ] Use environment variables for all credentials

## 🎉 Launch Checklist

- [ ] All tests passing ✅
- [ ] Documentation complete ✅
- [ ] Monitoring set up ✅
- [ ] Team trained (if applicable)
- [ ] Backup plan in place
- [ ] Error alerts configured
- [ ] Cost monitoring enabled
- [ ] Performance baselines established

## ✨ You're Done!

Once all items are checked:
1. 🎊 Celebrate your new brand extraction system!
2. 📊 Monitor performance for the first few days
3. 🔧 Tune settings based on real-world usage
4. 📈 Analyze extracted brand data for insights

---

**Questions?** Check the documentation or review the code comments!

**Issues?** See the Troubleshooting section in `PROJECT_SUMMARY.md`

**Need Help?** All code is well-commented and follows best practices!

