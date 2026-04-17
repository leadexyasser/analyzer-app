import { createServiceClient } from '@/lib/supabase/server'
import { JobType } from '@/types/database'

const BACKOFF_MINUTES = [1, 5, 30]

export async function enqueueJob(callId: string, jobType: JobType) {
  const supabase = createServiceClient()
  const { error } = await supabase.from('processing_jobs').insert({
    call_id: callId,
    job_type: jobType,
    status: 'queued',
    attempts: 0,
    scheduled_for: new Date().toISOString(),
  })
  if (error) throw new Error(`Failed to enqueue ${jobType} job: ${error.message}`)
}

export async function dequeueJobs(limit = 3) {
  const supabase = createServiceClient()
  const now = new Date().toISOString()
  // Jobs stuck in 'running' for >3 min timed out — reset them so they retry
  const staleThreshold = new Date(Date.now() - 3 * 60_000).toISOString()
  await supabase
    .from('processing_jobs')
    .update({ status: 'queued', scheduled_for: now })
    .eq('status', 'running')
    .lt('updated_at', staleThreshold)

  const { data, error } = await supabase
    .from('processing_jobs')
    .select('*, calls(*)')
    .eq('status', 'queued')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Failed to dequeue jobs: ${error.message}`)
  return data ?? []
}

export async function markJobRunning(jobId: string) {
  const supabase = createServiceClient()
  await supabase
    .from('processing_jobs')
    .update({ status: 'running' })
    .eq('id', jobId)
}

export async function markJobDone(jobId: string) {
  const supabase = createServiceClient()
  await supabase
    .from('processing_jobs')
    .update({ status: 'done' })
    .eq('id', jobId)
}

export async function markJobFailed(
  jobId: string,
  error: string,
  attempts: number,
  isRateLimit = false
) {
  const supabase = createServiceClient()

  if (isRateLimit) {
    // Rate limited — requeue for 1 min, don't count as a failed attempt
    const retryAt = new Date(Date.now() + 60_000).toISOString()
    await supabase
      .from('processing_jobs')
      .update({ status: 'queued', scheduled_for: retryAt, last_error: error })
      .eq('id', jobId)
    return
  }

  const newAttempts = attempts + 1
  const backoffIndex = Math.min(newAttempts - 1, BACKOFF_MINUTES.length - 1)
  const backoffMs = BACKOFF_MINUTES[backoffIndex] * 60_000
  const retryAt = new Date(Date.now() + backoffMs).toISOString()

  if (newAttempts >= 3) {
    await supabase
      .from('processing_jobs')
      .update({ status: 'failed', attempts: newAttempts, last_error: error })
      .eq('id', jobId)
  } else {
    await supabase
      .from('processing_jobs')
      .update({
        status: 'queued',
        attempts: newAttempts,
        last_error: error,
        scheduled_for: retryAt,
      })
      .eq('id', jobId)
  }
}
