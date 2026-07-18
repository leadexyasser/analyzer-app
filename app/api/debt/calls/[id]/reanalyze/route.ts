import { NextRequest, NextResponse, after } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { one, query } from '@/lib/db'
import { enqueueDebtJob } from '@/lib/debt/queue'
import { runDebtWorker } from '@/lib/debt/worker'

export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const call = await one<{ id: string; recording_storage_path: string | null }>(
    `SELECT id, recording_storage_path FROM debt_calls WHERE id = $1`,
    [id]
  )
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!call.recording_storage_path) {
    return NextResponse.json({ error: 'No recording stored — cannot re-transcribe' }, { status: 400 })
  }

  await query(
    `DELETE FROM debt_processing_jobs WHERE call_id = $1 AND job_type = ANY($2::text[])`,
    [id, ['transcribe', 'analyze']]
  )
  await query(`UPDATE debt_calls SET status = 'pending', error_message = NULL WHERE id = $1`, [id])

  await enqueueDebtJob(id, 'transcribe')
  after(async () => { try { await runDebtWorker() } catch {} })
  return NextResponse.json({ ok: true })
}
