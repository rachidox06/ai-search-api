// ai-search-api/index.js  ← REPLACE YOUR FILE WITH THIS

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Queue } from 'bullmq';
import jwt from 'jsonwebtoken';

const {
  PORT = 4000,
  CORS_ORIGINS = 'http://localhost:8501',
  REDIS_HOST,
  REDIS_PORT = 6379,
  REDIS_PASSWORD,
  SUPABASE_JWT_SECRET,
  SKIP_AUTH = 'true',
} = process.env;

const app = Fastify({ logger: true });

// CORS
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = CORS_ORIGINS.split(',').map(s => s.trim());
    cb(null, allowed.includes(origin));
  },
  credentials: true,
});

// ↓↓↓ THIS IS THE AUTH HOOK YOU ASKED ABOUT ↓↓↓
app.addHook('preHandler', async (req, res) => {
  if (req.routerPath?.startsWith('/health') || req.routerPath?.startsWith('/ready')) return;
  if (SKIP_AUTH === 'true') return; // keep true while testing

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
// ↑↑↑ END AUTH HOOK ↑↑↑

// Queue (optional for now; uses Redis if set)
let jobQueue = null;
if (REDIS_HOST) {
  jobQueue = new Queue('prompt-runs', {
    connection: { host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PASSWORD },
  });
}

// In-memory fallback jobs (when no Redis/worker)
const memJobs = new Map();

// Routes
app.get('/health', async () => ({ ok: true }));
app.get('/ready', async () => ({ ok: true }));

app.post('/api/v1/prompt-runs', async (req, reply) => {
  const { prompt, engine = 'chatgpt', locale = 'en', persona = 'default' } = req.body || {};
  if (!prompt) return reply.code(400).send({ error: 'prompt is required' });

  const idem = req.headers['idempotency-key'];
  const payload = { prompt, engine, locale, persona, created_at: Date.now() };

  if (jobQueue) {
    const job = await jobQueue.add('run', payload, {
      jobId: idem || undefined,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // keep completed jobs so the GET can read them
      removeOnComplete: { age: 600 },  // keep for 10 minutes
      removeOnFail: { age: 86400 }     // keep failed for a day
    });
    return reply.send({ job_id: job.id });
  } else {
    const id = String(Date.now());
    memJobs.set(id, { status: 'running' });
    setTimeout(() => {
      memJobs.set(id, {
        status: 'done',
        result: {
          answer: `Mocked answer for: "${prompt}"`,
          citations: ['https://example.com'],
          visibility_score: 0.78,
        },
      });
    }, 1500);
    return reply.send({ job_id: id });
  }
});

app.get('/api/v1/prompt-runs/:id', async (req, reply) => {
  const { id } = req.params;
  if (jobQueue) {
    const job = await jobQueue.getJob(id);
    if (!job) return reply.code(404).send({ error: 'not_found' });
    const st = await job.getState();
    if (st === 'completed') return reply.send({ status: 'done', result: await job.returnvalue });
    if (st === 'failed') return reply.send({ status: 'error', error: job.failedReason });
    return reply.send({ status: st });
  } else {
    if (!memJobs.has(id)) return reply.code(404).send({ error: 'not_found' });
    return reply.send(memJobs.get(id));
  }
});

app.listen({ port: Number(PORT), host: '0.0.0.0' }).then(() => {
  app.log.info(`API listening on :${PORT}`);
});
