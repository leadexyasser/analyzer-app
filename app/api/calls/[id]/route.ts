import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getSignedUrl } from '@/lib/storage'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: call, error } = await supabase
    .from('calls')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  }

  let audio_url: string | null = null
  if (call.recording_storage_path) {
    try {
      audio_url = await getSignedUrl(call.recording_storage_path)
    } catch {
      // Non-fatal — audio may have been deleted per retention policy
    }
  }

  return NextResponse.json({ ...call, audio_url })
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Retry failed call
  const { id } = await params
  const supabase = createServiceClient()

  const { data: call, error } = await supabase
    .from('calls')
    .select('id, status, recording_url_original')
    .eq('id', id)
    .single()

  if (error || !call) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (call.status !== 'failed') return NextResponse.json({ error: 'Call is not in failed state' }, { status: 400 })

  // Reset call status and re-enqueue
  await supabase
    .from('calls')
    .update({ status: 'pending', error_message: null, processing_attempts: 0 })
    .eq('id', id)

  // Delete old failed jobs and create a fresh download job
  await supabase.from('processing_jobs').delete().eq('call_id', id)

  const { enqueueJob } = await import('@/lib/queue')
  await enqueueJob(id, 'download')

  return NextResponse.json({ ok: true })
}
