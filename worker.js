// worker.js — ChatGPT via Bright Data (trigger -> wait -> fetch -> return answer + raw)
import { Worker } from 'bullmq';

const {
  REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD,
  BRIGHTDATA_TOKEN,
  BD_DS_CHATGPT,          // <-- set this in Railway (the dataset id for ChatGPT collector)
} = process.env;

// ---- helpers ----
function bdHeaders() {
  return {
    Authorization: `Bearer ${BRIGHTDATA_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function bdTriggerChatGPT(prompt, locale = 'US') {
  if (!BRIGHTDATA_TOKEN) throw new Error('Missing BRIGHTDATA_TOKEN');
  if (!BD_DS_CHATGPT)    throw new Error('Missing BD_DS_CHATGPT');

  const triggerUrl = 'https://api.brightdata.com/datasets/v3/trigger';
  const params = new URLSearchParams({
    dataset_id: BD_DS_CHATGPT,
    include_errors: 'true',
  });

  // this input matches the sample you shared
  const body = {
    input: [{
      url: 'https://chatgpt.com/',
      prompt,
      country: locale || '',
      web_search: 'false',
      additional_prompt: ''
    }],
    custom_output_fields: [
      'url','prompt','answer_text','answer_text_markdown','answer_html',
      'citations','links_attached','references','response_raw','model','timestamp',
      'error','error_code','warning','warning_code'
    ],
  };

  const res = await fetch(`${triggerUrl}?${params}`, { method: 'POST', headers: bdHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`BD trigger failed: ${res.status} ${await res.text()}`);
  const j = await res.json();

  const snapshotId = j.snapshot_id || j.id || j.result?.snapshot_id || j.result?.id;
  if (!snapshotId) throw new Error(`No snapshot id in BD response: ${JSON.stringify(j).slice(0, 500)}`);
  return snapshotId;
}

async function bdGetSnapshot(snapshotId) {
  const url = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${BRIGHTDATA_TOKEN}` } });
  if (res.status === 404) return { status: 'not_ready' };
  if (!res.ok) throw new Error(`BD snapshot fetch failed: ${res.status} ${await res.text()}`);

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (Array.isArray(data)) return { status: 'ready', data };
    if (data?.status && data.status !== 'ready') return { status: data.status };
    return { status: 'ready', data };
  }
  const text = await res.text();
  return { status: 'ready', data: text };
}

async function bdWaitForSnapshot(snapshotId, { timeoutMs = 180000, intervalMs = 1500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await bdGetSnapshot(snapshotId);
    if (s.status === 'ready') return s.data;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('BD snapshot timed out');
}

// pick the best “answer” field from the raw record
function extractAnswer(raw) {
  if (Array.isArray(raw) && raw.length > 0) {
    const r = raw[0];
    return r.answer_text_markdown || r.answer_text || r.answer_html || r.response_raw || null;
  }
  return null;
}

// ---- BullMQ job handler ----
async function runJob(data) {
  const { prompt, engine = 'chatgpt', locale = 'US' } = data;
  if (engine !== 'chatgpt') throw new Error(`Engine not supported here: ${engine}`);

  // 1) trigger
  const snapshotId = await bdTriggerChatGPT(prompt, locale);

  // 2) wait & fetch
  const raw = await bdWaitForSnapshot(snapshotId);

  // 3) extract a simple string for your UI + include full raw inline
  const answer = extractAnswer(raw);

  return {
    provider: 'brightdata',
    engine, locale,
    provider_snapshot_id: snapshotId,
    answer,             // <— Streamlit will show this
    raw                 // <— full raw inline (your Decision 2)
  };
}

new Worker('prompt-runs', async (job) => runJob(job.data), {
  connection: { host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PASSWORD },
});

console.log('Worker started');
