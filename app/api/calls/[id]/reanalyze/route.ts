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
    .select('id, status, transcript_text')
    .eq('id', id)
    .single()

  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!call.transcript_text) return NextResponse.json({ error: 'No transcript — re-download the call instead' }, { status: 400 })

  // Delete old analyze jobs, queue a fresh one
  await supabase.from('processing_jobs').delete().eq('call_id', id).eq('job_type', 'analyze')
  await supabase.from('calls').update({ status: 'analyzing', error_message: null }).eq('id', id)

  const { enqueueJob } = await import('@/lib/queue')
  await enqueueJob(id, 'analyze')

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
