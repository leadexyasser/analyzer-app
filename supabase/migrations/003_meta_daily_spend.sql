-- Meta ad spend, one row per day. Spend is NOT final when a day closes: Meta
-- restates it for ~3 days afterwards (we watched Oct 27 move by $0.09 and Oct 28's
-- link clicks move by 16 an hour after the day ended). So the sync always re-pulls a
-- trailing window and overwrites, and `synced_at` records when each row was last trusted.
--
-- Derived figures (CPM, CTR, cost per click, cost per call) are computed at read time
-- from these columns rather than stored, so a restatement can never leave them stale.

create table if not exists public.meta_daily_spend (
  stat_date       date not null,
  ad_account_id   text not null,
  ad_account_name text,
  spend           numeric(12,2) not null default 0,
  impressions     bigint        not null default 0,
  link_clicks     bigint        not null default 0,
  clicks          bigint        not null default 0,
  reach           bigint        not null default 0,
  frequency       numeric(8,4),
  synced_at       timestamptz   not null default now(),
  primary key (stat_date, ad_account_id)
);

create index if not exists idx_meta_daily_spend_date on public.meta_daily_spend(stat_date desc);

-- Per-ad spend for the creative breakdown. `ad_name` is the join key to call
-- attribution: Ringba carries the ad name through to calls.metadata->>'utm_content',
-- which is how a call is traced back to the hook that produced it.
create table if not exists public.meta_daily_ad_spend (
  stat_date      date not null,
  ad_account_id  text not null,
  ad_id          text not null,
  ad_name        text,
  campaign_name  text,
  adset_name     text,
  spend          numeric(12,2) not null default 0,
  impressions    bigint        not null default 0,
  link_clicks    bigint        not null default 0,
  synced_at      timestamptz   not null default now(),
  primary key (stat_date, ad_id)
);

create index if not exists idx_meta_daily_ad_spend_date on public.meta_daily_ad_spend(stat_date desc);
create index if not exists idx_meta_daily_ad_spend_name on public.meta_daily_ad_spend(ad_name);
