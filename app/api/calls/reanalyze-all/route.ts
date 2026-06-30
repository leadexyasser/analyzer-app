import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/queue'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(request: NextRequest) {
  const supabase = createServiceClient()
  const body = await request.json().catch(() => ({}))
  const { from, to } = body as { from?: string; to?: string }

  // Re-process from transcription onward so existing calls get the new AssemblyAI
  // dual_channel pipeline (with definitive AGENT/CALLER speaker labels). Just re-running
  // the LLM analyze step on old Whisper transcripts produces nearly identical results —
  // the accuracy win lives in the channel-separated transcription.
  let query = supabase
    .from('calls')
    .select('id, recording_storage_path')
    .not('recording_storage_path', 'is', null)

  if (from) query = query.gte('call_started_at', from)
  if (to)   query = query.lte('call_started_at', to)

  const { data: calls, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!calls?.length) return NextResponse.json({ ok: true, queued: 0 })

  const ids = calls.map(c => c.id)

  // Wipe stale jobs for both stages so the new transcribe runs cleanly.
  await supabase.from('processing_jobs').delete().in('call_id', ids).in('job_type', ['transcribe', 'analyze'])
  await supabase.from('calls').update({ status: 'pending', error_message: null }).in('id', ids)

  for (const id of ids) {
    await enqueueJob(id, 'transcribe')
  }

  // Drain in-process — no HTTP self-call required.
  after(async () => { try { await runWorker() } catch {} })

  return NextResponse.json({ ok: true, queued: ids.length, message: 'Re-transcribing via AssemblyAI then re-analyzing' })
}
