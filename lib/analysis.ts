import { many, one } from '@/lib/db'
import { ET, etTodayStr } from '@/lib/time'

// Revenue split with eComfy, matching the Daily Performance Log.
export const YASSER_SHARE = 0.8
export const ECOMFY_SHARE = 0.2

// Insurance Supermarket bills most calls at $28 but some at $35. The operator reasons in
// flat $28, so both are reported: `revenue_at_28` for planning, `revenue_actual` for the
// books and the revenue split.
const ISI_FLAT_RATE = 28
const ISI_BUYER_PREFIX = 'Insurance Supermarket%'

// Spend is considered stale after this, at which point the page re-syncs on load.
export const STALE_AFTER_MINUTES = 30

/**
 * First date the Everflow postback covered a whole day.
 *
 * The postback went live mid-morning on 2026-10-29, so that day's webhook total only
 * covers part of it and would badly understate revenue if treated as the day's figure.
 * On and after this date the webhook is the live revenue source; before it, call
 * records are. Settled export rows override both, on any date.
 */
export const WEBHOOK_FULL_DAYS_FROM = '2026-10-30'

export type DailyRow = {
  stat_date: string
  spend: number
  impressions: number
  link_clicks: number
  pixel_raw_calls: number
  connected_calls: number
  paid_calls: number
  policies: number
  revenue_actual: number
  revenue_at_28: number
  /** Live postback total. Null before the webhook existed. */
  revenue_webhook: number | null
  webhook_conversions: number | null
  /** Imported export total. Null until that day has been settled. */
  revenue_settled: number | null
  settled_conversions: number | null
  /** The figure the P&L uses: settled, else webhook, else call records. */
  revenue_effective: number
  revenue_source: 'settled' | 'webhook' | 'calls'
}

export type CreativeRow = {
  creative: string
  spend: number
  link_clicks: number
  pixel_raw_calls: number
  paid_calls: number
  policies: number
  compliance_risk: number
  analyzed: number
  revenue_at_28: number
}

export type HookRow = {
  ad_name: string
  campaign_name: string | null
  spend: number
  link_clicks: number
  pixel_raw_calls: number
  pixel_conversions: number
}

/** `generate_series` + LEFT JOIN, because Meta omits days with no delivery entirely. */
const DAILY_SQL = `
with days as (
  select d::date as stat_date
  from generate_series($1::date, $2::date, interval '1 day') d
),
spend as (
  select stat_date,
         sum(spend)             as spend,
         sum(impressions)       as impressions,
         sum(link_clicks)       as link_clicks,
         sum(pixel_raw_calls)   as pixel_raw_calls
  from meta_daily_spend
  where stat_date between $1::date and $2::date
  group by stat_date
),
call_agg as (
  select (call_started_at at time zone '${ET}')::date as stat_date,
         count(*)                                              as connected_calls,
         count(*) filter (where revenue > 0)                    as paid_calls,
         count(*) filter (where analysis->>'call_outcome' = 'sale_closed') as policies,
         coalesce(sum(revenue), 0)                              as revenue_actual,
         coalesce(sum(case
           when buyer_name like $4 and revenue > 0 then ${ISI_FLAT_RATE}
           else revenue
         end), 0)                                               as revenue_at_28
  from calls
  where campaign_name = $3
    and (call_started_at at time zone '${ET}')::date between $1::date and $2::date
  group by 1
),
webhook as (
  -- A rejected or reversed conversion is excluded rather than deleted, so a later
  -- status change removes it from revenue without losing the record of it.
  select (converted_at at time zone '${ET}')::date as stat_date,
         sum(coalesce(payout, 0))                   as revenue,
         count(*)                                   as conversions
  from network_conversions
  where converted_at is not null
    and coalesce(lower(status), '') not in ('rejected', 'reversed', 'declined', 'invalid')
  group by 1
),
settled as (
  select stat_date, sum(revenue) as revenue, sum(conversions) as conversions
  from network_settlement_daily
  group by stat_date
)
select to_char(d.stat_date, 'YYYY-MM-DD')          as stat_date,
       coalesce(s.spend, 0)::float8                as spend,
       coalesce(s.impressions, 0)::int             as impressions,
       coalesce(s.link_clicks, 0)::int             as link_clicks,
       coalesce(s.pixel_raw_calls, 0)::int         as pixel_raw_calls,
       coalesce(c.connected_calls, 0)::int         as connected_calls,
       coalesce(c.paid_calls, 0)::int              as paid_calls,
       coalesce(c.policies, 0)::int                as policies,
       coalesce(c.revenue_actual, 0)::float8       as revenue_actual,
       coalesce(c.revenue_at_28, 0)::float8        as revenue_at_28,
       w.revenue::float8                           as revenue_webhook,
       w.conversions::int                          as webhook_conversions,
       t.revenue::float8                           as revenue_settled,
       t.conversions::int                          as settled_conversions,
       coalesce(
         t.revenue,
         case when d.stat_date >= $5::date then w.revenue end,
         c.revenue_at_28,
         0
       )::float8                                   as revenue_effective,
       case
         when t.revenue is not null then 'settled'
         when d.stat_date >= $5::date and w.revenue is not null then 'webhook'
         else 'calls'
       end                                         as revenue_source
from days d
left join spend    s on s.stat_date = d.stat_date
left join call_agg c on c.stat_date = d.stat_date
left join webhook  w on w.stat_date = d.stat_date
left join settled  t on t.stat_date = d.stat_date
order by d.stat_date desc
`

export type MonthWindow = { month: string; since: string; until: string; label: string }

/**
 * Calendar-month bounds for "YYYY-MM", covering every day including weekends so the log
 * reads like the spreadsheet. `until` is clamped to today for the current month, since
 * printing future dates as $0 would misread as days that lost money.
 */
export function monthWindow(month?: string): MonthWindow {
  const today = etTodayStr()
  const target = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7)
  const [y, m] = target.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const since = `${target}-01`
  const monthEnd = `${target}-${String(lastDay).padStart(2, '0')}`
  const label = new Date(`${since}T12:00:00Z`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { month: target, since, until: monthEnd < today ? monthEnd : today, label }
}

/** Previous calendar month, for the carry-forward panel. */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export async function fetchDaily(campaignScope: string, since: string, until: string): Promise<DailyRow[]> {
  return many<DailyRow>(DAILY_SQL, [since, until, campaignScope, ISI_BUYER_PREFIX, WEBHOOK_FULL_DAYS_FROM])
}

/**
 * Per-creative view, keyed on campaign name.
 *
 * Meta spend is grouped by its `campaign_name`, and call data by `utm_content` — which
 * carries {{campaign.name}}, not the ad name. So this joins cleanly today, and keeps
 * working once several hooks share a campaign (spend aggregates, revenue stays
 * campaign-level). For hook-level detail use `fetchHooks`.
 */
const CREATIVE_SQL = `
with spend as (
  select campaign_name                as creative,
         sum(spend)                   as spend,
         sum(link_clicks)             as link_clicks,
         sum(pixel_raw_calls)         as pixel_raw_calls
  from meta_daily_ad_spend
  where stat_date between $1::date and $2::date
    and campaign_name is not null
  group by campaign_name
),
call_agg as (
  select metadata->>'utm_content'                                            as creative,
         count(*) filter (where revenue > 0)                                 as paid_calls,
         count(*) filter (where analysis->>'call_outcome' = 'sale_closed')    as policies,
         count(*) filter (where analysis->'final_expense'->>'qualifier_verdict' = 'compliance_risk') as compliance_risk,
         count(*) filter (where analysis is not null)                        as analyzed,
         coalesce(sum(case
           when buyer_name like $4 and revenue > 0 then ${ISI_FLAT_RATE}
           else revenue
         end), 0)                                                            as revenue_at_28
  from calls
  where campaign_name = $3
    and (call_started_at at time zone '${ET}')::date between $1::date and $2::date
    and metadata->>'utm_content' is not null
  group by 1
)
select coalesce(s.creative, c.creative)        as creative,
       coalesce(s.spend, 0)::float8            as spend,
       coalesce(s.link_clicks, 0)::int         as link_clicks,
       coalesce(s.pixel_raw_calls, 0)::int     as pixel_raw_calls,
       coalesce(c.paid_calls, 0)::int          as paid_calls,
       coalesce(c.policies, 0)::int            as policies,
       coalesce(c.compliance_risk, 0)::int     as compliance_risk,
       coalesce(c.analyzed, 0)::int            as analyzed,
       coalesce(c.revenue_at_28, 0)::float8    as revenue_at_28
from spend s
full outer join call_agg c on c.creative = s.creative
order by spend desc
`

export async function fetchCreatives(campaignScope: string, since: string, until: string): Promise<CreativeRow[]> {
  return many<CreativeRow>(CREATIVE_SQL, [since, until, campaignScope, ISI_BUYER_PREFIX])
}

/**
 * Hook-level detail, Meta-attributed only.
 *
 * There is no revenue here on purpose: the UTMs cannot tell two ads in one campaign
 * apart, so attributing revenue to an individual hook would be invention. Meta's pixel
 * does attribute per ad, and benchmarks against the Ringba export at +4% on raw calls
 * and -6% on conversions — biased alike across ads, so it ranks hooks honestly.
 */
const HOOKS_SQL = `
select ad_name,
       max(campaign_name)             as campaign_name,
       sum(spend)::float8             as spend,
       sum(link_clicks)::int          as link_clicks,
       sum(pixel_raw_calls)::int      as pixel_raw_calls,
       sum(pixel_conversions)::int    as pixel_conversions
from meta_daily_ad_spend
where stat_date between $1::date and $2::date
  and ad_name is not null
group by ad_name
order by spend desc
`

export async function fetchHooks(since: string, until: string): Promise<HookRow[]> {
  return many<HookRow>(HOOKS_SQL, [since, until])
}

export type MonthTotals = {
  spend: number
  revenue_effective: number
  revenue_at_28: number
  revenue_actual: number
  paid_calls: number
}

/** Month totals on their own, for the previous-month carry-forward panel. */
export async function fetchMonthTotals(campaignScope: string, month: string): Promise<MonthTotals> {
  const w = monthWindow(month)
  const rows = await fetchDaily(campaignScope, w.since, w.until)
  return rows.reduce(
    (a, d) => ({
      spend: a.spend + d.spend,
      revenue_effective: a.revenue_effective + d.revenue_effective,
      revenue_at_28: a.revenue_at_28 + d.revenue_at_28,
      revenue_actual: a.revenue_actual + d.revenue_actual,
      paid_calls: a.paid_calls + d.paid_calls,
    }),
    { spend: 0, revenue_effective: 0, revenue_at_28: 0, revenue_actual: 0, paid_calls: 0 }
  )
}

/** Months that have stored spend, newest first — drives the month picker. */
export async function availableMonths(): Promise<string[]> {
  const rows = await many<{ month: string }>(
    `select to_char(stat_date, 'YYYY-MM') as month
     from meta_daily_spend group by 1 order by 1 desc`
  )
  const current = etTodayStr().slice(0, 7)
  return rows.some(r => r.month === current) ? rows.map(r => r.month) : [current, ...rows.map(r => r.month)]
}

/** Minutes since spend was last pulled, or null when nothing has ever synced. */
export async function spendAgeMinutes(): Promise<number | null> {
  const row = await one<{ age_minutes: number | null }>(
    `select extract(epoch from (now() - max(synced_at))) / 60 as age_minutes from meta_daily_spend`
  )
  const age = row?.age_minutes
  return age === null || age === undefined ? null : Number(age)
}
