import { describe, it, expect } from 'vitest'
import { parseRingbaPayload, verifySignature } from '../lib/ringba'
import crypto from 'crypto'

describe('parseRingbaPayload', () => {
  it('parses a standard Ringba payload', () => {
    const raw = {
      call_id: 'abc123',
      call_date: '2026-04-17T14:30:00Z',
      duration: '142',
      caller_id: '+15551234567',
      dialed_number: '+18005550100',
      campaign_name: 'Test Campaign',
      buyer_name: 'Test Buyer',
      revenue: '28.50',
      recording_url: 'https://example.com/recording.mp3',
    }

    const result = parseRingbaPayload(raw)
    expect(result.ringba_call_id).toBe('abc123')
    expect(result.duration_seconds).toBe(142)
    expect(result.caller_id).toBe('+15551234567')
    expect(result.campaign_name).toBe('Test Campaign')
    expect(result.revenue).toBe(28.5)
    expect(result.recording_url_original).toBe('https://example.com/recording.mp3')
  })

  it('handles alternate field names', () => {
    const raw = {
      callId: 'xyz789',
      call_start: '2026-04-17T10:00:00Z',
      call_duration: 300,
      ani: '+15559876543',
      dnis: '+18009990000',
      campaign: 'Alt Campaign',
      target_name: 'Alt Buyer',
      sale_amount: '50.00',
      call_recording: 'https://example.com/rec2.mp3',
    }

    const result = parseRingbaPayload(raw)
    expect(result.ringba_call_id).toBe('xyz789')
    expect(result.duration_seconds).toBe(300)
    expect(result.caller_id).toBe('+15559876543')
    expect(result.revenue).toBe(50)
  })

  it('throws if no call ID found', () => {
    expect(() => parseRingbaPayload({ duration: 120 })).toThrow('No call ID found')
  })

  it('handles missing optional fields gracefully', () => {
    const result = parseRingbaPayload({ call_id: 'min001' })
    expect(result.ringba_call_id).toBe('min001')
    expect(result.duration_seconds).toBeNull()
    expect(result.revenue).toBeNull()
    expect(result.recording_url_original).toBeNull()
  })
})

describe('verifySignature', () => {
  it('returns true if no secret configured', () => {
    expect(verifySignature('body', null, null)).toBe(true)
    expect(verifySignature('body', 'sig', null)).toBe(true)
  })

  it('returns false if secret set but no header', () => {
    expect(verifySignature('body', null, 'mysecret')).toBe(false)
  })

  it('validates a correct HMAC-SHA256 signature', () => {
    const secret = 'test-secret'
    const body = '{"call_id":"abc"}'
    const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifySignature(body, sig, secret)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const secret = 'test-secret'
    const body = '{"call_id":"abc"}'
    const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifySignature('{"call_id":"tampered"}', sig, secret)).toBe(false)
  })
})
