// ESM
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return undefined; } };
const secsToMs = (s) => {
  if (s === undefined || s === null) return undefined;
  if (typeof s === 'number') return Math.round(s * 1000);
  const m = String(s).match(/([\d.]+)/);
  return m ? Math.round(parseFloat(m[1]) * 1000) : undefined;
};

export function normalizeGemini(jobCtx, gemini) {
  const citations = (gemini.citations ?? []).map((c, i) => ({
    id: c.number ?? i + 1, title: c.title, url: c.url, label: host(c.url), source: host(c.url), snippet: c.text
  }));
  return {
    user_id: jobCtx.user_id ?? null, session_id: jobCtx.session_id ?? null, prompt_text: jobCtx.prompt,
    provider: 'google', engine: 'gemini', model: 'gemini-2.5-flash',
    status: 'done',
    content_format: 'markdown',
    answer_markdown: gemini.answer,
    citations,
    source_count: citations.length,
    search_results: (gemini.sources ?? []).map(s => ({ url:s.url, title:s.title, label:host(s.url) })),
    provider_raw: { ...gemini.raw, enhanced_answer: gemini.enhanced_answer, original_answer: gemini.original_answer },
    extra: { search_queries: gemini.searchQueries ?? [] }
  };
}

export function normalizeDataforseoGoogle(jobCtx, dfs) {
  const task = dfs?.provider_response?.tasks?.[0];
  const top  = task?.result?.[0];
  const item = top?.items?.[0];
  const time = dfs?.provider_response?.time ?? task?.time;

  const deepRefs = (item?.items ?? []).flatMap(it => it.references ?? []);
  const refs = [ ...(item?.references ?? []), ...deepRefs, ...(top?.references ?? []) ]
    .map((r, i) => ({ id:i+1, title:r.title, url:r.url, label:host(r.url), source:host(r.url), snippet:r.text }));

  const tableBlock = (item?.items ?? []).find(it => it.type === 'ai_overview_table_element' && it.table)?.table;
  const answer_json = tableBlock ? {
    version: 1,
    blocks: [{
      type: 'table',
      header: tableBlock.table_header || tableBlock.table_content?.[0],
      rows: (tableBlock.table_content || []).slice(tableBlock.table_header ? 0 : 1)
    }]
  } : null;

  return {
    user_id: jobCtx.user_id ?? null, session_id: jobCtx.session_id ?? null, prompt_text: jobCtx.prompt,
    provider: 'dataforseo', engine: 'google',
    request_id: task?.id,
    status: 'done',
    latency_ms: secsToMs(time),
    cost_usd: dfs?.provider_response?.cost,
    content_format: 'markdown',
    answer_markdown: item?.markdown ?? top?.items?.[0]?.markdown ?? null,
    answer_json,
    citations: refs,
    source_count: refs.length,
    search_results: null,
    check_url: top?.check_url,
    provider_raw: dfs
  };
}

export function normalizePerplexity(jobCtx, px) {
  const raw = px?.raw ?? {};
  const citations = (raw.citations ?? []).map((u, i) => ({ id:i+1, url:u, label:host(u), source:host(u) }));
  const enriched = (px?.search_results ?? raw?.search_results ?? []).map(r => ({
    url:r.url, title:r.title, label:host(r.url), snippet:r.snippet
  }));
  return {
    user_id: jobCtx.user_id ?? null, session_id: jobCtx.session_id ?? null, prompt_text: jobCtx.prompt,
    provider: 'perplexity', engine: 'perplexity', model: raw.model,
    request_id: raw.id,
    status: 'done',
    usage: raw.usage,
    cost_usd: raw.usage?.cost?.total_cost,
    cost_breakdown: raw.usage?.cost,
    content_format: 'markdown',
    answer_markdown: px?.answer,
    citations,
    source_count: citations.length,
    search_results: enriched,
    provider_raw: px
  };
}

export function normalizeDataforseoChatGPT(jobCtx, dfs) {
  const task = dfs?.provider_response?.tasks?.[0];
  const top  = task?.result?.[0];
  const item = top?.items?.[0];
  return {
    user_id: jobCtx.user_id ?? null, session_id: jobCtx.session_id ?? null, prompt_text: jobCtx.prompt,
    provider: 'dataforseo', engine: 'chatgpt', model: top?.model,
    request_id: task?.id,
    status: 'done',
    latency_ms: secsToMs(dfs?.provider_response?.time ?? task?.time),
    cost_usd: dfs?.provider_response?.cost,
    content_format: 'markdown',
    answer_markdown: item?.markdown ?? null,
    citations: [],
    source_count: 0,
    check_url: top?.check_url,
    provider_raw: dfs
  };
}
