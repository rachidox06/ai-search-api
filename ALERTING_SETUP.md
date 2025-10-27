# Phase 1: Alerting System - Implementation Complete ✅

## What Was Implemented

### 1. **Centralized Alerting Library** (`libs/alerting.js`)
- Sends formatted alerts to Slack
- Supports multiple alert types: critical, error, warning, info
- Includes metadata and timestamps
- Reuses same SLACK_WEBHOOK_URL as cron job

### 2. **Job Failure Alerts** (All 5 Workers)
**Integrated in:**
- `worker.chatgpt.js`
- `worker.google.js`
- `worker.gemini.js`
- `worker.perplexity.js`
- `worker.claude.js`

**Alerts sent when:**
- Job fails after all 3 retries
- Includes: engine, prompt_id, job_id, error message, attempt count

### 3. **Brand Extraction Not Queued Alerts** (All 5 Workers)
**Alerts sent when:**
- Result saved successfully BUT brand extraction job wasn't queued
- Reason: empty markdown OR queue error

### 4. **Brand Extraction Failure Alerts**
**Integrated in:**
- `brand-extraction-worker/src/services/alerting.ts`
- `brand-extraction-worker/src/queue/consumer.ts`

**Alerts sent when:**
- Brand extraction fails after 3 retries
- Includes: result_id, error message, attempt count

### 5. **NULL Brands Monitor** (`libs/null-brands-monitor.js`)
**Checks for:**
- Results older than 1 hour with NULL extracted_brands
- Runs every 60 minutes (configurable)
- Alerts for each NULL result with details

---

## Slack Alerts You'll Receive

### 🔴 **Job Failed After 3 Retries**
```
Engine: gemini
Prompt ID: abc-123
Job ID: 456
Error: timeout
Attempts: 3
Service: worker.gemini
```

### ⚠️ **Brand Extraction NOT Queued**
```
Result ID: xyz-789
Reason: empty_markdown
Service: worker
```

### ❌ **Brand Extraction Failed After 3 Retries**
```
Result ID: xyz-789
Error: cannot find parent statement on pldbgapi2 call stack
Attempts: 3
Service: brand-extraction-worker
```

### ⚠️ **NULL Brands Detected**
```
Result ID: xyz-789
Engine: chatgpt
Age: 2h
Answer Length: 5234 chars
Service: monitoring
```

---

## Configuration

### Environment Variables

Already configured (uses same as cron):
- `SLACK_WEBHOOK_URL` - Your Slack webhook URL

New optional variable:
- `NULL_BRANDS_CHECK_INTERVAL_MINUTES` - How often to check (default: 60)

---

## Deployment

### 1. **Deploy Main API + Workers**
```bash
cd /Users/rachid/ai-search-api
git add .
git commit -m "Add Phase 1 alerting system"
git push
```

Railway will auto-deploy all workers with alerting.

### 2. **Deploy Brand Extraction Worker**
Already built! Just push:
```bash
git add brand-extraction-worker/
git commit -m "Add alerting to brand extraction worker"
git push
```

### 3. **Deploy NULL Brands Monitor** (Optional)
Add as a new Railway service:
1. Create new service in Railway
2. Point to same repo
3. Set start command: `node libs/null-brands-monitor.js`
4. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SLACK_WEBHOOK_URL`
   - `NULL_BRANDS_CHECK_INTERVAL_MINUTES=60`

**OR** run it as part of cron-scheduler (add to existing service)

---

## Testing

### Test Job Failure Alert
```bash
# Temporarily break a worker to trigger failure
# Or wait for natural failures (will see in Slack)
```

### Test NULL Brands Alert
```bash
# Run monitor manually
cd /Users/rachid/ai-search-api
node libs/null-brands-monitor.js
```

This will check immediately and send alerts if NULL brands exist.

---

## What to Expect

### Healthy System (No Alerts)
- No Slack messages = everything working!

### When Things Go Wrong
- **Job failures**: You'll know immediately which engine/prompt failed
- **Brand extraction issues**: You'll see if extraction wasn't queued or failed
- **NULL brands**: Hourly check finds old results that never got brands extracted

---

## Next Steps (Phase 2 - Optional)

Future enhancements not yet implemented:
- Track batch completion rates (alert if engines missing)
- Monitor worker zombie state (stuck/not processing)
- Track data quality (empty responses, missing citations)
- Response time monitoring
- Daily digest reports

---

## Files Changed

✅ Created:
- `libs/alerting.js` - Centralized alerting
- `libs/null-brands-monitor.js` - NULL brands monitoring
- `brand-extraction-worker/src/services/alerting.ts` - TS alerting for brand worker

✅ Modified:
- `worker.chatgpt.js` - Added alerting
- `worker.google.js` - Added alerting
- `worker.gemini.js` - Added alerting
- `worker.perplexity.js` - Added alerting
- `worker.claude.js` - Added alerting
- `brand-extraction-worker/src/queue/consumer.ts` - Added alerting
- `brand-extraction-worker/src/queue/processor.ts` - Updated Supabase client per job

---

## Support

If you don't receive alerts when you expect them:
1. Check SLACK_WEBHOOK_URL is set in Railway
2. Check worker logs for `[Alert]` messages
3. Test with null-brands-monitor manually
4. Verify Slack webhook is working (test with curl)

**All Phase 1 alerts are now active!** 🎉

