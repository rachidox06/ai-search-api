import { Worker } from 'bullmq';

const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, BRIGHTDATA_TOKEN, BD_DS_CHATGPT } = process.env;

function headers(){ return { Authorization: `Bearer ${BRIGHTDATA_TOKEN}`, 'Content-Type':'application/json' }; }

async function trigger(prompt, locale) {
  const url = 'https://api.brightdata.com/datasets/v3/trigger';
  const params = new URLSearchParams({ dataset_id: BD_DS_CHATGPT, include_errors: 'true' });
  const body = {
    input: [{ url:'https://chatgpt.com/', prompt, country: locale||'', web_search:'false', additional_prompt:'' }],
    custom_output_fields: ['answer_text_markdown','answer_text','answer_html','citations','response_raw','model','timestamp','error','error_code','warning','warning_code']
  };
  const r = await fetch(`${url}?${params}`, { method:'POST', headers: headers(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`BD trigger failed: ${r.status} ${await r.text()}`);
  const j = await r.json(); return j.snapshot_id || j.id || j.result?.snapshot_id || j.result?.id;
}
async function getSnap(id){
  const r = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${id}`, { headers:{ Authorization:`Bearer ${BRIGHTDATA_TOKEN}` }});
  if (r.status===404) return { status:'not_ready' };
  if (!r.ok) throw new Error(`BD snapshot failed: ${r.status} ${await r.text()}`);
  const ct = r.headers.get('content-type')||''; if (ct.includes('application/json')) {
    const data = await r.json(); if (Array.isArray(data)) return { status:'ready', data }; if (data.status && data.status!=='ready') return { status:data.status }; return { status:'ready', data };
  }
  return { status:'ready', data: await r.text() };
}
async function waitSnap(id, {timeoutMs=300000, intervalMs=20000}={}){ const s=Date.now(); while(Date.now()-s<timeoutMs){ const x=await getSnap(id); if(x.status==='ready') return x.data; await new Promise(r=>setTimeout(r,intervalMs)); } throw new Error('timeout'); }
function pickAnswer(raw){ if(Array.isArray(raw)&&raw[0]){ const r=raw[0]; return r.answer_text_markdown||r.answer_text||r.answer_html||r.response_raw||null; } return null; }

async function runJob({prompt, locale='US'}){
  if(!BRIGHTDATA_TOKEN) throw new Error('Missing BRIGHTDATA_TOKEN');
  if(!BD_DS_CHATGPT) throw new Error('Missing BD_DS_CHATGPT');
  const snap = await trigger(prompt, locale);
  const raw = await waitSnap(snap);
  const answer = pickAnswer(raw);
  return { engine:'chatgpt', provider:'brightdata', provider_snapshot_id:snap, answer, raw };
}

new Worker('prompt-chatgpt', async job => runJob(job.data), { connection:{ host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD }});
console.log('worker.chatgpt started');
