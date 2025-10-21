# Redis Connection Diagnosis - Railway

The timeouts are removed. The real issue is the **connection is failing completely**. Here's how to fix it:

## 🔴 The Real Problem

You're seeing `ETIMEDOUT` which means TCP can't even connect to Redis. This is NOT a timeout setting issue - **Redis is unreachable from your workers**.

## ✅ Fix Checklist

### 1. Check Redis Connection String in Railway

In Railway dashboard, go to your **Redis service** and check the **Connect** tab:

You should see something like:
```
redis://default:password@redis.railway.internal:6379
```

**CRITICAL:** Your workers must use `redis.railway.internal` NOT the public hostname!

### 2. Set These Environment Variables for ALL Workers

Go to **each worker service** in Railway (chatgpt, perplexity, gemini, google, brand-extraction-worker) and verify:

```env
REDIS_HOST=redis.railway.internal
REDIS_PORT=6379
REDIS_PASSWORD=<your-actual-password>
REDIS_TLS=false
```

**⚠️ IMPORTANT: Set `REDIS_TLS=false` for internal Railway connections!**

The internal `.railway.internal` hostname does **NOT use TLS**. TLS is only for external connections.

### 3. Check Network Configuration

All your services must be in the **same Railway project** to use `.railway.internal` networking.

In Railway dashboard:
1. Go to your project
2. Click on **Network** or check each service
3. Verify all services (API, 4 workers, brand-worker, Redis) are in the same project

### 4. Verify Redis is Running

Click on your Redis service in Railway and check:
- ✅ Status: Running (green)
- ✅ No recent restarts/crashes
- ✅ Memory usage < 80%

### 5. Test Connection from One Worker

Add this to the **start** of one worker file temporarily to debug:

```javascript
// At the very top after imports
import { Redis } from 'ioredis';

const testRedis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
});

testRedis.on('connect', () => {
  console.log('✅ REDIS CONNECTED SUCCESSFULLY');
  console.log('Host:', process.env.REDIS_HOST);
  console.log('Port:', process.env.REDIS_PORT);
  console.log('TLS:', process.env.REDIS_TLS);
});

testRedis.on('error', (err) => {
  console.error('❌ REDIS CONNECTION FAILED');
  console.error('Host:', process.env.REDIS_HOST);
  console.error('Port:', process.env.REDIS_PORT);
  console.error('TLS:', process.env.REDIS_TLS);
  console.error('Error:', err.message);
});

// Continue with rest of worker code...
```

Deploy and check logs for the connection info.

## 🎯 Most Likely Issues

### Issue #1: Wrong Hostname (99% of Railway connection problems)
**Problem:** Using external hostname instead of `.railway.internal`
**Fix:**
```env
# ❌ WRONG
REDIS_HOST=redis-production-abc.railway.app

# ✅ CORRECT
REDIS_HOST=redis.railway.internal
```

### Issue #2: TLS on Internal Connection
**Problem:** `REDIS_TLS=true` for internal Railway connections
**Fix:**
```env
# ❌ WRONG for internal
REDIS_TLS=true

# ✅ CORRECT for internal
REDIS_TLS=false
```

Only use `REDIS_TLS=true` if connecting from **outside Railway** (like your local machine).

### Issue #3: Wrong Password
**Problem:** Password doesn't match or has spaces/special chars
**Fix:**
1. Go to Redis service in Railway
2. Go to **Variables** tab
3. Copy `REDIS_PASSWORD` exactly (no spaces)
4. Paste into each worker service

### Issue #4: Services in Different Projects
**Problem:** Workers can't reach Redis because they're in different Railway projects
**Fix:**
- Move all services to the same project, OR
- Use the **external** Redis URL with `REDIS_TLS=true`

## 🔍 Quick Debug Commands

### Check if Redis hostname resolves (in Railway shell):
```bash
nslookup redis.railway.internal
# Should return an IP like 10.x.x.x
```

### Check environment variables (in Railway logs):
Add this to your worker temporarily:
```javascript
console.log('Redis Config:', {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD ? '***SET***' : '***MISSING***',
  tls: process.env.REDIS_TLS
});
```

## 📋 Step-by-Step Fix

1. **Go to Railway Redis service → Variables tab**
   - Note the `REDIS_PASSWORD`

2. **For EACH worker service (5 total: chatgpt, perplexity, gemini, google, brand-extraction):**
   - Click service → Variables tab
   - Set:
     ```
     REDIS_HOST=redis.railway.internal
     REDIS_PORT=6379
     REDIS_PASSWORD=<paste-from-redis-service>
     REDIS_TLS=false
     ```
   - Click **Deploy**

3. **Watch logs for the retry messages to stop**

4. **Done** - connections should work now

## What Changed in Code

I removed:
- ❌ `connectTimeout` - no artificial timeout, will retry forever
- ❌ `keepAlive` - not needed for persistent connections
- ❌ `enableReadyCheck` - skip the ready check that might timeout

Kept:
- ✅ `retryStrategy` - exponential backoff retry
- ✅ `reconnectOnError` - always try to reconnect
- ✅ `enableOfflineQueue` - queue commands during disconnects
- ✅ TLS support (when needed for external connections)

## If Still Failing

Share:
1. Output of the Redis config console.log
2. Screenshot of Railway Redis service **Variables** tab
3. Screenshot of one worker's **Variables** tab
4. Full error message from logs

The issue is 99% the hostname or TLS setting.

