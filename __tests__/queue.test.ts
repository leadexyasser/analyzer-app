import { describe, it, expect } from 'vitest'

// Test the backoff scheduling math in isolation (no DB)
const BACKOFF_MINUTES = [1, 5, 30]

function computeBackoff(attempts: number): number {
  const idx = Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)
  return BACKOFF_MINUTES[idx]
}

describe('backoff scheduling', () => {
  it('first failure retries after 1 minute', () => {
    expect(computeBackoff(1)).toBe(1)
  })

  it('second failure retries after 5 minutes', () => {
    expect(computeBackoff(2)).toBe(5)
  })

  it('third and beyond retries after 30 minutes', () => {
    expect(computeBackoff(3)).toBe(30)
    expect(computeBackoff(10)).toBe(30)
  })
})
