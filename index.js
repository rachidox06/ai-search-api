// ai-search-api/index.js  — per-engine queues + batch + SSE

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Queue as BullQueue } from 'bullmq';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const {
  PORT = 4000,
  CORS_ORIGINS = 'http://localhost:8501',
  REDIS_HOST,
  REDIS_PORT = 6379,
  REDIS_PASSWORD,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET,
  SKIP_AUTH = 'true',
} = process.env;

// Initialize Supabase client for context fetching
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const hasRedis = Boolean(REDIS_HOST);
const connection = hasRedis
  ? { host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PASSWORD }
  : null;

// Test Redis connectivity on startup
let redisAvailable = false;
if (hasRedis) {
  try {
    const testQueue = new BullQueue('test-connection', { connection });
    await testQueue.add('test', { test: true });
    await testQueue.close();
    redisAvailable = true;
    console.log('Redis connection successful');
  } catch (error) {
    console.error('Redis connection failed on startup:', error.message);
    redisAvailable = false;
  }
}

// Per-engine queues (must match worker queue names)
const queues = redisAvailable
  ? {
      chatgpt:    new BullQueue('prompt-chatgpt',    { connection }),
      perplexity: new BullQueue('prompt-perplexity', { connection }),
      gemini:     new BullQueue('prompt-gemini',     { connection }),
      google:     new BullQueue('prompt-google',     { connection }),
    }
  : {};

const app = Fastify({ logger: true });

// --- CORS ---
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = CORS_ORIGINS.split(',').map(s => s.trim());
    cb(null, allowed.includes(origin));
  },
  credentials: true,
});

// --- Auth hook ---
app.addHook('preHandler', async (req, res) => {
  if (req.routerPath?.startsWith('/health') || req.routerPath?.startsWith('/ready')) return;
  if (SKIP_AUTH === 'true') return;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.code(401).send({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, SUPABASE_JWT_SECRET);
    req.user = { sub: payload.sub, email: payload.email };
  } catch {
    return res.code(401).send({ error: 'invalid_token' });
  }
});

// --- Helper: Fetch website context from Supabase ---
async function fetchWebsiteContext(website_id) {
  if (!website_id) return null;
  
  try {
    const { data, error } = await supabase
      .from('websites')
      .select('domain, brand_name, brand_aliases')
      .eq('id', website_id)
      .single();
    
    if (error) {
      console.error('Failed to fetch website context:', error.message);
      return null;
    }
    
    return {
      website_domain: data.domain,
      brand_name: data.brand_name,
      brand_aliases: data.brand_aliases || []
    };
  } catch (err) {
    console.error('Error fetching website context:', err.message);
    return null;
  }
}

// --- In-memory fallback (no Redis) ---
const memJobs = new Map();

// --- Health ---
app.get('/health', async () => ({ ok: true }));
app.get('/ready', async () => ({ ok: true }));

// --- New Tracking Endpoint: POST /api/v1/tracking/run ---
app.post('/api/v1/tracking/run', async (req, reply) => {
  const { 
    prompt_id,      // REQUIRED
    prompt_text,    // REQUIRED
    engines = ['chatgpt'], 
    locale = 'US',
    website_id      // REQUIRED
  } = req.body || {};

  // Validation
  if (!prompt_id || !prompt_text || !website_id) {
    return reply.code(400).send({ 
      error: 'prompt_id, prompt_text, and website_id are required' 
    });
  }

  if (!redisAvailable) return reply.code(503).send({ error: 'redis_unavailable' });

  // Fetch website/brand context from Supabase
  const { data: website, error: websiteError } = await supabase
    .from('websites')
    .select('domain, brand_name, brand_aliases')
    .eq('id', website_id)
    .single();

  if (websiteError || !website) {
    return reply.code(404).send({ error: 'website_not_found' });
  }

  const job_ids = {};

  // Queue jobs for each selected engine
  for (const engine of engines) {
    const q = queues[engine];
    if (!q) continue;

    try {
      const job = await q.add('run', {
        prompt_id,
        prompt_text,
        locale,
        engine,
        website_id,
        website_domain: website.domain,
        brand_name: website.brand_name,
        brand_aliases: website.brand_aliases || [],
        user_id: req.user?.sub || null,
        created_at: Date.now()
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 600 },
        removeOnFail: { age: 86400 },
      });

      job_ids[engine] = job.id;
    } catch (error) {
      console.error('Queue error:', error.message, error.code, error.name);
      // Redis connection failure - return 503 Service Unavailable
      if (error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('Redis connection') ||
          error.message?.includes('getaddrinfo ENOTFOUND') ||
          error.message?.includes('Connection timed out') ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ETIMEDOUT') {
        return reply.code(503).send({ error: 'redis_unavailable' });
      }
      // Other queue errors - re-throw as 500
      throw error;
    }
  }

  return reply.send({ 
    success: true,
    prompt_id,
    job_ids 
  });
});

// --- Legacy Single-run (per engine) - DEPRECATED, use /api/v1/tracking/run ---
app.post('/api/v1/prompt-runs', async (req, reply) => {
  const { prompt, engine = 'chatgpt', locale = 'US', persona = 'default', session_id } = req.body || {};
  if (!prompt) return reply.code(400).send({ error: 'prompt is required' });

  const idem = (req.headers['idempotency-key'] || '').toString().trim();
  const user_id = req.user?.sub || null;
  const payload = { prompt, engine, locale, persona, user_id, session_id, created_at: Date.now() };

  // With Redis: push to the engine's queue
  if (redisAvailable) {
    const q = queues[engine];
    if (!q) return reply.code(400).send({ error: `unsupported engine: ${engine}` });

    try {
      const job = await q.add('run', payload, {
        jobId: idem || undefined,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 600 },  // keep 10m so clients can read
        removeOnFail: { age: 86400 },
      });
      return reply.send({ job_id: job.id });
    } catch (error) {
      console.error('Queue error:', error.message, error.code, error.name);
      // Redis connection failure - return 503 Service Unavailable
      if (error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('Redis connection') ||
          error.message?.includes('getaddrinfo ENOTFOUND') ||
          error.message?.includes('Connection timed out') ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ETIMEDOUT') {
        return reply.code(503).send({ error: 'redis_unavailable' });
      }
      // BullMQ validation errors (like invalid jobId) - return 400 Bad Request
      if (error.message?.includes('Custom Id cannot contain') ||
          error.message?.includes('Invalid jobId')) {
        return reply.code(400).send({ error: 'invalid_idempotency_key' });
      }
      // Other queue errors - re-throw as 500
      throw error;
    }
  }

  // No Redis: mock fallback
  const id = String(Date.now());
  memJobs.set(id, { status: 'running' });
  setTimeout(() => {
    memJobs.set(id, {
      status: 'done',
      result: {
        answer: `Mocked answer for: "${prompt}"`,
        citations: ['https://example.com'],
      },
    });
  }, 1500);
  return reply.send({ job_id: id });
});

// --- Get status/result: search all engine queues ---
async function getJobStatus(id, reply) {
  if (redisAvailable) {
    for (const q of Object.values(queues)) {
      try {
        const job = await q.getJob(id);
        if (!job) continue;
        const st = await job.getState(); // waiting|active|delayed|completed|failed
        if (st === 'completed') {
          return reply.send({ status: 'done', result: await job.returnvalue });
        }
        if (st === 'failed') {
          return reply.send({ status: 'error', error: job.failedReason });
        }
        return reply.send({ status: st });
      } catch (error) {
        // Redis connection failure - return 503 Service Unavailable
        if (error.message?.includes('ECONNREFUSED') ||
            error.message?.includes('Redis connection') ||
            error.code === 'ECONNREFUSED') {
          return reply.code(503).send({ error: 'redis_unavailable' });
        }
        // Other queue errors - re-throw as 500
        throw error;
      }
    }
    return reply.code(404).send({ error: 'not_found' });
  }

  if (!memJobs.has(id)) return reply.code(404).send({ error: 'not_found' });
  return reply.send(memJobs.get(id));
}

// New tracking status endpoint
app.get('/api/v1/tracking/status/:job_id', async (req, reply) => {
  const { job_id } = req.params;
  return getJobStatus(job_id, reply);
});

// Legacy status endpoint
app.get('/api/v1/prompt-runs/:id', async (req, reply) => {
  const { id } = req.params;
  return getJobStatus(id, reply);
});

// --- New Tracking Batch Endpoint: POST /api/v1/tracking/batch ---
app.post('/api/v1/tracking/batch', async (req, reply) => {
  const { 
    prompt_id,      // REQUIRED
    prompt_text,    // REQUIRED
    engines = ['chatgpt', 'perplexity'], 
    locale = 'US',
    website_id      // REQUIRED
  } = req.body || {};

  // Validation
  if (!prompt_id || !prompt_text || !website_id) {
    return reply.code(400).send({ 
      error: 'prompt_id, prompt_text, and website_id are required' 
    });
  }

  if (!Array.isArray(engines) || engines.length === 0) {
    return reply.code(400).send({ error: 'engines[] array is required' });
  }

  if (!redisAvailable) return reply.code(503).send({ error: 'redis_unavailable' });

  // Fetch website/brand context from Supabase
  const { data: website, error: websiteError } = await supabase
    .from('websites')
    .select('domain, brand_name, brand_aliases')
    .eq('id', website_id)
    .single();

  if (websiteError || !website) {
    return reply.code(404).send({ error: 'website_not_found' });
  }

  const group_id = randomUUID();
  const job_ids = {};

  // Queue jobs for each selected engine
  for (const engine of engines) {
    const q = queues[engine];
    if (!q) continue;

    try {
      const job = await q.add('run', {
        prompt_id,
        prompt_text,
        locale,
        engine,
        website_id,
        website_domain: website.domain,
        brand_name: website.brand_name,
        brand_aliases: website.brand_aliases || [],
        user_id: req.user?.sub || null,
        group_id,
        created_at: Date.now()
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 600 },
        removeOnFail: { age: 86400 },
      });

      job_ids[engine] = job.id;
    } catch (error) {
      console.error('Queue error:', error.message, error.code, error.name);
      // Redis connection failure - return 503 Service Unavailable
      if (error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('Redis connection') ||
          error.message?.includes('getaddrinfo ENOTFOUND') ||
          error.message?.includes('Connection timed out') ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ETIMEDOUT') {
        return reply.code(503).send({ error: 'redis_unavailable' });
      }
      // Other queue errors - re-throw as 500
      throw error;
    }
  }

  return reply.send({ 
    success: true,
    prompt_id,
    group_id,
    job_ids 
  });
});

// --- Legacy Batch: fan-out to multiple engines ---
app.post('/api/v1/prompt-runs/batch', async (req, reply) => {
  const { 
    prompt_id,
    prompt_text, 
    engines = ['chatgpt', 'perplexity', 'gemini', 'google'],
    locale = 'US', 
    website_id,
    website_domain,
    brand_name,
    brand_aliases
  } = (req.body || {});
  
  // Validate required fields
  if (!prompt_id) return reply.code(400).send({ error: 'prompt_id is required' });
  if (!prompt_text) return reply.code(400).send({ error: 'prompt_text is required' });
  if (!Array.isArray(engines) || engines.length === 0) {
    return reply.code(400).send({ error: 'engines[] array is required' });
  }
  if (!redisAvailable) return reply.code(503).send({ error: 'redis_unavailable' });

  // Fetch website context from Supabase if not provided
  let websiteContext = { website_domain, brand_name, brand_aliases };
  if (website_id && (!website_domain || !brand_name)) {
    const fetchedContext = await fetchWebsiteContext(website_id);
    if (fetchedContext) {
      websiteContext = { ...websiteContext, ...fetchedContext };
    }
  }

  const idem = (req.headers['idempotency-key'] || '').toString().trim();
  const user_id = req.user?.sub || null;
  const group_id = randomUUID();
  const job_ids = {};

  // Build job payload with new format
  const basePayload = {
    prompt_id,
    prompt_text,
    locale,
    website_id: website_id || null,
    website_domain: websiteContext.website_domain || null,
    brand_name: websiteContext.brand_name || null,
    brand_aliases: websiteContext.brand_aliases || [],
    user_id,
    group_id,
    created_at: Date.now()
  };

  for (const eng of engines) {
    const q = queues[eng];
    if (!q) return reply.code(400).send({ error: `unsupported engine: ${eng}` });

    try {
      // Create unique jobId by replacing colons with dashes
      const sanitizedIdem = idem.replace(/:/g, '-');
      const job = await q.add('run', { ...basePayload, engine: eng }, {
        jobId: idem ? `${sanitizedIdem}-${eng}` : undefined,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 600 },
        removeOnFail: { age: 86400 },
      });
      job_ids[eng] = job.id;
    } catch (error) {
      console.error('Queue error:', error.message, error.code, error.name);
      // Redis connection failure - return 503 Service Unavailable
      if (error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('Redis connection') ||
          error.message?.includes('getaddrinfo ENOTFOUND') ||
          error.message?.includes('Connection timed out') ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ETIMEDOUT') {
        return reply.code(503).send({ error: 'redis_unavailable' });
      }
      // BullMQ validation errors (like invalid jobId) - return 400 Bad Request
      if (error.message?.includes('Custom Id cannot contain') ||
          error.message?.includes('Invalid jobId')) {
        return reply.code(400).send({ error: 'invalid_idempotency_key' });
      }
      // Other queue errors - re-throw as 500
      throw error;
    }
  }

  return reply.send({ group_id, job_ids });
});

// --- SSE: live progress per group (polls queue states) ---
app.get('/api/v1/sse/groups/:groupId', async (req, reply) => {
  const jobsParam = (req.query.jobs || '').toString(); // "chatgpt:<id>,perplexity:<id>,..."
  const pairs = jobsParam.split(',').filter(Boolean).map(s => s.split(':'));
  const targets = pairs.map(([eng, id]) => ({ eng, id }));

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const emit = (type, payload) => {
    reply.raw.write(`event: ${type}\n`);
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let closed = false;
  const last = new Map(); // eng -> lastStatus

  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(':heartbeat\n\n');
  }, 15000);

  const ticker = setInterval(async () => {
    if (closed) return;
    for (const { eng, id } of targets) {
      const q = queues[eng];
      if (!q) continue;

      try {
        const job = await q.getJob(id);
        if (!job) continue;
        const st = await job.getState();
        if (last.get(eng) === st) continue;
        last.set(eng, st);

        if (st === 'completed') {
          const res = await job.returnvalue;
          emit('completed', { engine: eng, result: res });
        } else if (st === 'failed') {
          emit('failed', { engine: eng, error: job.failedReason || 'failed' });
        } else {
          emit('progress', { engine: eng, status: st });
        }
      } catch (error) {
        console.error('SSE Queue error:', error.message, error.code, error.name);
        // Redis connection failure - emit error and potentially close
        if (error.message?.includes('ECONNREFUSED') ||
            error.message?.includes('Redis connection') ||
            error.message?.includes('getaddrinfo ENOTFOUND') ||
            error.message?.includes('Connection timed out') ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ETIMEDOUT') {
          emit('error', { engine: eng, error: 'redis_unavailable' });
        } else if (error.message?.includes('Custom Id cannot contain') ||
                   error.message?.includes('Invalid jobId')) {
          emit('error', { engine: eng, error: 'invalid_job_id' });
        } else {
          // Other queue errors
          emit('error', { engine: eng, error: 'queue_error' });
        }
      }
    }
  }, 1000);

  req.raw.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    clearInterval(ticker);
  });
});

// --- Start ---
app.listen({ port: Number(PORT), host: '0.0.0.0' }).then(() => {
  app.log.info(`API listening on :${PORT}`);
});
