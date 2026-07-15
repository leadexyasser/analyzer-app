import { NextRequest, NextResponse, after } from 'next/server'
import { many, one, query } from '@/lib/db'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(_request: NextRequest) {
  // Reset all stuck/failed jobs back to queued (bugs may have been fixed since).
  const resetResult = await query<{ call_id: string }>(
    `UPDATE processing_jobs
     SET status = 'queued', scheduled_for = now(), attempts = 0
     WHERE status = ANY($1::text[])
     RETURNING call_id`,
    [['running', 'failed']]
  )
  const resetCount = resetResult.rowCount ?? 0
  const failedCallIds = Array.from(new Set(resetResult.rows.map(r => r.call_id).filter(Boolean)))

  if (failedCallIds.length > 0) {
    await query(
      `UPDATE calls
       SET status = 'pending', error_message = NULL
       WHERE id = ANY($1::uuid[]) AND status = 'failed'`,
      [failedCallIds]
    )
  }

  // Find calls stuck in an in-flight state with no queued/running job.
  const stuckCalls = await many<{ id: string }>(
    `SELECT id FROM calls
     WHERE status = ANY($1::text[])
       AND updated_at < now() - interval '5 minutes'`,
    [['pending', 'downloading', 'transcribing', 'analyzing']]
  )

  let requeued = 0
  for (const call of stuckCalls) {
    const activeJob = await one<{ id: string }>(
      `SELECT id FROM processing_jobs
       WHERE call_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
      [call.id, ['queued', 'running']]
    )
    if (activeJob) continue

    const callData = await one<{ status: string; recording_storage_path: string | null; transcript_text: string | null }>(
      `SELECT status, recording_storage_path, transcript_text FROM calls WHERE id = $1`,
      [call.id]
    )
    if (!callData) continue

    let jobType: 'download' | 'transcribe' | 'analyze' = 'download'
    if (callData.recording_storage_path && !callData.transcript_text) jobType = 'transcribe'
    else if (callData.transcript_text) jobType = 'analyze'

    await query(
      `INSERT INTO processing_jobs (call_id, job_type, status, attempts, scheduled_for)
       VALUES ($1, $2, 'queued', 0, now())`,
      [call.id, jobType]
    )
    requeued++
  }

  after(async () => { try { await runWorker() } catch {} })

  return NextResponse.json({ ok: true, reset: resetCount, requeued })
}
