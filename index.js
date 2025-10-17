{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 // index.js\
import Fastify from 'fastify';\
import cors from '@fastify/cors';\
import \{ Queue \} from 'bullmq';\
import \{ verify \} from 'jsonwebtoken';\
\
// ---- ENV ----\
const \{\
  PORT = 4000,\
  CORS_ORIGINS = 'http://localhost:8501',\
  REDIS_HOST,\
  REDIS_PORT = 6379,\
  REDIS_PASSWORD,\
  SUPABASE_JWT_SECRET, // optional for now\
  SKIP_AUTH = 'true',  // set to 'false' in prod once JWT is wired\
\} = process.env;\
\
// ---- APP ----\
const app = Fastify(\{ logger: true \});\
\
// CORS\
await app.register(cors, \{\
  origin: (origin, cb) => \{\
    if (!origin) return cb(null, true); // allow curl / health checks\
    const allowed = CORS_ORIGINS.split(',').map(s => s.trim());\
    cb(null, allowed.includes(origin));\
  \},\
  credentials: true,\
\});\
\
// Auth (very light for now)\
app.addHook('preHandler', async (req, res) => \{\
  if (req.routerPath?.startsWith('/health') || req.routerPath?.startsWith('/ready')) return;\
  if (SKIP_AUTH === 'true') return; // dev mode: no auth\
\
  const auth = req.headers.authorization || '';\
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';\
  if (!token) return res.code(401).send(\{ error: 'unauthorized' \});\
\
  try \{\
    const payload = verify(token, SUPABASE_JWT_SECRET);\
    req.user = \{ sub: payload.sub, email: payload.email \};\
  \} catch \{\
    return res.code(401).send(\{ error: 'invalid_token' \});\
  \}\
\});\
\
// Redis jobs queue (you\'92ll connect Redis in Railway; for now this can be undefined)\
let jobQueue = null;\
if (REDIS_HOST) \{\
  jobQueue = new Queue('prompt-runs', \{\
    connection: \{ host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PASSWORD \},\
  \});\
\}\
\
// Health endpoints\
app.get('/health', async () => (\{ ok: true \}));\
app.get('/ready', async () => (\{ ok: true \}));\
\
// Minimal in-memory fallback if Redis isn\'92t set yet\
const memJobs = new Map();\
\
// POST create a job\
app.post('/api/v1/prompt-runs', async (req, reply) => \{\
  const \{ prompt, engine = 'chatgpt', locale = 'en', persona = 'default' \} = req.body || \{\};\
  if (!prompt) return reply.code(400).send(\{ error: 'prompt is required' \});\
\
  const idem = req.headers['idempotency-key']; // optional\
  const payload = \{ prompt, engine, locale, persona, created_at: Date.now() \};\
\
  if (jobQueue) \{\
    const job = await jobQueue.add('run', payload, \{\
      jobId: idem || undefined,\
      attempts: 3,\
      backoff: \{ type: 'exponential', delay: 2000 \},\
      removeOnComplete: true,\
    \});\
    return reply.send(\{ job_id: job.id \});\
  \} else \{\
    // local fallback\
    const id = String(Date.now());\
    memJobs.set(id, \{ status: 'running' \});\
    setTimeout(() => \{\
      memJobs.set(id, \{\
        status: 'done',\
        result: \{\
          answer: `Mocked answer for: "$\{prompt\}"`,\
          citations: ['https://example.com'],\
          visibility_score: 0.78,\
        \},\
      \});\
    \}, 1500);\
    return reply.send(\{ job_id: id \});\
  \}\
\});\
\
// GET job status/result\
app.get('/api/v1/prompt-runs/:id', async (req, reply) => \{\
  const \{ id \} = req.params;\
  if (jobQueue) \{\
    const job = await jobQueue.getJob(id);\
    if (!job) return reply.code(404).send(\{ error: 'not_found' \});\
    const st = await job.getState();\
    if (st === 'completed') return reply.send(\{ status: 'done', result: await job.returnvalue \});\
    if (st === 'failed') return reply.send(\{ status: 'error', error: job.failedReason \});\
    return reply.send(\{ status: st \});\
  \} else \{\
    if (!memJobs.has(id)) return reply.code(404).send(\{ error: 'not_found' \});\
    return reply.send(memJobs.get(id));\
  \}\
\});\
\
app.listen(\{ port: Number(PORT), host: '0.0.0.0' \}).then(() => \{\
  app.log.info(`API listening on :$\{PORT\}`);\
\});\
}