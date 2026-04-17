import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseRingbaPayload, verifySignature } from '@/lib/ringba'
import { enqueueJob } from '@/lib/queue'

export const runtime = 'nodejs'

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
      buyer_name: parsed.buyer_name,
      publisher_name: parsed.publisher_name,
      revenue: parsed.revenue,
      payout: parsed.payout,
      recording_url_original: parsed.recording_url_original,
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
