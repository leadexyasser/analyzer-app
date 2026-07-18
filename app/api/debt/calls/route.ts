import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { many, one } from '@/lib/db'

export const runtime = 'nodejs'

const COLUMNS = `id, recording_url_original, received_at, call_started_at,
  campaign, caller_id, target_number, number_pool, is_duplicate,
  time_to_call_seconds, time_to_connect_seconds, connected_length_seconds, duration_seconds,
  revenue, recording_storage_path,
  quality_score, compliance_score, flags, analysis,
  status, error_message, source_filename, uploaded_at`

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit

  const campaign = searchParams.get('campaign')
  const callerId = searchParams.get('caller_id')
  const status = searchParams.get('status')
  const isDuplicate = searchParams.get('is_duplicate')
  const flags = searchParams.get('flags')?.split(',').filter(Boolean)
  const minQ = searchParams.get('min_quality')
  const maxQ = searchParams.get('max_quality')
  const minC = searchParams.get('min_compliance')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const sourceFilename = searchParams.get('source_filename')

  const where: string[] = []
  const values: unknown[] = []
  const add = (sqlWithPlaceholder: string, ...vals: unknown[]) => {
    let idx = 0
    where.push(sqlWithPlaceholder.replace(/\?/g, () => `$${values.length + (++idx)}`))
    values.push(...vals)
  }

  if (campaign)      add(`campaign ILIKE ?`, `%${campaign}%`)
  if (callerId)      add(`caller_id ILIKE ?`, `%${callerId}%`)
  if (status)        add(`status = ?`, status)
  if (isDuplicate === 'true')  where.push(`is_duplicate = true`)
  if (isDuplicate === 'false') where.push(`is_duplicate = false`)
  if (flags?.length) add(`flags && ?::text[]`, flags)
  if (minQ)          add(`quality_score >= ?`, Number(minQ))
  if (maxQ)          add(`quality_score <= ?`, Number(maxQ))
  if (minC)          add(`compliance_score >= ?`, Number(minC))
  if (from)          add(`call_started_at >= ?::timestamptz`, from)
  if (to)            add(`call_started_at <= ?::timestamptz`, to)
  if (sourceFilename) add(`source_filename = ?`, sourceFilename)

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const [countRow, rows] = await Promise.all([
      one<{ count: string }>(`SELECT COUNT(*)::text AS count FROM debt_calls ${whereSql}`, values),
      many(
        `SELECT ${COLUMNS} FROM debt_calls ${whereSql}
         ORDER BY call_started_at DESC NULLS LAST, uploaded_at DESC
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
