import { NextRequest, NextResponse, after } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { one, query } from '@/lib/db'
import { parseRingbaCsv } from '@/lib/debt/csv'
import { enqueueDebtJob } from '@/lib/debt/queue'
import { runDebtWorker } from '@/lib/debt/worker'

export const runtime = 'nodejs'
export const maxDuration = 90

const MAX_CSV_BYTES = 20 * 1024 * 1024 // 20 MB — generous for a Ringba export

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })

  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  if (file.size > MAX_CSV_BYTES) return NextResponse.json({ error: `File too large (max ${MAX_CSV_BYTES / 1024 / 1024} MB)` }, { status: 413 })

  const csvText = await file.text()
  let rows
  try {
    rows = parseRingbaCsv(csvText)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Parse failed'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No usable rows found (missing Recording URL)' }, { status: 422 })
  }

  const sourceFilename = file.name
  let inserted = 0
  let skipped = 0
  const newIds: string[] = []

  // Insert with ON CONFLICT DO NOTHING — dedup by recording URL.
  for (const row of rows) {
    const result = await one<{ id: string }>(
      `INSERT INTO debt_calls (
         recording_url_original, call_started_at, campaign, caller_id, target_number,
         number_pool, is_duplicate,
         time_to_call_seconds, time_to_connect_seconds, connected_length_seconds, duration_seconds,
         revenue, source_filename, status, processing_attempts
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', 0)
       ON CONFLICT (recording_url_original) DO NOTHING
       RETURNING id`,
      [
        row.recording_url_original,
        row.call_started_at,
        row.campaign,
        row.caller_id,
        row.target_number,
        row.number_pool,
        row.is_duplicate,
        row.time_to_call_seconds,
        row.time_to_connect_seconds,
        row.connected_length_seconds,
        row.duration_seconds,
        row.revenue,
        sourceFilename,
      ]
    )
    if (result?.id) {
      inserted++
      newIds.push(result.id)
    } else {
      skipped++
    }
  }

  // Enqueue download jobs for the newly-inserted rows.
  for (const id of newIds) {
    await enqueueDebtJob(id, 'download')
  }

  // Kick the worker after responding.
  after(async () => { try { await runDebtWorker() } catch {} })

  return NextResponse.json({
    ok: true,
    total_rows_in_csv: rows.length,
    inserted,
    skipped_duplicates: skipped,
    filename: sourceFilename,
  })
}
