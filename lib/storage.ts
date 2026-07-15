import { many, query } from '@/lib/db'

function config(): { baseUrl: string; token: string } {
  const baseUrl = process.env.STORAGE_URL
  const token = process.env.STORAGE_TOKEN
  if (!baseUrl) throw new Error('STORAGE_URL is not set')
  if (!token) throw new Error('STORAGE_TOKEN is not set')
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token }
}

function url(key: string): string {
  const { baseUrl } = config()
  const clean = key.replace(/^\/+/, '')
  return `${baseUrl}/storage/${clean}`
}

function bearer(): Record<string, string> {
  return { Authorization: `Bearer ${config().token}` }
}

export async function uploadRecording(
  callId: string,
  buffer: Buffer,
  filename: string
): Promise<string> {
  const storagePath = `calls/${callId}/${filename}`
  const res = await fetch(url(storagePath), {
    method: 'PUT',
    headers: { ...bearer(), 'content-type': 'audio/mpeg' },
    body: new Uint8Array(buffer),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Storage upload failed: ${res.status} ${body}`)
  }
  return storagePath
}

export async function downloadRecording(storagePath: string): Promise<Buffer> {
  const res = await fetch(url(storagePath), { headers: bearer() })
  if (!res.ok) throw new Error(`Storage download failed: ${res.status}`)
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

export async function recordingExists(storagePath: string): Promise<boolean> {
  const res = await fetch(url(storagePath), { method: 'HEAD', headers: bearer() })
  return res.ok
}

export async function deleteRecording(storagePath: string): Promise<void> {
  const res = await fetch(url(storagePath), { method: 'DELETE', headers: bearer() })
  if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed: ${res.status}`)
}

/** Proxy a range/full response from the storage server. Used by /api/audio for browser playback. */
export async function streamRecording(storagePath: string, range?: string | null): Promise<Response> {
  const headers: Record<string, string> = bearer()
  if (range) headers['range'] = range
  const res = await fetch(url(storagePath), { headers })
  const passthrough = new Headers()
  const wanted = ['content-type', 'content-length', 'content-range', 'accept-ranges']
  for (const h of wanted) {
    const v = res.headers.get(h)
    if (v) passthrough.set(h, v)
  }
  passthrough.set('cache-control', 'private, max-age=3600')
  return new Response(res.body, { status: res.status, headers: passthrough })
}

/** Delete storage files for calls older than retentionDays and NULL their DB paths. */
export async function deleteOldRecordings(retentionDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const rows = await many<{ id: string; recording_storage_path: string }>(
    `SELECT id, recording_storage_path FROM calls
     WHERE recording_storage_path IS NOT NULL AND received_at < $1::timestamptz`,
    [cutoff]
  )
  if (rows.length === 0) return 0

  let deleted = 0
  for (const row of rows) {
    try {
      await deleteRecording(row.recording_storage_path)
      deleted++
    } catch {
      // Best-effort — DB null-out below still records our intent.
    }
  }

  await query(
    `UPDATE calls SET recording_storage_path = NULL WHERE id = ANY($1::uuid[])`,
    [rows.map(r => r.id)]
  )
  return deleted
}
