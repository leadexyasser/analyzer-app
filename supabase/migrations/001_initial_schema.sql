-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- CALLS TABLE
-- ============================================================
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  ringba_call_id text unique not null,
  received_at timestamptz not null default now(),
  call_started_at timestamptz,
  duration_seconds integer,
  caller_id text,
  target_number text,
  campaign_name text,
  buyer_name text,
  publisher_name text,
  revenue numeric(10,2),
  payout numeric(10,2),
  recording_url_original text,
  recording_storage_path text,
  transcript jsonb,
  transcript_text text,
  analysis jsonb,
  quality_score integer check (quality_score >= 0 and quality_score <= 100),
  flags text[],
  status text not null default 'pending'
    check (status in ('pending','downloading','transcribing','analyzing','complete','failed')),
  error_message text,
  processing_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_calls_ringba_call_id on public.calls(ringba_call_id);
create index idx_calls_status on public.calls(status);
create index idx_calls_quality_score on public.calls(quality_score);
create index idx_calls_flags on public.calls using gin(flags);
create index idx_calls_received_at on public.calls(received_at desc);

-- auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger calls_updated_at
  before update on public.calls
  for each row execute function public.set_updated_at();

-- ============================================================
-- WEBHOOK_EVENTS TABLE
-- ============================================================
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  payload jsonb not null,
  signature_valid boolean,
  processed boolean not null default false
);

create index idx_webhook_events_received_at on public.webhook_events(received_at desc);

-- ============================================================
-- PROCESSING_JOBS TABLE
-- ============================================================
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  job_type text not null check (job_type in ('download','transcribe','analyze')),
  status text not null default 'queued'
    check (status in ('queued','running','done','failed')),
  attempts integer not null default 0,
  last_error text,
  scheduled_for timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_jobs_queue on public.processing_jobs(status, scheduled_for)
  where status in ('queued','running');

-- ============================================================
-- API_LOGS TABLE
-- ============================================================
create table public.api_logs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls(id) on delete set null,
  service text not null check (service in ('groq_whisper','groq_llm')),
  request_duration_ms integer not null,
  tokens_used integer,
  status_code integer not null,
  error text,
  created_at timestamptz not null default now()
);

create index idx_api_logs_created_at on public.api_logs(created_at desc);
create index idx_api_logs_service on public.api_logs(service, created_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.calls enable row level security;
alter table public.webhook_events enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.api_logs enable row level security;

-- Authenticated users can read all rows
create policy "authenticated read calls"
  on public.calls for select to authenticated using (true);

create policy "authenticated read webhook_events"
  on public.webhook_events for select to authenticated using (true);

create policy "authenticated read processing_jobs"
  on public.processing_jobs for select to authenticated using (true);

create policy "authenticated read api_logs"
  on public.api_logs for select to authenticated using (true);

-- Service role has full access (used by API routes with service_role key)
-- Service role bypasses RLS by default in Supabase — no policy needed.

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- Only authenticated users can read (via signed URLs — bucket is private)
create policy "authenticated read recordings"
  on storage.objects for select to authenticated
  using (bucket_id = 'recordings');

-- Service role manages uploads/deletes via server-side routes only
