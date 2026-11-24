-- TikTok ad spend, mirroring meta_daily_spend / meta_daily_ad_spend.
--
-- Same rules as Meta: TikTok restates a closed day for a while, so the sync re-pulls a
-- trailing window and overwrites, and `synced_at` records when each row was last trusted.
-- Derived figures (cost per call, ROI) are computed at read time, never stored.
--
-- Timezone: the TikTok ad account reports in Etc/GMT+5 (fixed UTC-5). That equals ET in
-- winter (EST) but runs one hour behind ET during daylight time. Ads only run 10:00-20:00,
-- so the hour never moves spend across a date boundary in practice.

create table if not exists public.tiktok_daily_spend (
  stat_date      date not null,
  advertiser_id  text not null,
  spend          numeric(12,2) not null default 0,
  impressions    bigint        not null default 0,
  clicks         bigint        not null default 0,
  -- TikTok-attributed conversions. Since 2026-11-23 the optimisation event fires on a
  -- Ringba converted (paid) call, so this tracks paid calls; before that it did not.
  -- Never use it as the revenue figure: the `calls` table is authoritative for billing.
  conversions    bigint        not null default 0,
  synced_at      timestamptz   not null default now(),
  primary key (stat_date, advertiser_id)
);

create index if not exists idx_tiktok_daily_spend_date on public.tiktok_daily_spend(stat_date desc);

-- Per-ad spend. TikTok calls carry the ad name in calls.metadata->>'utm_medium' and the
-- campaign name in utm_id, so revenue CAN be attributed per ad here (unlike Meta, whose
-- UTMs only carry the campaign).
create table if not exists public.tiktok_daily_ad_spend (
  stat_date      date not null,
  advertiser_id  text not null,
  ad_id          text not null,
  ad_name        text,
  adgroup_name   text,
  campaign_name  text,
  spend          numeric(12,2) not null default 0,
  impressions    bigint        not null default 0,
  clicks         bigint        not null default 0,
  conversions    bigint        not null default 0,
  synced_at      timestamptz   not null default now(),
  primary key (stat_date, ad_id)
);

create index if not exists idx_tiktok_daily_ad_spend_date on public.tiktok_daily_ad_spend(stat_date desc);
create index if not exists idx_tiktok_daily_ad_spend_name on public.tiktok_daily_ad_spend(campaign_name, ad_name);
