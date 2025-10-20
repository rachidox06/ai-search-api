import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function savePromptRun(row) {
  const body = {
    user_id: row.user_id ?? null,
    session_id: row.session_id ?? null,
    prompt_text: row.prompt_text,
    prompt_meta: row.prompt_meta ?? null,

    provider: row.provider,
    engine: row.engine,
    model: row.model ?? null,
    request_id: row.request_id ?? null,
    status: row.status ?? 'done',

    latency_ms: row.latency_ms ?? null,
    usage: row.usage ?? null,
    cost_usd: row.cost_usd ?? null,
    cost_breakdown: row.cost_breakdown ?? null,
    currency: row.currency ?? 'USD',

    content_format: row.content_format ?? 'markdown',
    answer_markdown: row.answer_markdown ?? null,
    answer_json: row.answer_json ?? null,
    answer_plain: row.answer_plain ?? null,

    citations: row.citations ?? null,
    search_results: row.search_results ?? null,
    check_url: row.check_url ?? null,
    source_count: row.source_count ?? (row.citations?.length ?? null),

    provider_raw: row.provider_raw,
    extra: row.extra ?? null
  };

  const { data, error } = await supabase
    .from('prompt_runs')
    .upsert(body, { onConflict: 'provider,request_id' });

  if (error) throw error;
  return data?.[0];
}
