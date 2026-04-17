import { z } from 'zod'
import crypto from 'crypto'

/**
 * Ringba sends call postbacks when a call completes. The payload structure
 * varies by campaign configuration — we accept a wide set of known field names
 * and map them to our internal schema. All fields are optional since Ringba
 * allows custom payload templates.
 */
export const RingbaWebhookSchema = z.object({
  // Primary identifiers — try multiple common field names
  call_id: z.string().optional(),
  callId: z.string().optional(),
  call_uuid: z.string().optional(),
  inbound_call_id: z.string().optional(),
  id: z.string().optional(),

  // Timing
  call_date: z.string().optional(),
  call_start: z.string().optional(),
  start_time: z.string().optional(),
  callstart: z.string().optional(),

  // Duration
  duration: z.union([z.string(), z.number()]).optional(),
  call_duration: z.union([z.string(), z.number()]).optional(),
  duration_in_seconds: z.union([z.string(), z.number()]).optional(),
  billable_duration: z.union([z.string(), z.number()]).optional(),

  // Caller info
  caller_id: z.string().optional(),
  caller: z.string().optional(),
  ani: z.string().optional(),
  from: z.string().optional(),
  inbound_phone_number: z.string().optional(),

  // Target / destination
  dialed_number: z.string().optional(),
  target_number: z.string().optional(),
  dnis: z.string().optional(),
  to: z.string().optional(),

  // Campaign
  campaign_name: z.string().optional(),
  campaign: z.string().optional(),

  // Buyer
  buyer_name: z.string().optional(),
  buyer: z.string().optional(),
  target_name: z.string().optional(),

  // Publisher
  publisher_name: z.string().optional(),
  publisher: z.string().optional(),
  affiliate_name: z.string().optional(),

  // Revenue / payout
  revenue: z.union([z.string(), z.number()]).optional(),
  payout: z.union([z.string(), z.number()]).optional(),
  sale_amount: z.union([z.string(), z.number()]).optional(),
  commission: z.union([z.string(), z.number()]).optional(),

  // Recording
  recording_url: z.string().url().optional(),
  call_recording: z.string().url().optional(),
  recording: z.string().url().optional(),
}).passthrough() // accept any extra fields without failing

export type RingbaWebhook = z.infer<typeof RingbaWebhookSchema>

export function parseRingbaPayload(raw: unknown): {
  ringba_call_id: string
  parsed: RingbaWebhook
  call_started_at: string | null
  duration_seconds: number | null
  caller_id: string | null
  target_number: string | null
  campaign_name: string | null
  buyer_name: string | null
  publisher_name: string | null
  revenue: number | null
  payout: number | null
  recording_url_original: string | null
} {
  const parsed = RingbaWebhookSchema.parse(raw)

  const ringba_call_id =
    parsed.call_id ??
    parsed.callId ??
    parsed.call_uuid ??
    parsed.inbound_call_id ??
    parsed.id ??
    (() => { throw new Error('No call ID found in Ringba payload') })()

  const rawDuration = parsed.duration ?? parsed.call_duration ?? parsed.duration_in_seconds ?? parsed.billable_duration
  const duration_seconds = rawDuration != null ? Math.round(Number(rawDuration)) : null

  const rawStarted = parsed.call_date ?? parsed.call_start ?? parsed.start_time ?? parsed.callstart
  const call_started_at = rawStarted ? new Date(rawStarted).toISOString() : null

  const rawRevenue = parsed.revenue ?? parsed.sale_amount
  const rawPayout = parsed.payout ?? parsed.commission

  return {
    ringba_call_id,
    parsed,
    call_started_at,
    duration_seconds: isNaN(duration_seconds ?? NaN) ? null : duration_seconds,
    caller_id: parsed.caller_id ?? parsed.caller ?? parsed.ani ?? parsed.from ?? parsed.inbound_phone_number ?? null,
    target_number: parsed.dialed_number ?? parsed.target_number ?? parsed.dnis ?? parsed.to ?? null,
    campaign_name: parsed.campaign_name ?? parsed.campaign ?? null,
    buyer_name: parsed.buyer_name ?? parsed.buyer ?? parsed.target_name ?? null,
    publisher_name: parsed.publisher_name ?? parsed.publisher ?? parsed.affiliate_name ?? null,
    revenue: rawRevenue != null && !isNaN(Number(rawRevenue)) ? Number(rawRevenue) : null,
    payout: rawPayout != null && !isNaN(Number(rawPayout)) ? Number(rawPayout) : null,
    recording_url_original: parsed.recording_url ?? parsed.call_recording ?? parsed.recording ?? null,
  }
}

/**
 * Verify Ringba webhook signature if a secret is configured.
 * Returns true if no secret is set (signature verification is optional).
 * Ringba does not publicly document a standard signature scheme —
 * this implementation tries HMAC-SHA256 over the raw body.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null
): boolean {
  if (!secret) return true // verification not configured
  if (!signatureHeader) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex')

  const headerValue = signatureHeader.replace(/^sha256=/, '')
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(headerValue, 'hex')
  )
}
