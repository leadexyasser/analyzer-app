import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import { spawn } from 'child_process'
// @ts-ignore — ffmpeg-static returns the binary path
import ffmpegPath from 'ffmpeg-static'

const MAX_CHUNK_BYTES = 24 * 1024 * 1024 // 24MB — stays safely under Groq's 25MB limit

export async function downloadAudio(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading audio from ${url}`)
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Split an audio buffer into chunks under MAX_CHUNK_BYTES using ffmpeg.
 * Returns an array of Buffers, each safe to send to Groq Whisper.
 * If the buffer is already small enough, returns it as a single-element array.
 */
export async function splitAudioIfNeeded(
  buffer: Buffer,
  originalFilename: string
): Promise<Array<{ buffer: Buffer; filename: string }>> {
  if (buffer.byteLength <= MAX_CHUNK_BYTES) {
    return [{ buffer, filename: originalFilename }]
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ringba-audio-'))
  const ext = path.extname(originalFilename) || '.mp3'
  const inputPath = path.join(tmpDir, `input${ext}`)

  try {
    await fs.writeFile(inputPath, buffer)

    // Get duration via ffprobe-like approach using ffmpeg
    const durationSec = await getAudioDuration(inputPath)
    const numChunks = Math.ceil(buffer.byteLength / MAX_CHUNK_BYTES)
    const chunkDuration = Math.ceil(durationSec / numChunks)

    const chunkPaths: string[] = []
    for (let i = 0; i < numChunks; i++) {
      const startSec = i * chunkDuration
      const chunkPath = path.join(tmpDir, `chunk_${i}${ext}`)
      await runFfmpeg([
        '-i', inputPath,
        '-ss', String(startSec),
        '-t', String(chunkDuration),
        '-acodec', 'copy',
        '-y',
        chunkPath,
      ])
      chunkPaths.push(chunkPath)
    }

    const chunks = await Promise.all(
      chunkPaths.map(async (p, i) => ({
        buffer: await fs.readFile(p),
        filename: `${path.basename(originalFilename, ext)}_chunk${i}${ext}`,
      }))
    )

    return chunks
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

function getFfmpegBin(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static not found')
  return ffmpegPath as string
}

function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegBin(), ['-i', filePath, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s+(\d+):(\d+):([\d.]+)/)
      if (!match) return reject(new Error('Could not parse audio duration'))
      const [, h, m, s] = match
      resolve(Number(h) * 3600 + Number(m) * 60 + Number(s))
    })
    proc.on('error', reject)
  })
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegBin(), args, { stdio: 'ignore' })
    proc.on('close', (code: number | null) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}
