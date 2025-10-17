// ai-search-api/index.js  — per-engine queues + batch + SSE

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Queue as BullQueue } from 'bullmq';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const {
  PORT = 4000,
  CORS_ORIGINS = 'http://localhost:8501',
  REDIS_HOST,
  REDIS_PORT = 6379,
  REDIS_PASSWORD,
  SUPABASE_JWT_SECRET,
  SKIP_AUTH = 'true',
} = process.env;

const hasRedis = Boolean(REDIS_HOST);
const connection = hasRedis
  ? { host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PASSWORD }
  : null;

// Per-engine queues (must match worker queue names)
const queues = hasRedis
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

// --- In-memory fallback (no Redis) ---
const memJobs = new Map();

// --- Health ---
app.get('/health', async () => ({ ok: true }));
app.get('/ready', async () => ({ ok: true }));

// --- Single-run (per engine) ---
app.post('/api/v1/prompt-runs', async (req, reply) => {
  const { prompt, engine = 'chatgpt', locale = 'US', persona = 'default' } = req.body || {};
  if (!prompt) return reply.code(400).send({ error: 'prompt is required' });

  const idem = (req.headers['idempotency-key'] || '').toString().trim();
  const payload = { prompt, engine, locale, persona, created_at: Date.now() };

  // With Redis: push to the engine's queue
  if (hasRedis) {
    const q = queues[engine];
    if (!q) return reply.code(400).send({ error: `unsupported engine: ${engine}` });

    const job = await q.add('run', payload, {
      jobId: idem || undefined,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 600 },  // keep 10m so clients can read
      removeOnFail: { age: 86400 },
    });
    return reply.send({ job_id: job.id });
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
app.get('/api/v1/prompt-runs/:id', async (req, reply) => {
  const { id } = req.params;

  if (hasRedis) {
    for (const q of Object.values(queues)) {
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
    }
    return reply.code(404).send({ error: 'not_found' });
  }

  if (!memJobs.has(id)) return reply.code(404).send({ error: 'not_found' });
  return reply.send(memJobs.get(id));
});

// --- Batch: fan-out to 4 engines ---
app.post('/api/v1/prompt-runs/batch', async (req, reply) => {
  const { prompt, locale = 'US', engines = ['chatgpt', 'perplexity', 'gemini', 'google'] } = (req.body || {});
  if (!prompt || !Array.isArray(engines) || engines.length === 0) {
    return reply.code(400).send({ error: 'prompt and engines[] are required' });
  }
  if (!hasRedis) return reply.code(503).send({ error: 'redis_unavailable' });

  const idem = (req.headers['idempotency-key'] || '').toString().trim();
  const group_id = randomUUID();
  const job_ids = {};

  for (const eng of engines) {
    const q = queues[eng];
    if (!q) return reply.code(400).send({ error: `unsupported engine: ${eng}` });
    const job = await q.add('run', { prompt, engine: eng, locale, group_id }, {
      jobId: idem ? `${idem}:${eng}` : undefined,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 600 },
      removeOnFail: { age: 86400 },
    });
    job_ids[eng] = job.id;
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
