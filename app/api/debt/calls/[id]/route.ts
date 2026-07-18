import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { one } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const call = await one<Record<string, unknown>>(`SELECT * FROM debt_calls WHERE id = $1`, [id])
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const storagePath = call.recording_storage_path as string | null
  const audio_url = storagePath
    ? `/api/audio/${storagePath.split('/').map(encodeURIComponent).join('/')}`
    : null
  return NextResponse.json({ ...call, audio_url })
}
