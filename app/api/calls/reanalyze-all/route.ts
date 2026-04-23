import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/queue'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = createServiceClient()
  const body = await request.json().catch(() => ({}))
  const { from, to } = body as { from?: string; to?: string }

  let query = supabase
    .from('calls')
    .select('id')
    .eq('status', 'complete')
    .not('transcript_text', 'is', null)

  if (from) query = query.gte('call_started_at', from)
  if (to)   query = query.lte('call_started_at', to)

  const { data: calls, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!calls?.length) return NextResponse.json({ ok: true, queued: 0 })

  const ids = calls.map(c => c.id)

  // Delete stale analyze jobs and reset status
  await supabase.from('processing_jobs').delete().in('call_id', ids).eq('job_type', 'analyze')
  await supabase.from('calls').update({ status: 'analyzing', error_message: null }).in('id', ids)

  for (const id of ids) {
    await enqueueJob(id, 'analyze')
  }

  return NextResponse.json({ ok: true, queued: ids.length })
}
