import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// Validate environment variables
if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL is not set in environment variables');
  console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')).join(', ') || 'none with SUPABASE');
  throw new Error('SUPABASE_URL environment variable is required');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is not set in environment variables');
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
console.log('✅ Supabase client initialized successfully');

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

  console.log('📝 Saving to Supabase:', {
    provider: body.provider,
    engine: body.engine,
    prompt: body.prompt_text?.substring(0, 50) + '...',
    has_answer: !!body.answer_markdown,
    citations_count: body.citations?.length || 0
  });

  const { data, error } = await supabase
    .from('prompt_runs')
    .upsert(body, { onConflict: 'provider,request_id' });

  if (error) {
    console.error('❌ Supabase save failed:', error);
    throw error;
  }
  
  console.log('✅ Saved to Supabase successfully');
  return data?.[0];
}
