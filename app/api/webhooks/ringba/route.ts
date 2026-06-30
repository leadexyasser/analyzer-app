import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseRingbaPayload, verifySignature } from '@/lib/ringba'
import { enqueueJob } from '@/lib/queue'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
// 90s — the response goes back to Ringba quickly; the in-process worker drain
// uses its full 75s window after `after()` schedules it.
export const maxDuration = 90

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const supabase = createServiceClient()

  // Verify signature if secret is configured
  const secret = process.env.RINGBA_WEBHOOK_SECRET || null
  const signatureHeader = request.headers.get('x-ringba-signature') ?? request.headers.get('x-signature') ?? null
  const signature_valid = verifySignature(rawBody, signatureHeader, secret)

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Log raw event first — before any processing
  await supabase.from('webhook_events').insert({
    payload: payload as Record<string, unknown>,
    signature_valid: secret ? signature_valid : null,
    processed: false,
  })

  if (secret && !signature_valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Parse and extract fields
  let parsed: ReturnType<typeof parseRingbaPayload>
  try {
    parsed = parseRingbaPayload(payload)
  } catch (err: any) {
    return NextResponse.json({ error: `Parse error: ${err.message}` }, { status: 422 })
  }

  // Idempotency check — if call already exists, return 200 without reprocessing
  const { data: existing } = await supabase
    .from('calls')
    .select('id, status')
    .eq('ringba_call_id', parsed.ringba_call_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true, call_id: existing.id })
  }

  // Duplicate detection: same inbound caller_id seen before (within 30 days)
  let is_duplicate = false
  if (parsed.caller_id) {
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: priorCall } = await supabase
      .from('calls')
      .select('id')
      .eq('caller_id', parsed.caller_id)
      .gte('received_at', windowStart)
      .limit(1)
      .maybeSingle()
    if (priorCall) is_duplicate = true
  }

  // Insert call row
  const { data: call, error: insertError } = await supabase
    .from('calls')
    .insert({
      ringba_call_id: parsed.ringba_call_id,
      call_started_at: parsed.call_started_at,
      duration_seconds: parsed.duration_seconds,
      caller_id: parsed.caller_id,
      target_number: parsed.target_number,
      campaign_name: parsed.campaign_name,
      campaign_id: parsed.campaign_id,
      buyer_name: parsed.buyer_name,
      publisher_name: parsed.publisher_name,
      target_id: parsed.target_id,
      target_name: parsed.target_name,
      end_call_source: parsed.end_call_source,
      is_duplicate,
      revenue: parsed.revenue,
      payout: parsed.payout,
      recording_url_original: parsed.recording_url_original,
      metadata: Object.keys(parsed.metadata).length > 0 ? parsed.metadata : null,
      status: 'pending',
      processing_attempts: 0,
    })
    .select('id')
    .single()

  if (insertError || !call) {
    return NextResponse.json({ error: 'DB insert failed' }, { status: 500 })
  }

  // Enqueue download job if there's a recording URL
  if (parsed.recording_url_original) {
    await enqueueJob(call.id, 'download')

    // Drain the queue in-process after the 200 is sent to Ringba. No HTTP self-call —
    // the previous pattern silently failed when NEXT_PUBLIC_APP_URL was unset, which
    // is what kept calls stuck on pending. runWorker loops internally and processes
    // download → transcribe → analyze in one Node invocation.
    after(async () => { try { await runWorker() } catch {} })
  } else {
    // No recording — mark as failed with a clear message
    await supabase
      .from('calls')
      .update({ status: 'failed', error_message: 'No recording URL in payload' })
      .eq('id', call.id)
  }

  // Mark webhook event as processed
  await supabase
    .from('webhook_events')
    .update({ processed: true })
    .eq('payload->>call_id', parsed.ringba_call_id)

  return NextResponse.json({ ok: true, call_id: call.id })
}
