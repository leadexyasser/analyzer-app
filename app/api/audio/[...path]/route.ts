import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { streamRecording } from '@/lib/storage'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Session-guard the audio proxy — recordings can contain PII, don't serve unauthenticated.
  const session = await getSessionFromRequest()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path } = await params
  const key = path.map(decodeURIComponent).join('/')
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  const range = request.headers.get('range')
  try {
    return await streamRecording(key, range)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
