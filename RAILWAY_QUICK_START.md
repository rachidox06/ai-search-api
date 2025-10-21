# 🚂 Railway Quick Start - 5 Steps

## ✅ Code is Ready! Here's What to Do:

---

## 1️⃣ Database (2 minutes)

Open **Supabase SQL Editor**, run this:

```sql
ALTER TABLE prompt_tracking_results 
ADD COLUMN IF NOT EXISTS extracted_brands JSONB,
ADD COLUMN IF NOT EXISTS brand_extraction_cost NUMERIC(10, 6);

CREATE INDEX IF NOT EXISTS idx_extracted_brands 
ON prompt_tracking_results USING GIN (extracted_brands);
```

---

## 2️⃣ Push to GitHub (1 minute)

```bash
cd /Users/rachid/ai-search-api
git add .
git commit -m "Add brand extraction worker"
git push origin main
```

---

## 3️⃣ Deploy New Worker (3 minutes)

1. **Railway Dashboard** → **+ New** → **GitHub Repo**
2. Select your repo
3. Settings:
   - Name: `brand-extraction-worker`
   - Root: `brand-extraction-worker`
   - Build: `npm install && npm run build`
   - Start: `npm start`

---

## 4️⃣ Add Environment Variables (2 minutes)

In Railway → `brand-extraction-worker` → **Variables**:

```env
OPENAI_API_KEY=sk-proj-YOUR_KEY
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=eyJ_YOUR_SERVICE_KEY
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=YOUR_REDIS_PASSWORD
REDIS_TLS=true
```

**Get Redis password:**
Railway → Your Redis service → Variables → Copy `REDIS_PASSWORD`

---

## 5️⃣ Test It! (1 minute)

Make an API request, then check database:

```sql
SELECT id, engine, extracted_brands 
FROM prompt_tracking_results 
ORDER BY created_at DESC LIMIT 1;
```

Should see extracted brands! 🎉

---

## That's It!

**No changes needed for:**
- ✅ Your existing 4 workers (auto-deploy from git push)
- ✅ Your main API
- ✅ Redis

**What was added:**
- ✅ `brand-extraction-worker/` - New service
- ✅ `libs/brandQueue.js` - Queue helper
- ✅ Updated all 4 workers to queue brand extraction

---

## Architecture Diagram

```
Your API
   ↓
Redis Queue
   ↓
┌──────┬──────┬──────┬───────┬──────────────┐
│ChatGPT│Gemini│Google│Perplex│Brand Extract│ ← NEW!
└───┬──┴──┬───┴──┬───┴───┬───┴──────┬───────┘
    └─────┴──────┴───────┴──────────┘
                  ↓
              Supabase
```

All workers now automatically queue brand extraction after saving results!

---

## 📚 Full Documentation

- **DEPLOYMENT_CHECKLIST.md** - Step-by-step checklist
- **RAILWAY_DEPLOYMENT_GUIDE.md** - Complete detailed guide
- **brand-extraction-worker/START_HERE.md** - Worker docs

---

## 🎯 Expected Logs

**Your workers will show:**
```
[BrandQueue] ✅ Queued brand extraction for result abc-123
```

**Brand extraction worker will show:**
```
[Processor] ✅ Extracted 3 brands
[Processor] Cost: $0.000234
[Supabase] ✅ Successfully saved brands
```

---

**Total Time: ~10 minutes** ⏱️

**Ready to deploy!** 🚀

