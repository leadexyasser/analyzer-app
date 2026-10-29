-- Settled daily figures imported from an Everflow export.
--
-- Revenue has three sources of decreasing authority:
--   1. this table  — the export, taken after the network has scrubbed. Final.
--   2. postbacks   — network_conversions, live but provisional. This network sends an
--                    empty `status` macro, so a clawback does NOT arrive as a postback;
--                    the live figure can only ever be too high, never too low.
--   3. call records — Ringba revenue, the fallback for days before postbacks existed.
--
-- Importing a day here overrides the other two for that day. Keyed on (stat_date,
-- offer_id) so re-importing a corrected export overwrites rather than duplicating.

create table if not exists public.network_settlement_daily (
  stat_date    date not null,
  offer_id     text not null,
  offer_name   text,
  conversions  integer       not null default 0,
  revenue      numeric(12,2) not null default 0,
  source_file  text,
  imported_at  timestamptz   not null default now(),
  primary key (stat_date, offer_id)
);

create index if not exists idx_settlement_date on public.network_settlement_daily(stat_date desc);
