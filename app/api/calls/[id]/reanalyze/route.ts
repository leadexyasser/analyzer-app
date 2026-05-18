import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { after } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: call } = await supabase
    .from('calls')
    .select('id, status, recording_storage_path')
    .eq('id', id)
    .single()

  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!call.recording_storage_path) return NextResponse.json({ error: 'No recording stored — cannot re-transcribe' }, { status: 400 })

  // Re-process from transcription onward so this call gets the AssemblyAI
  // dual_channel pipeline. Just re-running analyze on old Whisper transcripts
  // produces nearly identical results — the accuracy win is in the new transcription.
  await supabase.from('processing_jobs').delete().eq('call_id', id).in('job_type', ['transcribe', 'analyze'])
  await supabase.from('calls').update({ status: 'pending', error_message: null }).eq('id', id)

  const { enqueueJob } = await import('@/lib/queue')
  await enqueueJob(id, 'transcribe')

  // Kick off immediately
  after(async () => {
    const host =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    if (!host || !process.env.CRON_SECRET) return
    try {
      await fetch(`${host}/api/jobs/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    } catch {}
  })

  return NextResponse.json({ ok: true })
}
