import { NextRequest, NextResponse, after } from 'next/server'
import { one, query } from '@/lib/db'
import { parseRingbaPayload, verifySignature } from '@/lib/ringba'
import { enqueueJob } from '@/lib/queue'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
// 90s — the response goes back to Ringba quickly; the in-process worker drain
// uses its full 75s window after `after()` schedules it.
export const maxDuration = 90

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  const secret = process.env.RINGBA_WEBHOOK_SECRET || null
  const signatureHeader = request.headers.get('x-ringba-signature') ?? request.headers.get('x-signature') ?? null
  const signature_valid = verifySignature(rawBody, signatureHeader, secret)

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Log raw event first — before any processing.
  await query(
    `INSERT INTO webhook_events (payload, signature_valid, processed) VALUES ($1::jsonb, $2, false)`,
    [JSON.stringify(payload), secret ? signature_valid : null]
  )

  if (secret && !signature_valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let parsed: ReturnType<typeof parseRingbaPayload>
  try {
    parsed = parseRingbaPayload(payload)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Parse error: ${message}` }, { status: 422 })
  }

  // Idempotency check — if call already exists, return 200 without reprocessing.
  const existing = await one<{ id: string; status: string }>(
    `SELECT id, status FROM calls WHERE ringba_call_id = $1`,
    [parsed.ringba_call_id]
  )
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true, call_id: existing.id })
  }

  // Duplicate detection: same inbound caller_id seen before (within 30 days).
  let is_duplicate = false
  if (parsed.caller_id) {
    const priorCall = await one<{ id: string }>(
      `SELECT id FROM calls
       WHERE caller_id = $1
         AND received_at >= now() - interval '30 days'
       LIMIT 1`,
      [parsed.caller_id]
    )
    if (priorCall) is_duplicate = true
  }

  const metadata = Object.keys(parsed.metadata).length > 0 ? JSON.stringify(parsed.metadata) : null

  const call = await one<{ id: string }>(
    `INSERT INTO calls (
       ringba_call_id, call_started_at, duration_seconds, caller_id, target_number,
       campaign_name, campaign_id, buyer_name, publisher_name, target_id, target_name,
       end_call_source, is_duplicate, revenue, payout, recording_url_original, metadata,
       status, processing_attempts
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, 'pending', 0)
     RETURNING id`,
    [
      parsed.ringba_call_id,
      parsed.call_started_at,
      parsed.duration_seconds,
      parsed.caller_id,
      parsed.target_number,
      parsed.campaign_name,
      parsed.campaign_id,
      parsed.buyer_name,
      parsed.publisher_name,
      parsed.target_id,
      parsed.target_name,
      parsed.end_call_source,
      is_duplicate,
      parsed.revenue,
      parsed.payout,
      parsed.recording_url_original,
      metadata,
    ]
  )

  if (!call) {
    return NextResponse.json({ error: 'DB insert failed' }, { status: 500 })
  }

  if (parsed.recording_url_original) {
    await enqueueJob(call.id, 'download')
    // Drain in-process after the 200 is sent to Ringba.
    after(async () => { try { await runWorker() } catch {} })
  } else {
    await query(
      `UPDATE calls SET status = 'failed', error_message = 'No recording URL in payload' WHERE id = $1`,
      [call.id]
    )
  }

  await query(
    `UPDATE webhook_events SET processed = true WHERE payload->>'call_id' = $1`,
    [parsed.ringba_call_id]
  )

  return NextResponse.json({ ok: true, call_id: call.id })
}
