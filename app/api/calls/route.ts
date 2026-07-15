import { NextRequest, NextResponse } from 'next/server'
import { many, one } from '@/lib/db'

export const runtime = 'nodejs'

const COLUMNS = `id, ringba_call_id, received_at, call_started_at, duration_seconds,
  caller_id, target_number, campaign_name, campaign_id, buyer_name, publisher_name,
  target_id, target_name, end_call_source, is_duplicate, revenue, payout,
  quality_score, flags, analysis, status, error_message`

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit

  const publisherScope = searchParams.get('publisher_scope')
  const status = searchParams.get('status')
  const campaign = searchParams.get('campaign')
  const buyer = searchParams.get('buyer')
  const publisher = searchParams.get('publisher')
  const targetName = searchParams.get('target_name')
  const callerId = searchParams.get('caller_id')
  const endCallSource = searchParams.get('end_call_source')
  const isDuplicate = searchParams.get('is_duplicate')
  const flags = searchParams.get('flags')?.split(',').filter(Boolean)
  const minScore = searchParams.get('min_score')
  const maxScore = searchParams.get('max_score')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const leadVerdict = searchParams.get('lead_verdict')

  const where: string[] = []
  const values: unknown[] = []
  const add = (sqlWithPlaceholder: string, ...vals: unknown[]) => {
    let idx = 0
    const rendered = sqlWithPlaceholder.replace(/\?/g, () => {
      const n = values.length + idx + 1
      idx++
      return `$${n}`
    })
    where.push(rendered)
    values.push(...vals)
  }

  if (publisherScope) add(`publisher_name = ?`, publisherScope)
  if (status)         add(`status = ?`, status)
  if (campaign)       add(`campaign_name ILIKE ?`, `%${campaign}%`)
  if (buyer)          add(`buyer_name ILIKE ?`, `%${buyer}%`)
  if (publisher)      add(`publisher_name ILIKE ?`, `%${publisher}%`)
  if (targetName)     add(`target_name ILIKE ?`, `%${targetName}%`)
  if (callerId)       add(`caller_id ILIKE ?`, `%${callerId}%`)
  if (endCallSource)  add(`end_call_source ILIKE ?`, `%${endCallSource}%`)
  if (isDuplicate === 'true')  where.push(`is_duplicate = true`)
  if (isDuplicate === 'false') where.push(`is_duplicate = false`)
  if (flags?.length)  add(`flags && ?::text[]`, flags)
  if (minScore)       add(`quality_score >= ?`, Number(minScore))
  if (maxScore)       add(`quality_score <= ?`, Number(maxScore))
  if (from)           add(`call_started_at >= ?`, from)
  if (to)             add(`call_started_at <= ?`, to)
  if (leadVerdict)    add(`analysis->'lead_intent'->>'verdict' = ?`, leadVerdict)

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const [countRow, rows] = await Promise.all([
      one<{ count: string }>(`SELECT COUNT(*)::text AS count FROM calls ${whereSql}`, values),
      many(
        `SELECT ${COLUMNS} FROM calls ${whereSql}
         ORDER BY call_started_at DESC NULLS LAST
         LIMIT ${limit} OFFSET ${offset}`,
        values
      ),
    ])
    const total = countRow ? Number(countRow.count) : 0
    return NextResponse.json({ calls: rows, total, page, limit })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
