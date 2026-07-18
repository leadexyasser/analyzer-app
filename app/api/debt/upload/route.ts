import { NextRequest, NextResponse, after } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { one } from '@/lib/db'
import { parseRingbaCsv } from '@/lib/debt/csv'
import { enqueueDebtJob } from '@/lib/debt/queue'
import { runDebtWorker } from '@/lib/debt/worker'

export const runtime = 'nodejs'
export const maxDuration = 90

const MAX_CSV_BYTES = 20 * 1024 * 1024 // 20 MB

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
  let updated = 0
  const newIds: string[] = []

  for (const row of rows) {
    // Upsert semantics:
    //  - New Recording URL → insert, queue for download → transcribe → analyze.
    //  - Existing Recording URL → refresh the CSV-sourced metadata columns only.
    //    Analysis pipeline output (transcript, analysis, scores, status) is preserved.
    //    NULL cells in the new CSV don't overwrite existing values (COALESCE new, old).
    //  - source_filename is unconditionally updated so the row reflects the last CSV that touched it.
    //  - xmax = 0 tells us whether the row was actually inserted (fresh) vs updated (already existed).
    const result = await one<{ id: string; is_new: boolean }>(
      `INSERT INTO debt_calls (
         recording_url_original, call_started_at, campaign, caller_id, target_number,
         number_pool, is_duplicate,
         time_to_call_seconds, time_to_connect_seconds, connected_length_seconds, duration_seconds,
         revenue, source_filename, status, processing_attempts
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', 0)
       ON CONFLICT (recording_url_original) DO UPDATE SET
         call_started_at          = COALESCE(EXCLUDED.call_started_at,          debt_calls.call_started_at),
         campaign                 = COALESCE(EXCLUDED.campaign,                 debt_calls.campaign),
         caller_id                = COALESCE(EXCLUDED.caller_id,                debt_calls.caller_id),
         target_number            = COALESCE(EXCLUDED.target_number,            debt_calls.target_number),
         number_pool              = COALESCE(EXCLUDED.number_pool,              debt_calls.number_pool),
         is_duplicate             = COALESCE(EXCLUDED.is_duplicate,             debt_calls.is_duplicate),
         time_to_call_seconds     = COALESCE(EXCLUDED.time_to_call_seconds,     debt_calls.time_to_call_seconds),
         time_to_connect_seconds  = COALESCE(EXCLUDED.time_to_connect_seconds,  debt_calls.time_to_connect_seconds),
         connected_length_seconds = COALESCE(EXCLUDED.connected_length_seconds, debt_calls.connected_length_seconds),
         duration_seconds         = COALESCE(EXCLUDED.duration_seconds,         debt_calls.duration_seconds),
         revenue                  = COALESCE(EXCLUDED.revenue,                  debt_calls.revenue),
         source_filename          = EXCLUDED.source_filename
       RETURNING id, (xmax = 0) AS is_new`,
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
    if (!result) continue
    if (result.is_new) {
      inserted++
      newIds.push(result.id)
    } else {
      updated++
    }
  }

  // Only enqueue the pipeline for freshly inserted rows.
  // Existing rows keep whatever transcript/analysis they already have.
  for (const id of newIds) {
    await enqueueDebtJob(id, 'download')
  }

  if (newIds.length > 0) {
    after(async () => { try { await runDebtWorker() } catch {} })
  }

  return NextResponse.json({
    ok: true,
    total_rows_in_csv: rows.length,
    inserted,
    updated,
    filename: sourceFilename,
  })
}
