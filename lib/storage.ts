import { createServiceClient } from '@/lib/supabase/server'

const BUCKET = 'recordings'
const SIGNED_URL_TTL_SECONDS = 3600 // 1 hour

export async function uploadRecording(
  callId: string,
  buffer: Buffer,
  filename: string
): Promise<string> {
  const supabase = createServiceClient()
  const storagePath = `calls/${callId}/${filename}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'audio/mpeg',
      upsert: true,
    })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  return storagePath
}

export async function getSignedUrl(storagePath: string): Promise<string> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

  if (error || !data?.signedUrl) throw new Error(`Failed to create signed URL: ${error?.message}`)
  return data.signedUrl
}

/** Delete all recordings older than retentionDays from storage (not from DB). */
export async function deleteOldRecordings(retentionDays = 30): Promise<number> {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

  // Get old storage paths from the calls table
  const { data: oldCalls, error } = await supabase
    .from('calls')
    .select('id, recording_storage_path')
    .not('recording_storage_path', 'is', null)
    .lt('received_at', cutoff)

  if (error) throw new Error(`Failed to fetch old calls: ${error.message}`)
  if (!oldCalls?.length) return 0

  const paths = oldCalls
    .map((c: { recording_storage_path: string | null }) => c.recording_storage_path!)
    .filter(Boolean)

  if (paths.length === 0) return 0

  const { error: deleteError } = await supabase.storage
    .from(BUCKET)
    .remove(paths)

  if (deleteError) throw new Error(`Storage delete failed: ${deleteError.message}`)

  // Null out the storage paths so we know they're gone
  await supabase
    .from('calls')
    .update({ recording_storage_path: null })
    .in('id', oldCalls.map((c: { id: string }) => c.id))

  return paths.length
}
