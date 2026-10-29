-- Meta's own pixel counts, which make per-ad (per-hook) reporting possible without
-- touching the ads. The UTMs on these campaigns carry {{campaign.name}}, so every ad
-- inside one campaign is indistinguishable in `calls.metadata`. Meta attributes its
-- pixel events to the specific ad, so it can separate hooks that the UTMs cannot.
--
-- These are ATTRIBUTED counts, not ground truth — hence the `pixel_` prefix. Measured
-- against the Ringba export for Oct 20-28: view_content 2,499 vs ~2,402 real raw calls
-- (+4%, client-side pixel over-fires), RingbaConversion 765 vs 816 real paid calls
-- (-6%, attribution window). Good enough to RANK hooks against each other, since the
-- bias applies equally to all of them. Never use them as the revenue figure — the
-- `calls` table is authoritative for anything billed.

alter table public.meta_daily_spend
  add column if not exists pixel_raw_calls   bigint not null default 0,
  add column if not exists pixel_conversions bigint not null default 0;

alter table public.meta_daily_ad_spend
  add column if not exists pixel_raw_calls   bigint not null default 0,
  add column if not exists pixel_conversions bigint not null default 0;
