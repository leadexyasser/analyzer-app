import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 30

// Everflow macro names vary by network configuration, so rather than demanding one
// shape, each field accepts the aliases seen in the wild and the whole query string is
// stored raw. An unrecognised macro therefore still lands in `raw` and can be mapped
// later without losing the conversion.
const FIELD_ALIASES: Record<string, string[]> = {
  transaction_id: ['txid', 'transaction_id', 'tid'],
  conversion_id: ['conversion_id', 'conv_id', 'cid'],
  offer_id: ['offer_id', 'oid', 'offer'],
  offer_name: ['offer_name', 'offer_nm'],
  status: ['status', 'conversion_status', 'state'],
  payout: ['payout', 'payout_amount', 'amount'],
  revenue: ['revenue', 'revenue_amount', 'sale_amount'],
  click_id: ['click_id', 'clickid'],
  sub1: ['sub1', 's1'],
  sub2: ['sub2', 's2'],
  sub3: ['sub3', 's3'],
  sub4: ['sub4', 's4'],
  sub5: ['sub5', 's5'],
}

function pick(params: URLSearchParams, aliases: string[]): string | null {
  for (const key of aliases) {
    const v = params.get(key)
    // An unfired macro arrives as the literal "{sub3}" rather than an empty value.
    if (v !== null && v !== '' && !/^\{.*\}$/.test(v)) return v
  }
  return null
}

function toNumber(v: string | null): number | null {
  if (v === null) return null
  const n = Number(v.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Accepts a unix timestamp (s or ms) or an ISO string.
 *
 * Falls back to arrival time because this network sends `conv_time` empty — without a
 * fallback every conversion would carry a null date and drop out of any daily rollup.
 * Postbacks fire within seconds of the conversion, so arrival time is accurate to the
 * day, which is the grain the reporting uses.
 */
function toTimestamp(params: URLSearchParams): string {
  const raw = pick(params, ['conv_time', 'conversion_unix_timestamp', 'timestamp', 'datetime'])
  if (raw !== null) {
    const asNum = Number(raw)
    if (Number.isFinite(asNum) && asNum > 0) {
      return new Date(asNum > 1e11 ? asNum : asNum * 1000).toISOString()
    }
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date().toISOString()
}

async function handle(request: NextRequest, body: Record<string, string>) {
  const params = new URLSearchParams(request.nextUrl.search)
  for (const [k, v] of Object.entries(body)) if (!params.has(k)) params.set(k, v)

  const raw = Object.fromEntries(params.entries())
  const expected = process.env.EVERFLOW_POSTBACK_SECRET
  const secretValid = !expected || params.get('secret') === expected

  const fields = Object.fromEntries(
    Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, pick(params, aliases)])
  ) as Record<keyof typeof FIELD_ALIASES, string | null>

  const txid = fields.transaction_id
  const accepted = secretValid && txid !== null

  await query(
    `INSERT INTO network_postback_log (query, secret_valid, accepted, note)
     VALUES ($1::jsonb, $2, $3, $4)`,
    [
      JSON.stringify(raw),
      secretValid,
      accepted,
      accepted ? null : !secretValid ? 'bad secret' : 'no transaction id',
    ]
  )

  if (!secretValid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Still 200 without a transaction id: the network retries non-2xx, and a retry cannot
  // supply an id that the macro never populated. The log row is the signal to fix it.
  if (txid === null) return NextResponse.json({ ok: false, error: 'No transaction id' })

  await query(
    `INSERT INTO network_conversions
       (transaction_id, conversion_id, offer_id, offer_name, status, payout, revenue,
        click_id, sub1, sub2, sub3, sub4, sub5, converted_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
     ON CONFLICT (transaction_id) DO UPDATE SET
       conversion_id = coalesce(excluded.conversion_id, network_conversions.conversion_id),
       offer_id      = coalesce(excluded.offer_id,      network_conversions.offer_id),
       offer_name    = coalesce(excluded.offer_name,    network_conversions.offer_name),
       status        = coalesce(excluded.status,        network_conversions.status),
       payout        = coalesce(excluded.payout,        network_conversions.payout),
       revenue       = coalesce(excluded.revenue,       network_conversions.revenue),
       -- Keep the ORIGINAL date. Since converted_at now falls back to arrival time, a
       -- reversal landing days later would otherwise drag the conversion into the day
       -- it was reversed and silently distort every daily total either side.
       converted_at  = coalesce(network_conversions.converted_at, excluded.converted_at),
       raw           = excluded.raw,
       updated_at    = now()`,
    [
      txid, fields.conversion_id, fields.offer_id, fields.offer_name, fields.status,
      toNumber(fields.payout), toNumber(fields.revenue), fields.click_id,
      fields.sub1, fields.sub2, fields.sub3, fields.sub4, fields.sub5,
      toTimestamp(params), JSON.stringify(raw),
    ]
  )

  return NextResponse.json({ ok: true, transaction_id: txid })
}

// Everflow fires postbacks as GET; POST is accepted so the same URL works if the
// network is reconfigured, and for manual testing.
export async function GET(request: NextRequest) {
  return handle(request, {})
}

export async function POST(request: NextRequest) {
  let body: Record<string, string> = {}
  try {
    const text = await request.text()
    if (text.trim().startsWith('{')) {
      body = JSON.parse(text) as Record<string, string>
    } else if (text.length > 0) {
      body = Object.fromEntries(new URLSearchParams(text).entries())
    }
  } catch {
    // A malformed body is not fatal — the query string usually carries the macros.
  }
  return handle(request, body)
}
