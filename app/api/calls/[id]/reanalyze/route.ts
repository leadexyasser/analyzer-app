import { NextRequest, NextResponse, after } from 'next/server'
import { one, query } from '@/lib/db'
import { enqueueJob } from '@/lib/queue'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const call = await one<{ id: string; status: string; recording_storage_path: string | null }>(
    `SELECT id, status, recording_storage_path FROM calls WHERE id = $1`,
    [id]
  )
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!call.recording_storage_path) {
    return NextResponse.json({ error: 'No recording stored — cannot re-transcribe' }, { status: 400 })
  }

  // Re-process from transcription onward so this call gets the AssemblyAI dual_channel pipeline.
  await query(
    `DELETE FROM processing_jobs WHERE call_id = $1 AND job_type = ANY($2::text[])`,
    [id, ['transcribe', 'analyze']]
  )
  await query(`UPDATE calls SET status = 'pending', error_message = NULL WHERE id = $1`, [id])

  await enqueueJob(id, 'transcribe')

  after(async () => { try { await runWorker() } catch {} })
  return NextResponse.json({ ok: true })
}
