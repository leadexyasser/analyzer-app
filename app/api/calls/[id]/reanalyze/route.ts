import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { after } from 'next/server'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
export const maxDuration = 90

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

  // Drain the queue in-process — no HTTP self-call, so this works regardless of cron health.
  after(async () => { try { await runWorker() } catch {} })

  return NextResponse.json({ ok: true })
}
