-- Extended call fields: campaign/target IDs, duplicate flag, end source, UTM params
alter table public.calls
  add column if not exists campaign_id text,
  add column if not exists target_id text,
  add column if not exists target_name text,
  add column if not exists end_call_source text,
  add column if not exists is_duplicate boolean,
  add column if not exists metadata jsonb;

create index if not exists idx_calls_campaign_id on public.calls(campaign_id);
create index if not exists idx_calls_is_duplicate on public.calls(is_duplicate);
