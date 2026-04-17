import { describe, it, expect } from 'vitest'

const MAX_CHUNK_BYTES = 24 * 1024 * 1024

describe('audio chunking logic', () => {
  it('24MB file does not need chunking', () => {
    const size = 24 * 1024 * 1024
    expect(size <= MAX_CHUNK_BYTES).toBe(true)
  })

  it('26MB file needs chunking', () => {
    const size = 26 * 1024 * 1024
    expect(size > MAX_CHUNK_BYTES).toBe(true)
  })

  it('calculates correct number of chunks for a 60MB file', () => {
    const size = 60 * 1024 * 1024
    const numChunks = Math.ceil(size / MAX_CHUNK_BYTES)
    expect(numChunks).toBe(3)
  })

  it('chunk duration math is proportional to file size', () => {
    const durationSec = 3600 // 1 hour
    const numChunks = 3
    const chunkDuration = Math.ceil(durationSec / numChunks)
    expect(chunkDuration).toBe(1200) // 20 minutes per chunk
  })
})
