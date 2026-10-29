-- Conversions as the affiliate network (Ecomfy Lead / Everflow) reports them.
--
-- Why this exists: Ringba records revenue at call time, but the network scrubs
-- afterwards. Measured against the operator's reconciled sheet, September's Ringba
-- revenue was $851 (4.2%) higher than what was actually paid, and August $155 (1.2%)
-- higher. October currently matches Ringba exactly, which means it has not been
-- scrubbed yet. Ringba is therefore provisional; this table is what settles.
--
-- Keyed on transaction_id so a repeated postback for the same conversion updates in
-- place. That is what lets a later reversal overwrite the original row rather than
-- double-count it.

create table if not exists public.network_conversions (
  transaction_id  text primary key,
  conversion_id   text,
  offer_id        text,
  offer_name      text,
  status          text,
  payout          numeric(12,2),
  revenue         numeric(12,2),
  click_id        text,
  sub1            text,
  sub2            text,
  sub3            text,
  sub4            text,
  sub5            text,
  converted_at    timestamptz,
  raw             jsonb       not null,
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_network_conv_converted on public.network_conversions(converted_at desc);
create index if not exists idx_network_conv_status    on public.network_conversions(status);
create index if not exists idx_network_conv_offer     on public.network_conversions(offer_id);

-- Every postback is also appended here, including ones rejected for a bad secret, so a
-- misconfigured macro or a spoofing attempt is visible rather than silently dropped.
create table if not exists public.network_postback_log (
  id           uuid primary key default gen_random_uuid(),
  received_at  timestamptz not null default now(),
  query        jsonb       not null,
  secret_valid boolean     not null,
  accepted     boolean     not null,
  note         text
);

create index if not exists idx_network_postback_received on public.network_postback_log(received_at desc);
