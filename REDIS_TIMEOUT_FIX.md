# Redis Connection Timeout Fix

## Problem
Your Railway deployment was experiencing repeated Redis connection timeout errors:
```
Error: connect ETIMEDOUT
  errorno: 'ETIMEDOUT',
  code: 'ETIMEDOUT',
  syscall: 'connect'
```

## Root Cause
The Redis connections across all workers were configured with minimal settings:
- **No connection timeout** - defaulted to 10 seconds (too short for Railway)
- **No retry strategy** - failed connections didn't retry properly
- **No keepalive** - idle connections were being dropped
- **Incomplete TLS config** - missing `rejectUnauthorized: false` for Railway's self-signed certs
- **No reconnection logic** - workers gave up after first failure

## What Was Fixed

### 1. Brand Extraction Worker Config (`brand-extraction-worker/src/config/index.ts`)
Added comprehensive Redis connection resilience:
```typescript
redis: {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
  // Connection resilience settings
  connectTimeout: 30000,           // 30 seconds to connect
  maxRetriesPerRequest: null,      // Required for BullMQ
  retryStrategy: (times: number) => {
    // Exponential backoff with max delay of 5 seconds
    const delay = Math.min(times * 500, 5000);
    console.log(`[Redis] Retry attempt ${times}, waiting ${delay}ms`);
    return delay;
  },
  // Keep connection alive
  keepAlive: 30000,                // Send keepalive every 30 seconds
  enableReadyCheck: true,
  enableOfflineQueue: true,
  // Reconnection settings
  reconnectOnError: (err: Error) => {
    console.error('[Redis] Connection error:', err.message);
    return true; // Always try to reconnect
  },
}
```

### 2. Updated Files
All Redis connections were updated with the resilient configuration:

✅ **Main API Server**
- `index.js` - Main queue connections

✅ **Worker Files**
- `worker.chatgpt.js` - ChatGPT worker
- `worker.perplexity.js` - Perplexity worker
- `worker.gemini.js` - Gemini worker
- `worker.google.js` - Google worker

✅ **Brand Queue Library**
- `libs/brandQueue.js` - Brand extraction queue

✅ **Brand Extraction Worker**
- `brand-extraction-worker/src/config/index.ts` - Config
- `brand-extraction-worker/src/queue/consumer.ts` - Worker implementation

## New Features

### 1. Longer Connection Timeout
- **Before**: 10 seconds (default)
- **After**: 30 seconds
- **Why**: Railway's Redis can take longer to respond during cold starts

### 2. Exponential Backoff Retry
- Retries on connection failure: 500ms, 1s, 1.5s, 2s, 2.5s, ... up to 5s
- Logs retry attempts for monitoring
- Never gives up - keeps retrying indefinitely

### 3. Keepalive
- Sends ping every 30 seconds
- Prevents Railway from dropping idle connections
- Maintains connection health

### 4. Proper TLS Configuration
- `rejectUnauthorized: false` - accepts Railway's self-signed certificates
- Only enabled when `REDIS_TLS=true` is set

### 5. Offline Queue
- Queues commands when Redis is disconnected
- Automatically sends them when reconnected
- Prevents job loss during brief disconnections

### 6. Automatic Reconnection
- Always tries to reconnect on error
- Logs connection errors for debugging
- Continues retrying until successful

## Deployment Steps

### 1. Verify Environment Variables
Make sure these are set in Railway for ALL services:

```env
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_TLS=true
```

### 2. Deploy Updated Code

**For the main API:**
```bash
git add .
git commit -m "fix: improve Redis connection resilience for Railway"
git push
```

**For brand-extraction-worker:**
```bash
cd brand-extraction-worker
git add .
git commit -m "fix: improve Redis connection resilience for Railway"
git push
```

Railway will automatically redeploy on push.

### 3. Monitor Logs

After deployment, watch Railway logs for:

✅ **Success indicators:**
```
✅ Brand extraction queue initialized
[Worker] ✅ Job completed
Redis connection successful
```

⚠️ **Connection attempts (these are now GOOD - means retry is working):**
```
[Redis] Retry attempt 1, waiting 500ms
[Redis] Retry attempt 2, waiting 1000ms
```

❌ **Errors to watch for:**
```
[Redis] Connection error: <error message>
```

### 4. Test the System

From your local machine, test that everything works:
```bash
# Test your API endpoint
curl -X POST https://your-api.railway.app/api/prompt \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test", "engine": "chatgpt"}'
```

Watch Railway logs to confirm:
1. Job is queued successfully
2. Worker picks up the job
3. No connection timeout errors

## What to Expect

### Normal Operation
You should see much fewer connection errors. Occasional retry messages are NORMAL and GOOD:
```
[Redis] Retry attempt 1, waiting 500ms
✅ Brand extraction queue initialized
```

This means the system is working correctly and recovering from brief network issues.

### If Issues Persist

1. **Check Redis service status** in Railway
   - Is it running?
   - Are there memory/CPU issues?

2. **Verify network settings**
   - Use `redis.railway.internal` (not external hostname)
   - Ensure services are in the same Railway project

3. **Check Redis connection limits**
   - Default: 10,000 connections
   - With 5 workers @ 10 concurrency = 50+ connections
   - Should be well within limits

4. **Increase connection timeout further** (if needed)
   Change `connectTimeout: 30000` to `60000` (60 seconds)

## Technical Details

### Why These Settings Work

1. **connectTimeout: 30000**
   - Railway's internal network can have variable latency
   - 30s gives plenty of time for TCP handshake + TLS negotiation

2. **retryStrategy with exponential backoff**
   - Prevents overwhelming Redis during recovery
   - Gradually backs off to reduce load
   - Caps at 5s to maintain responsiveness

3. **keepAlive: 30000**
   - Railway's proxy may close idle connections
   - Regular pings keep the connection active
   - Detects dead connections early

4. **enableOfflineQueue: true**
   - Commands are queued during disconnection
   - Automatically sent when reconnected
   - Prevents job loss

5. **reconnectOnError: () => true**
   - Network issues in Railway are often transient
   - Always trying to reconnect ensures recovery
   - Logs help with debugging

## Monitoring Commands

Check connection health from Railway's CLI:

```bash
# View live logs
railway logs --follow

# Filter for Redis connection events
railway logs --follow | grep -i redis

# Check for errors
railway logs --follow | grep -i "error\|timeout"
```

## Cost Impact

These changes have **minimal cost impact**:
- Keepalive pings are tiny (few bytes)
- Retry attempts only happen on failures
- More reliable connections = fewer wasted API calls

## Rollback Plan

If these changes cause issues (unlikely), rollback:

```bash
git revert HEAD
git push
```

Then manually set shorter timeouts in Railway environment:
```env
REDIS_CONNECT_TIMEOUT=10000
```

## Questions?

If you still see timeout errors after this fix:

1. Share the full error from Railway logs
2. Check Railway Redis service status/metrics
3. Verify all environment variables are set correctly
4. Consider upgrading Redis plan if hitting connection limits

---

**Status**: ✅ All files updated and compiled successfully
**Action Required**: Deploy to Railway and monitor logs

