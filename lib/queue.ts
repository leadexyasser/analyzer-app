import { many, query } from '@/lib/db'
import type { JobType } from '@/types/database'

const BACKOFF_MINUTES = [1, 5, 30]

export async function enqueueJob(callId: string, jobType: JobType): Promise<void> {
  await query(
    `INSERT INTO processing_jobs (call_id, job_type, status, attempts, scheduled_for)
     VALUES ($1, $2, 'queued', 0, now())`,
    [callId, jobType]
  )
}

type JoinedJob = {
  id: string
  call_id: string
  job_type: JobType
  status: string
  attempts: number
  last_error: string | null
  scheduled_for: Date
  created_at: Date
  // Nested call row (from row_to_json). Matches supabase's `select('*, calls(*)')` shape.
  calls: Record<string, unknown> | null
}

export async function dequeueJobs(limit = 3): Promise<JoinedJob[]> {
  // Reset stuck 'running' jobs older than 3 min. processing_jobs has no updated_at column,
  // so scheduled_for (which markJobRunning refreshes) serves as the last-touched marker.
  await query(
    `UPDATE processing_jobs SET status = 'queued', scheduled_for = now()
     WHERE status = 'running' AND scheduled_for < now() - interval '3 minutes'`
  )

  // Cap analyze at 1 per invocation — 3 parallel gpt-4o hit Tier 1 30k TPM and wedge the queue.
  const nonAnalyze = await many<JoinedJob>(
    `SELECT j.id, j.call_id, j.job_type, j.status, j.attempts, j.last_error,
            j.scheduled_for, j.created_at,
            row_to_json(c.*) AS calls
     FROM processing_jobs j
     LEFT JOIN calls c ON c.id = j.call_id
     WHERE j.status = 'queued'
       AND j.scheduled_for <= now()
       AND j.job_type <> 'analyze'
     ORDER BY j.scheduled_for ASC
     LIMIT $1`,
    [limit]
  )

  const remaining = limit - nonAnalyze.length
  const analyze = remaining > 0
    ? await many<JoinedJob>(
        `SELECT j.id, j.call_id, j.job_type, j.status, j.attempts, j.last_error,
                j.scheduled_for, j.created_at,
                row_to_json(c.*) AS calls
         FROM processing_jobs j
         LEFT JOIN calls c ON c.id = j.call_id
         WHERE j.status = 'queued'
           AND j.scheduled_for <= now()
           AND j.job_type = 'analyze'
         ORDER BY j.scheduled_for ASC
         LIMIT 1`
      )
    : []

  return [...nonAnalyze, ...analyze]
}

export async function markJobRunning(jobId: string): Promise<void> {
  await query(
    `UPDATE processing_jobs SET status = 'running', scheduled_for = now() WHERE id = $1`,
    [jobId]
  )
}

export async function markJobDone(jobId: string): Promise<void> {
  await query(`UPDATE processing_jobs SET status = 'done' WHERE id = $1`, [jobId])
}

export async function markJobFailed(
  jobId: string,
  error: string,
  attempts: number,
  isRateLimit = false
): Promise<void> {
  if (isRateLimit) {
    // 90s > 60s TPM window — the limit clears before the next attempt. Don't count as attempt.
    await query(
      `UPDATE processing_jobs
       SET status = 'queued', scheduled_for = now() + interval '90 seconds', last_error = $2
       WHERE id = $1`,
      [jobId, error]
    )
    return
  }

  const newAttempts = attempts + 1
  const backoffIndex = Math.min(newAttempts - 1, BACKOFF_MINUTES.length - 1)
  const backoffMinutes = BACKOFF_MINUTES[backoffIndex]

  if (newAttempts >= 3) {
    await query(
      `UPDATE processing_jobs SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`,
      [jobId, newAttempts, error]
    )
  } else {
    await query(
      `UPDATE processing_jobs
       SET status = 'queued', attempts = $2, last_error = $3,
           scheduled_for = now() + ($4::int * interval '1 minute')
       WHERE id = $1`,
      [jobId, newAttempts, error, backoffMinutes]
    )
  }
}
