// worker.js  (put this file in the repo root, next to index.js)
import { Worker } from 'bullmq';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD } = process.env;

async function runJob(data) {
  const { prompt, engine, locale } = data;

  // TODO: Later, call Bright Data here and upload raw to R2.
  // For now, return a pretend result:
  return {
    answer: `Worker processed: "${prompt}"`,
    citations: ['https://example.com'],
    visibility_score: 0.82,
  };
}

new Worker('prompt-runs', async (job) => runJob(job.data), {
  connection: { host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PASSWORD },
});

console.log('Worker started');
