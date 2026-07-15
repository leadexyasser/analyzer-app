import { NextRequest, NextResponse } from 'next/server'
import { one, query } from '@/lib/db'
import { enqueueJob } from '@/lib/queue'

export const runtime = 'nodejs'

type Call = { id: string; status: string; recording_url_original: string | null; recording_storage_path: string | null }

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const call = await one<Record<string, unknown>>(`SELECT * FROM calls WHERE id = $1`, [id])
  if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404 })

  const storagePath = call.recording_storage_path as string | null
  // Stream via /api/audio which proxies from the droplet. The path segments are
  // encoded individually so slashes in the storage key remain intact.
  const audio_url = storagePath
    ? `/api/audio/${storagePath.split('/').map(encodeURIComponent).join('/')}`
    : null
  return NextResponse.json({ ...call, audio_url })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  if (!(typeof body.revenue === 'number' || body.revenue === null)) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    await query(`UPDATE calls SET revenue = $2 WHERE id = $1`, [id, body.revenue])
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const call = await one<Call>(
    `SELECT id, status, recording_url_original, recording_storage_path FROM calls WHERE id = $1`,
    [id]
  )
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (call.status !== 'failed') return NextResponse.json({ error: 'Call is not in failed state' }, { status: 400 })

  await query(
    `UPDATE calls SET status = 'pending', error_message = NULL, processing_attempts = 0 WHERE id = $1`,
    [id]
  )
  await query(`DELETE FROM processing_jobs WHERE call_id = $1`, [id])
  await enqueueJob(id, 'download')

  return NextResponse.json({ ok: true })
}
