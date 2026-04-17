import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { after } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  // Reset all stuck running/failed jobs back to queued
  const { count: resetCount } = await supabase
    .from('processing_jobs')
    .update({ status: 'queued', scheduled_for: now })
    .in('status', ['running', 'failed'])
    .lt('attempts', 3)
    .select('id')

  // Also find calls that are pending/stuck with no queued job at all
  const { data: stuckCalls } = await supabase
    .from('calls')
    .select('id')
    .in('status', ['pending', 'downloading', 'transcribing', 'analyzing'])
    .lt('updated_at', new Date(Date.now() - 5 * 60_000).toISOString())

  let requeued = 0
  for (const call of stuckCalls ?? []) {
    const { count } = await supabase
      .from('processing_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('call_id', call.id)
      .in('status', ['queued', 'running'])

    if (!count) {
      // No active job — figure out which stage to re-enqueue
      const { data: callData } = await supabase
        .from('calls')
        .select('status, recording_storage_path, transcript_text')
        .eq('id', call.id)
        .single()

      if (!callData) continue

      let jobType: 'download' | 'transcribe' | 'analyze' = 'download'
      if (callData.recording_storage_path && !callData.transcript_text) jobType = 'transcribe'
      else if (callData.transcript_text) jobType = 'analyze'

      await supabase.from('processing_jobs').insert({
        call_id: call.id,
        job_type: jobType,
        status: 'queued',
        attempts: 0,
        scheduled_for: now,
      })
      requeued++
    }
  }

  // Kick off the worker immediately
  after(async () => {
    const host =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : null)
    if (!host || !process.env.CRON_SECRET) return
    const headers = {
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
      'Content-Type': 'application/json',
    }
    for (let i = 0; i < 3; i++) {
      try { await fetch(`${host}/api/jobs/process`, { method: 'POST', headers }) } catch {}
      if (i < 2) await new Promise(r => setTimeout(r, 2000))
    }
  })

  return NextResponse.json({ ok: true, reset: resetCount ?? 0, requeued })
}
