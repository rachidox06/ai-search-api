create type llm_status as enum ('done','error','timeout');

create table if not exists prompt_runs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),

  -- request context
  user_id          uuid,
  session_id       uuid,
  prompt_text      text not null,
  prompt_meta      jsonb,

  -- provider identity
  provider         text not null,     -- 'google','dataforseo','perplexity','openai'
  engine           text not null,     -- 'gemini','google','perplexity','chatgpt'
  model            text,
  request_id       text,
  status           llm_status not null default 'done',

  -- timing/usage/cost
  latency_ms       integer,
  usage            jsonb,
  cost_usd         numeric(12,6),
  cost_breakdown   jsonb,
  currency         text default 'USD',

  -- content
  content_format   text default 'markdown',  -- 'markdown'|'html'|'json'|'plaintext'
  answer_markdown  text,
  answer_json      jsonb,
  answer_plain     text,

  -- citations & search
  citations        jsonb,
  search_results   jsonb,

  -- helpers
  check_url        text,
  source_count     integer,

  -- raw & extras
  provider_raw     jsonb not null,
  extra            jsonb
);

create index if not exists pr_created_at_idx on prompt_runs (created_at desc);
create index if not exists pr_provider_engine_model_idx on prompt_runs (provider, engine, model);
create index if not exists pr_citations_gin on prompt_runs using gin (citations);
create index if not exists pr_answer_json_gin on prompt_runs using gin (answer_json);
create unique index if not exists pr_provider_request_uidx
  on prompt_runs(provider, request_id) where request_id is not null;
