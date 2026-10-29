import { describe, it, expect } from 'vitest'
import { resolveClosingBuyer } from '@/lib/closing-buyer'

describe('resolveClosingBuyer', () => {
  it('returns I.S.M when the Ringba buyer is Insurance Supermarket', () => {
    const r = resolveClosingBuyer('Insurance Supermarket Inc (559)', '')
    expect(r).toEqual({ code: 'I.S.M', name: 'Insurance Supermarket', via: null })
  })

  it('titles RingbaX calls as RINGBAX even when Insurance Supermarket closed them', () => {
    const r = resolveClosingBuyer('RingbaX (392)', 'AGENT: le habla Wendy de Insurance Supermarket')
    expect(r).toEqual({ code: 'RINGBAX', name: 'Insurance Supermarket', via: 'RingbaX' })
  })

  it('treats the EMC National carrier as Insurance Supermarket', () => {
    const r = resolveClosingBuyer('RingbaX (392)', 'AGENT: autorización para EMC National Life')
    expect(r.name).toBe('Insurance Supermarket')
  })

  it('names other closers behind RingbaX in the buyer line', () => {
    const r = resolveClosingBuyer('RingbaX (392)', 'AGENT: Security National Life, mi nombre es')
    expect(r).toEqual({ code: 'RINGBAX', name: 'Security National', via: 'RingbaX' })
  })

  it('titles RingbaX calls as RINGBAX when no closer is named', () => {
    const r = resolveClosingBuyer('RingbaX (392)', 'AGENT: hola')
    expect(r).toEqual({ code: 'RINGBAX', name: 'RingbaX', via: null })
  })

  it('detects a known closer on a non-marketplace buyer from the transcript', () => {
    const r = resolveClosingBuyer('', 'AGENT: American Amicable')
    expect(r).toEqual({ code: 'AM.AMIC', name: 'American Amicable', via: null })
  })

  it('falls back to the cleaned Ringba buyer name when no closer is named', () => {
    const r = resolveClosingBuyer('(ADV) WCMD (380)', 'AGENT: hola, ¿cómo está?')
    expect(r).toEqual({ code: 'WCMD', name: 'WCMD', via: null })
  })

  it('returns UNKNOWN when nothing identifies the buyer', () => {
    const r = resolveClosingBuyer(null, null)
    expect(r).toEqual({ code: 'UNKNOWN', name: 'Unknown buyer', via: null })
  })
})
