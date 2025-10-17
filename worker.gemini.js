import { Worker } from 'bullmq';
const { REDIS_HOST, REDIS_PORT = 6379, REDIS_PASSWORD, BRIGHTDATA_TOKEN, BD_DS_GEMINI } = process.env;

function headers(){ return { Authorization: `Bearer ${BRIGHTDATA_TOKEN}`, 'Content-Type':'application/json' }; }
async function trigger(prompt){
  const url='https://api.brightdata.com/datasets/v3/trigger';
  const params=new URLSearchParams({ dataset_id: BD_DS_GEMINI, include_errors:'true' });
  const body=[ { url:'https://gemini.google.com/', prompt, index:1 } ];
  const r=await fetch(`${url}?${params}`, { method:'POST', headers: headers(), body: JSON.stringify(body) });
  if(!r.ok) throw new Error(`BD trigger failed: ${r.status} ${await r.text()}`);
  const j=await r.json(); return j.snapshot_id||j.id||j.result?.snapshot_id||j.result?.id;
}
async function getSnap(id){
  const r=await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${id}`, { headers:{ Authorization:`Bearer ${BRIGHTDATA_TOKEN}` }});
  if(r.status===404) return {status:'not_ready'}; if(!r.ok) throw new Error(`BD snapshot failed: ${r.status} ${await r.text()}`);
  const ct=r.headers.get('content-type')||''; if(ct.includes('application/json')){ const d=await r.json(); return Array.isArray(d)?{status:'ready',data:d}:{status:d.status||'ready',data:d}; }
  return {status:'ready', data: await r.text()};
}
async function waitSnap(id,{timeoutMs=300000,intervalMs=20000}={}){ const s=Date.now(); while(Date.now()-s<timeoutMs){ const x=await getSnap(id); if(x.status==='ready') return x.data; await new Promise(r=>setTimeout(r,intervalMs)); } throw new Error('timeout');}
function pickAnswer(raw){ if(Array.isArray(raw)&&raw[0]){ const r=raw[0]; return r.answer_text_markdown||r.answer_text||r.answer_html||r.response_raw||null; } return null; }
async function runJob({prompt, locale='US'}){ if(!BRIGHTDATA_TOKEN) throw new Error('Missing BRIGHTDATA_TOKEN'); if(!BD_DS_GEMINI) throw new Error('Missing BD_DS_GEMINI'); const snap=await trigger(prompt); const raw=await waitSnap(snap); const answer=pickAnswer(raw); return { engine:'gemini', provider:'brightdata', provider_snapshot_id:snap, answer, raw }; }
new Worker('prompt-gemini', async job=>runJob(job.data), { connection:{ host:REDIS_HOST, port:Number(REDIS_PORT), password:REDIS_PASSWORD }});
console.log('worker.gemini started');
