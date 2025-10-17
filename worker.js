// worker.js — multi-engine Bright Data "trigger" flow
import { Worker } from 'bullmq';

const {
  REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD,
  BRIGHTDATA_TOKEN,
  BD_DS_CHATGPT, BD_DS_PERPLEXITY, BD_DS_GOOGLE,
} = process.env;

// Map each engine to its dataset and input builder
const engineConfig = {
  chatgpt: {
    datasetId: BD_DS_CHATGPT,
    buildInput: (prompt, locale) => ({
      url: 'https://chatgpt.com/',
      prompt,
      country: locale || '',
      web_search: 'false',
      additional_prompt: '',
    }),
    fields: [
      'url','prompt','answer_text','answer_text_markdown','answer_html',
      'citations','links_attached','references','response_raw','model','timestamp',
      'error','error_code','warning','warning_code'
    ],
    parse: genericParse
  },
  perplexity: {
    datasetId: BD_DS_PERPLEXITY,
    buildInput: (prompt, locale) => ({
      url: 'https://www.perplexity.ai/',
      prompt,
      country: locale || '',
      web_search: 'false',
      additional_prompt: '',
    }),
    fields: [
      'url','prompt','answer_text','answer_text_markdown','answer_html',
      'citations','links_attached','references','response_raw','model','timestamp',
      'error','error_code','warning','warning_code'
    ],
    parse: genericParse
  },
  google: {
    datasetId: BD_DS_GOOGLE,
    buildInput: (prompt, locale) => ({
      // many Google collectors expect "query" instead of "prompt"
      query: prompt,
      country: locale || ''
    }),
    fields: [
      // adapt to your Google dataset schema:
      'query','answer_text','answer_text_markdown','citations','links_attached',
      'references','timestamp','error','error_code','warning','warning_code'
    ],
    parse: genericParse
  },
};

function genericParse(raw) {
  let answer = null;
  let citations = [];
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    answer = first.answer_text_markdown || first.answer_text || first.answer_html || first.response_raw || null;
    citations = first.citations || first.links_attached || first.references || [];
  }
  return { answer, citations };
}

function bdHeaders() {
  return { Authorization: `Bearer ${BRIGHTDATA_TOKEN}`, 'Content-Type': 'application/json' };
}

async function bdTrigger(datasetId, input, fields) {
  if (!BRIGHTDATA_TOKEN) throw new Error('Missing BRIGHTDATA_TOKEN');
  if (!datasetId) throw new Error('Missing datasetId for this engine');

  const triggerUrl = 'https://api.brightdata.com/datasets/v3/trigger';
  const params = new URLSearchParams({ dataset_id: datasetId, include_errors: 'true' });
  const body = { input: [input], custom_output_fields: fields };

  const res = await fetch(`${triggerUrl}?${params.toString()}`, {
    method: 'POST', headers: bdHeaders(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`BD trigger failed: ${res.status} ${await res.text()}`);

  const json = await res.json();
  const snapshotId = json.snapshot_id || json.id || json.result?.snapshot_id || json.result?.id;
  if (!snapshotId) throw new Error(`No snapshot id in BD response: ${JSON.stringify(json)}`);
  return snapshotId;
}

async function bdGetSnapshot(snapshotId) {
  const url = `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${BRIGHTDATA_TOKEN}` } });
  if (res.status === 404) return { status: 'not_ready' };
  if (!res.ok) throw new Error(`BD get snapshot failed: ${res.status} ${await res.text()}`);

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (Array.isArray(data)) return { status: 'ready', data };
    if (data.status && data.status !== 'ready') return { status: data.status };
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

async function runJob(data) {
  const { prompt, engine = 'chatgpt', locale = 'en' } = data;

  const cfg = engineConfig[engine];
  if (!cfg) throw new Error(`Unsupported engine: ${engine}`);

  const input = cfg.buildInput(prompt, locale);
  const snapshotId = await bdTrigger(cfg.datasetId, input, cfg.fields);
  const raw = await bdWaitForSnapshot(snapshotId);
  const { answer, citations } = cfg.parse(raw);

  return {
    provider: 'brightdata',
    engine, locale,
    provider_snapshot_id: snapshotId,
    answer, citations
  };
}

new Worker('prompt-runs', async (job) => runJob(job.data), {
  connection: { host: REDIS_HOST, port: Number(REDIS_PORT), password: REDIS_PASSWORD },
});

console.log('Worker started');
