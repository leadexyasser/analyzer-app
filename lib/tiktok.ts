// Read-only TikTok Marketing API client (official API for Business). It only ever calls
// the reporting endpoint, so nothing here can alter a campaign even by mistake. Give the
// access token reporting/read permission only.
//
// Dates: the TikTok ad account reports in Etc/GMT+5 (fixed UTC-5), which matches ET in
// winter and is one hour behind it during daylight time. Ads run 10:00-20:00 ET, so that
// hour never moves spend across a date boundary in practice.

import { shiftDateStr } from '@/lib/time'

const API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

// TikTok refuses a day-by-day report longer than 30 days, so longer ranges are chunked.
const MAX_DAYS_PER_REQUEST = 30
const PAGE_SIZE = 1000
const MAX_PAGES = 20

export type TikTokAccountDay = {
  stat_date: string
  advertiser_id: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

export type TikTokAdDay = {
  stat_date: string
  advertiser_id: string
  ad_id: string
  ad_name: string | null
  adgroup_name: string | null
  campaign_name: string | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

export type TikTokReportRow = {
  dimensions?: Record<string, string | undefined>
  metrics?: Record<string, string | undefined>
}

type DateRange = { since: string; until: string }

/** True when the env holds what the sync needs; lets the page skip TikTok quietly until set up. */
export function tiktokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_ADVERTISER_IDS)
}

export function tiktokToken(): string {
  const token = process.env.TIKTOK_ACCESS_TOKEN
  if (!token) throw new Error('TIKTOK_ACCESS_TOKEN is not set')
  return token
}

export function tiktokAdvertiserIds(): string[] {
  const raw = process.env.TIKTOK_ADVERTISER_IDS
  if (!raw) throw new Error('TIKTOK_ADVERTISER_IDS is not set')
  return raw.split(',').map(id => id.trim()).filter(Boolean)
}

/** Splits [since, until] into consecutive windows of at most `maxDays` days. */
export function dateChunks(since: string, until: string, maxDays: number = MAX_DAYS_PER_REQUEST): DateRange[] {
  const chunks: DateRange[] = []
  let start = since
  while (start <= until) {
    const end = shiftDateStr(start, maxDays - 1)
    chunks.push({ since: start, until: end < until ? end : until })
    start = shiftDateStr(end, 1)
  }
  return chunks
}

function num(metrics: Record<string, string | undefined>, key: string): number {
  const n = Number(metrics[key])
  return Number.isFinite(n) ? n : 0
}

function text(metrics: Record<string, string | undefined>, key: string): string | null {
  const v = metrics[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** "2026-11-23 00:00:00" -> "2026-11-23"; null when the row carries no day. */
function statDate(dimensions: Record<string, string | undefined>): string | null {
  const v = dimensions.stat_time_day
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null
}

/**
 * Daily account totals. Zero days are kept on purpose: TikTok returns them, and writing
 * them overwrites any stale figure left from an earlier pull.
 */
export function parseAccountDays(rows: TikTokReportRow[], advertiserId: string): TikTokAccountDay[] {
  return rows.flatMap(row => {
    const date = statDate(row.dimensions ?? {})
    if (!date) return []
    const m = row.metrics ?? {}
    return [{
      stat_date: date,
      advertiser_id: advertiserId,
      spend: num(m, 'spend'),
      impressions: num(m, 'impressions'),
      clicks: num(m, 'clicks'),
      conversions: num(m, 'conversion'),
    }]
  })
}

/**
 * Daily per-ad rows. Ad-days with no delivery are dropped: the report includes every ad
 * that exists (deleted ones too, so history stays complete), most of them idle.
 */
export function parseAdDays(rows: TikTokReportRow[], advertiserId: string): TikTokAdDay[] {
  return rows.flatMap(row => {
    const d = row.dimensions ?? {}
    const date = statDate(d)
    const adId = d.ad_id
    if (!date || !adId) return []
    const m = row.metrics ?? {}
    const day: TikTokAdDay = {
      stat_date: date,
      advertiser_id: advertiserId,
      ad_id: adId,
      ad_name: text(m, 'ad_name'),
      adgroup_name: text(m, 'adgroup_name'),
      campaign_name: text(m, 'campaign_name'),
      spend: num(m, 'spend'),
      impressions: num(m, 'impressions'),
      clicks: num(m, 'clicks'),
      conversions: num(m, 'conversion'),
    }
    return day.spend > 0 || day.impressions > 0 || day.conversions > 0 ? [day] : []
  })
}

type ReportResponse = {
  code?: number
  message?: string
  data?: { list?: TikTokReportRow[]; page_info?: { total_page?: number } }
}

/**
 * Walks the integrated report's pages and returns every row. Throws with TikTok's own
 * message on an error: a silent empty result would look identical to "no spend that day".
 */
async function fetchReport(advertiserId: string, params: Record<string, string>): Promise<TikTokReportRow[]> {
  const rows: TikTokReportRow[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const search = new URLSearchParams({
      ...params,
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      page: String(page),
      page_size: String(PAGE_SIZE),
    })
    const res = await fetch(`${API_BASE}/report/integrated/get/?${search.toString()}`, {
      headers: { 'Access-Token': tiktokToken() },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`TikTok API returned HTTP ${res.status} for advertiser ${advertiserId}`)

    const body = (await res.json()) as ReportResponse
    if (body.code !== 0) {
      throw new Error(`TikTok API error for advertiser ${advertiserId} (code ${body.code ?? '?'}): ${body.message ?? 'no message'}`)
    }

    rows.push(...(body.data?.list ?? []))
    const totalPages = body.data?.page_info?.total_page ?? 1
    if (page >= totalPages) return rows
  }
  throw new Error(`TikTok report pagination exceeded ${MAX_PAGES} pages for advertiser ${advertiserId}`)
}

export async function fetchAccountDaily(advertiserId: string, since: string, until: string): Promise<TikTokAccountDay[]> {
  const days: TikTokAccountDay[] = []
  for (const range of dateChunks(since, until)) {
    const rows = await fetchReport(advertiserId, {
      data_level: 'AUCTION_ADVERTISER',
      dimensions: JSON.stringify(['advertiser_id', 'stat_time_day']),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
      start_date: range.since,
      end_date: range.until,
    })
    days.push(...parseAccountDays(rows, advertiserId))
  }
  return days
}

export async function fetchAdDaily(advertiserId: string, since: string, until: string): Promise<TikTokAdDay[]> {
  const days: TikTokAdDay[] = []
  for (const range of dateChunks(since, until)) {
    const rows = await fetchReport(advertiserId, {
      data_level: 'AUCTION_AD',
      dimensions: JSON.stringify(['ad_id', 'stat_time_day']),
      metrics: JSON.stringify(['ad_name', 'adgroup_name', 'campaign_name', 'spend', 'impressions', 'clicks', 'conversion']),
      // Include deleted ads so past days keep their spend after a campaign is removed.
      filtering: JSON.stringify([{ field_name: 'ad_status', filter_type: 'IN', filter_value: '["STATUS_ALL"]' }]),
      start_date: range.since,
      end_date: range.until,
    })
    days.push(...parseAdDays(rows, advertiserId))
  }
  return days
}
