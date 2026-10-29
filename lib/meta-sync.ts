import { withTx } from '@/lib/db'
import { etTodayStr, shiftDateStr } from '@/lib/time'
import { fetchAccountDaily, fetchAdDaily, metaAdAccountIds, type MetaAccountDay, type MetaAdDay } from '@/lib/meta'

// Meta keeps revising a day's spend for roughly three days after it closes, so a row
// written once is wrong by design. Re-pulling a trailing window and overwriting is what
// keeps the table honest; seven days gives a safe margin over Meta's ~3-day settling.
const TRAILING_DAYS = 7

// Guard against a caller asking for a window large enough to hit Meta's rate limits.
// Set to cover a full year so a backfill can seed history in one call; routine syncs
// still use TRAILING_DAYS.
const MAX_TRAILING_DAYS = 400

export type SyncSummary = {
  since: string
  until: string
  accounts: string[]
  account_rows: number
  ad_rows: number
  spend_total: number
  synced_at: string
}

/** Flattens rows into a parameterised multi-row VALUES list. */
function placeholders(rowCount: number, colCount: number): string {
  return Array.from({ length: rowCount }, (_, r) =>
    `(${Array.from({ length: colCount }, (_, c) => `$${r * colCount + c + 1}`).join(',')})`
  ).join(',')
}

/**
 * Re-pulls the trailing window from Meta and overwrites those days.
 *
 * Deliberately upsert-only: it never deletes.
 *
 * Note that Meta OMITS days with no delivery rather than returning them as zero — a
 * weekend with the campaigns off simply has no row. Readers must therefore generate the
 * date series themselves and LEFT JOIN onto this table; absence means "no spend", not
 * "not yet synced". Use `synced_at` to judge freshness, never row presence.
 */
export async function syncMetaSpend(daysBack: number = TRAILING_DAYS): Promise<SyncSummary> {
  if (!Number.isInteger(daysBack) || daysBack < 0 || daysBack > MAX_TRAILING_DAYS) {
    throw new Error(`daysBack must be an integer between 0 and ${MAX_TRAILING_DAYS}, got ${daysBack}`)
  }
  const until = etTodayStr()
  return syncMetaRange(shiftDateStr(until, -daysBack), until)
}

/**
 * Syncs one explicit date range.
 *
 * Meta fails an ad-level, day-by-day pull once the window gets long — a 200-day request
 * comes back as a bare "unknown error" rather than a rate-limit message. Backfills must
 * therefore be chunked a month at a time; this is the entry point for doing that.
 */
export async function syncMetaRange(since: string, until: string): Promise<SyncSummary> {
  const accountIds = metaAdAccountIds()

  // Fetch every account before touching the database, so a failure on the second
  // account can't leave the first one half-written.
  const fetched = await Promise.all(
    accountIds.map(async id => ({
      id,
      days: await fetchAccountDaily(id, since, until),
      ads: await fetchAdDaily(id, since, until),
    }))
  )

  const accountDays: MetaAccountDay[] = fetched.flatMap(f => f.days)
  const adDays: MetaAdDay[] = fetched.flatMap(f => f.ads)

  await withTx(async client => {
    if (accountDays.length > 0) {
      const cols = 10
      const params = accountDays.flatMap(d => [
        d.stat_date, d.ad_account_id, d.spend, d.impressions,
        d.link_clicks, d.clicks, d.reach, d.frequency,
        d.pixel_raw_calls, d.pixel_conversions,
      ])
      await client.query(
        `INSERT INTO meta_daily_spend
           (stat_date, ad_account_id, spend, impressions, link_clicks, clicks, reach, frequency,
            pixel_raw_calls, pixel_conversions)
         VALUES ${placeholders(accountDays.length, cols)}
         ON CONFLICT (stat_date, ad_account_id) DO UPDATE SET
           spend = excluded.spend,
           impressions = excluded.impressions,
           link_clicks = excluded.link_clicks,
           clicks = excluded.clicks,
           reach = excluded.reach,
           frequency = excluded.frequency,
           pixel_raw_calls = excluded.pixel_raw_calls,
           pixel_conversions = excluded.pixel_conversions,
           synced_at = now()`,
        params
      )
    }

    if (adDays.length > 0) {
      const cols = 11
      const params = adDays.flatMap(d => [
        d.stat_date, d.ad_account_id, d.ad_id, d.ad_name, d.campaign_name,
        d.adset_name, d.spend, d.impressions, d.link_clicks,
        d.pixel_raw_calls, d.pixel_conversions,
      ])
      await client.query(
        `INSERT INTO meta_daily_ad_spend
           (stat_date, ad_account_id, ad_id, ad_name, campaign_name, adset_name, spend, impressions,
            link_clicks, pixel_raw_calls, pixel_conversions)
         VALUES ${placeholders(adDays.length, cols)}
         ON CONFLICT (stat_date, ad_id) DO UPDATE SET
           ad_name = excluded.ad_name,
           campaign_name = excluded.campaign_name,
           adset_name = excluded.adset_name,
           spend = excluded.spend,
           impressions = excluded.impressions,
           link_clicks = excluded.link_clicks,
           pixel_raw_calls = excluded.pixel_raw_calls,
           pixel_conversions = excluded.pixel_conversions,
           synced_at = now()`,
        params
      )
    }
  })

  return {
    since,
    until,
    accounts: accountIds,
    account_rows: accountDays.length,
    ad_rows: adDays.length,
    spend_total: accountDays.reduce((sum, d) => sum + d.spend, 0),
    synced_at: new Date().toISOString(),
  }
}
