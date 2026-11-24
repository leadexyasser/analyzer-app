import { withTx } from '@/lib/db'
import { placeholders } from '@/lib/sql'
import { etTodayStr, shiftDateStr } from '@/lib/time'
import { fetchAccountDaily, fetchAdDaily, tiktokAdvertiserIds, type TikTokAccountDay, type TikTokAdDay } from '@/lib/tiktok'

// TikTok keeps settling a closed day for a while, like Meta, so the sync re-pulls a
// trailing week and overwrites it.
const TRAILING_DAYS = 7

// A full year in one call is fine: the client chunks it into 30-day requests.
const MAX_TRAILING_DAYS = 400

export type TikTokSyncSummary = {
  since: string
  until: string
  advertisers: string[]
  account_rows: number
  ad_rows: number
  spend_total: number
  synced_at: string
}

export async function syncTikTokSpend(daysBack: number = TRAILING_DAYS): Promise<TikTokSyncSummary> {
  if (!Number.isInteger(daysBack) || daysBack < 0 || daysBack > MAX_TRAILING_DAYS) {
    throw new Error(`daysBack must be an integer between 0 and ${MAX_TRAILING_DAYS}, got ${daysBack}`)
  }
  const until = etTodayStr()
  return syncTikTokRange(shiftDateStr(until, -daysBack), until)
}

/** Writes already-fetched rows. Shared by the sync and by one-off backfills. */
export async function writeTikTokRows(accountDays: TikTokAccountDay[], adDays: TikTokAdDay[]): Promise<void> {
  await withTx(async client => {
    if (accountDays.length > 0) {
      const params = accountDays.flatMap(d => [
        d.stat_date, d.advertiser_id, d.spend, d.impressions, d.clicks, d.conversions,
      ])
      await client.query(
        `INSERT INTO tiktok_daily_spend (stat_date, advertiser_id, spend, impressions, clicks, conversions)
         VALUES ${placeholders(accountDays.length, 6)}
         ON CONFLICT (stat_date, advertiser_id) DO UPDATE SET
           spend = excluded.spend,
           impressions = excluded.impressions,
           clicks = excluded.clicks,
           conversions = excluded.conversions,
           synced_at = now()`,
        params
      )
    }

    if (adDays.length > 0) {
      const params = adDays.flatMap(d => [
        d.stat_date, d.advertiser_id, d.ad_id, d.ad_name, d.adgroup_name, d.campaign_name,
        d.spend, d.impressions, d.clicks, d.conversions,
      ])
      await client.query(
        `INSERT INTO tiktok_daily_ad_spend
           (stat_date, advertiser_id, ad_id, ad_name, adgroup_name, campaign_name, spend, impressions, clicks, conversions)
         VALUES ${placeholders(adDays.length, 10)}
         ON CONFLICT (stat_date, ad_id) DO UPDATE SET
           ad_name = excluded.ad_name,
           adgroup_name = excluded.adgroup_name,
           campaign_name = excluded.campaign_name,
           spend = excluded.spend,
           impressions = excluded.impressions,
           clicks = excluded.clicks,
           conversions = excluded.conversions,
           synced_at = now()`,
        params
      )
    }
  })
}

/** Upsert-only: it never deletes, matching the Meta sync. */
export async function syncTikTokRange(since: string, until: string): Promise<TikTokSyncSummary> {
  const advertisers = tiktokAdvertiserIds()

  // Fetch everything before writing, so a failure on one advertiser can't leave the
  // tables half-updated.
  const fetched = await Promise.all(
    advertisers.map(async id => ({
      days: await fetchAccountDaily(id, since, until),
      ads: await fetchAdDaily(id, since, until),
    }))
  )
  const accountDays = fetched.flatMap(f => f.days)
  const adDays = fetched.flatMap(f => f.ads)

  await writeTikTokRows(accountDays, adDays)

  return {
    since,
    until,
    advertisers,
    account_rows: accountDays.length,
    ad_rows: adDays.length,
    spend_total: accountDays.reduce((sum, d) => sum + d.spend, 0),
    synced_at: new Date().toISOString(),
  }
}
