import { NextRequest, NextResponse, after } from 'next/server'
import { many, query } from '@/lib/db'
import { enqueueJob } from '@/lib/queue'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { from, to } = body as { from?: string; to?: string }

  const values: unknown[] = []
  const conds: string[] = [`recording_storage_path IS NOT NULL`]
  if (from) { values.push(from); conds.push(`call_started_at >= $${values.length}`) }
  if (to)   { values.push(to);   conds.push(`call_started_at <= $${values.length}`) }

  const rows = await many<{ id: string }>(
    `SELECT id FROM calls WHERE ${conds.join(' AND ')}`,
    values
  )
  if (rows.length === 0) return NextResponse.json({ ok: true, queued: 0 })

  const ids = rows.map(r => r.id)

  await query(
    `DELETE FROM processing_jobs WHERE call_id = ANY($1::uuid[]) AND job_type = ANY($2::text[])`,
    [ids, ['transcribe', 'analyze']]
  )
  await query(
    `UPDATE calls SET status = 'pending', error_message = NULL WHERE id = ANY($1::uuid[])`,
    [ids]
  )

  for (const id of ids) {
    await enqueueJob(id, 'transcribe')
  }

  after(async () => { try { await runWorker() } catch {} })

  return NextResponse.json({ ok: true, queued: ids.length, message: 'Re-transcribing via AssemblyAI then re-analyzing' })
}
