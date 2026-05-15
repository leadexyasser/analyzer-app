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

  // Cap analyze jobs at 1 per invocation: parallel gpt-4o calls trip OpenAI's TPM limit.
  // download/transcribe are cheap and can still parallelize.
  const { data: nonAnalyze, error: e1 } = await supabase
    .from('processing_jobs')
    .select('*, calls(*)')
    .eq('status', 'queued')
    .lte('scheduled_for', now)
    .neq('job_type', 'analyze')
    .order('scheduled_for', { ascending: true })
    .limit(limit)
  if (e1) throw new Error(`Failed to dequeue jobs: ${e1.message}`)

  const remaining = limit - (nonAnalyze?.length ?? 0)
  let analyze: any[] = []
  if (remaining > 0) {
    const { data, error: e2 } = await supabase
      .from('processing_jobs')
      .select('*, calls(*)')
      .eq('status', 'queued')
      .lte('scheduled_for', now)
      .eq('job_type', 'analyze')
      .order('scheduled_for', { ascending: true })
      .limit(1)
    if (e2) throw new Error(`Failed to dequeue analyze jobs: ${e2.message}`)
    analyze = data ?? []
  }

  return [...(nonAnalyze ?? []), ...analyze]
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
    // Rate limited — requeue for 90s, don't count as a failed attempt
    // 90s > 60s TPM window, ensuring the rate limit clears before next attempt
    const retryAt = new Date(Date.now() + 90_000).toISOString()
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
