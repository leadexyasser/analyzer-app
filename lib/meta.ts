// Read-only Meta Marketing API client. The token this uses is a System User token
// scoped to `ads_read` only, so nothing here can alter a campaign even by mistake.
//
// Dates: the ad account's timezone is America/New_York, and Meta interprets
// `time_range` in the account's own timezone. That lines up with lib/time.ts, so a
// `stat_date` from Meta and an ET call date refer to the same day with no conversion.

const GRAPH_VERSION = 'v21.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

// Meta paginates insights; a trailing-week pull at ad level is well under this, but
// the cursor is followed anyway so a widened window can't silently truncate.
const MAX_PAGES = 20

// The custom pixel conversion the campaigns optimise towards. It tracks a billable
// call, and lines up with the `calls` table to within ~6% (attribution window loss).
const CONVERSION_ACTION = 'offsite_conversion.fb_pixel_custom.RingbaConversion'

// Fires when the visitor triggers the call button, so it approximates a raw call
// attempt — within ~4% of the Ringba export's raw count. Over-fires slightly, as
// client-side pixels do.
const RAW_CALL_ACTION = 'view_content'

export type MetaAccountDay = {
  stat_date: string
  ad_account_id: string
  spend: number
  impressions: number
  link_clicks: number
  clicks: number
  reach: number
  frequency: number | null
  pixel_raw_calls: number
  pixel_conversions: number
}

export type MetaAdDay = {
  stat_date: string
  ad_account_id: string
  ad_id: string
  ad_name: string | null
  campaign_name: string | null
  adset_name: string | null
  spend: number
  impressions: number
  link_clicks: number
  pixel_raw_calls: number
  pixel_conversions: number
}

type InsightsRow = Record<string, unknown>

type ActionEntry = { action_type?: unknown; value?: unknown }

export function metaToken(): string {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new Error('META_ACCESS_TOKEN is not set')
  return token
}

/** Ad account ids from env, without the `act_` prefix. */
export function metaAdAccountIds(): string[] {
  const raw = process.env.META_AD_ACCOUNT_IDS
  if (!raw) throw new Error('META_AD_ACCOUNT_IDS is not set')
  return raw
    .split(',')
    .map(id => id.trim().replace(/^act_/, ''))
    .filter(Boolean)
}

function num(row: InsightsRow, key: string): number {
  const v = row[key]
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function str(row: InsightsRow, key: string): string | null {
  const v = row[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Pulls one action type out of an insights `actions`/`conversions` array.
 *
 * Meta returns these as a list of {action_type, value} rather than named fields, and
 * omits an entry entirely when the count is zero — so a missing entry means zero.
 */
function actionValue(row: InsightsRow, field: 'actions' | 'conversions', actionType: string): number {
  const list = row[field]
  if (!Array.isArray(list)) return 0
  for (const entry of list as ActionEntry[]) {
    if (entry?.action_type === actionType) {
      const n = Number(entry.value)
      return Number.isFinite(n) ? n : 0
    }
  }
  return 0
}

/**
 * Walks Meta's insights pagination and returns every row.
 * Throws with Meta's own message on an API error — a silent empty result here would
 * look identical to "that day had no spend", which would quietly corrupt the table.
 */
async function fetchInsights(
  accountId: string,
  params: Record<string, string>
): Promise<InsightsRow[]> {
  const search = new URLSearchParams({ ...params, access_token: metaToken(), limit: '500' })
  let url = `${GRAPH_BASE}/act_${accountId}/insights?${search.toString()}`
  const pages: InsightsRow[][] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(url, { cache: 'no-store' })
    const body = (await res.json()) as {
      data?: InsightsRow[]
      paging?: { next?: string }
      error?: { message?: string; type?: string; code?: number }
    }

    if (body.error) {
      const e = body.error
      throw new Error(`Meta API error for act_${accountId} (${e.type ?? 'unknown'} ${e.code ?? ''}): ${e.message ?? 'no message'}`)
    }
    if (!res.ok) {
      throw new Error(`Meta API returned HTTP ${res.status} for act_${accountId}`)
    }

    pages.push(body.data ?? [])
    const next = body.paging?.next
    if (!next) return pages.flat()
    url = next
  }

  throw new Error(`Meta API pagination exceeded ${MAX_PAGES} pages for act_${accountId}`)
}

/**
 * Daily account totals for [since, until] inclusive, dates as "YYYY-MM-DD".
 *
 * `inline_link_clicks` is used rather than the action-based `link_click` because it
 * carries no attribution window, so it settles immediately and doesn't drift for days.
 */
export async function fetchAccountDaily(
  accountId: string,
  since: string,
  until: string
): Promise<MetaAccountDay[]> {
  const rows = await fetchInsights(accountId, {
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    level: 'account',
    fields: 'spend,impressions,inline_link_clicks,clicks,reach,frequency,conversions,actions',
  })

  return rows.map(row => ({
    stat_date: str(row, 'date_start') ?? since,
    ad_account_id: accountId,
    spend: num(row, 'spend'),
    impressions: num(row, 'impressions'),
    link_clicks: num(row, 'inline_link_clicks'),
    clicks: num(row, 'clicks'),
    reach: num(row, 'reach'),
    frequency: row['frequency'] === undefined ? null : num(row, 'frequency'),
    pixel_raw_calls: actionValue(row, 'actions', RAW_CALL_ACTION),
    pixel_conversions: actionValue(row, 'conversions', CONVERSION_ACTION),
  }))
}

/**
 * Daily per-ad rows. `ad_name` is the join key to call attribution — Ringba carries
 * it through to calls.metadata->>'utm_content'.
 */
export async function fetchAdDaily(
  accountId: string,
  since: string,
  until: string
): Promise<MetaAdDay[]> {
  const rows = await fetchInsights(accountId, {
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    level: 'ad',
    fields: 'ad_id,ad_name,campaign_name,adset_name,spend,impressions,inline_link_clicks,conversions,actions',
  })

  return rows.flatMap(row => {
    const ad_id = str(row, 'ad_id')
    if (!ad_id) return []
    return [{
      stat_date: str(row, 'date_start') ?? since,
      ad_account_id: accountId,
      ad_id,
      ad_name: str(row, 'ad_name'),
      campaign_name: str(row, 'campaign_name'),
      adset_name: str(row, 'adset_name'),
      spend: num(row, 'spend'),
      impressions: num(row, 'impressions'),
      link_clicks: num(row, 'inline_link_clicks'),
      pixel_raw_calls: actionValue(row, 'actions', RAW_CALL_ACTION),
      pixel_conversions: actionValue(row, 'conversions', CONVERSION_ACTION),
    }]
  })
}

/** Account name and timezone — used to verify the token reaches the account. */
export async function fetchAccountInfo(accountId: string): Promise<{
  id: string
  name: string | null
  timezone_name: string | null
  account_status: number | null
}> {
  const search = new URLSearchParams({
    fields: 'name,timezone_name,account_status',
    access_token: metaToken(),
  })
  const res = await fetch(`${GRAPH_BASE}/act_${accountId}?${search.toString()}`, { cache: 'no-store' })
  const body = (await res.json()) as {
    id?: string
    name?: string
    timezone_name?: string
    account_status?: number
    error?: { message?: string }
  }
  if (body.error) throw new Error(`Meta API error for act_${accountId}: ${body.error.message ?? 'no message'}`)

  return {
    id: body.id ?? `act_${accountId}`,
    name: body.name ?? null,
    timezone_name: body.timezone_name ?? null,
    account_status: body.account_status ?? null,
  }
}
