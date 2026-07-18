import { many, query } from '@/lib/db'
import type { DebtJobType } from '@/types/debt'

const BACKOFF_MINUTES = [1, 5, 30]

export async function enqueueDebtJob(callId: string, jobType: DebtJobType): Promise<void> {
  await query(
    `INSERT INTO debt_processing_jobs (call_id, job_type, status, attempts, scheduled_for)
     VALUES ($1, $2, 'queued', 0, now())`,
    [callId, jobType]
  )
}

export type DebtJoinedJob = {
  id: string
  call_id: string
  job_type: DebtJobType
  status: string
  attempts: number
  last_error: string | null
  scheduled_for: Date
  created_at: Date
  calls: Record<string, unknown> | null
}

export async function dequeueDebtJobs(limit = 3): Promise<DebtJoinedJob[]> {
  // Reset stuck 'running' jobs older than 3 min.
  await query(
    `UPDATE debt_processing_jobs SET status = 'queued', scheduled_for = now()
     WHERE status = 'running' AND scheduled_for < now() - interval '3 minutes'`
  )

  // Cap analyze at 1 per invocation to stay under OpenAI TPM.
  const nonAnalyze = await many<DebtJoinedJob>(
    `SELECT j.id, j.call_id, j.job_type, j.status, j.attempts, j.last_error,
            j.scheduled_for, j.created_at,
            row_to_json(c.*) AS calls
     FROM debt_processing_jobs j
     LEFT JOIN debt_calls c ON c.id = j.call_id
     WHERE j.status = 'queued'
       AND j.scheduled_for <= now()
       AND j.job_type <> 'analyze'
     ORDER BY j.scheduled_for ASC
     LIMIT $1`,
    [limit]
  )

  const remaining = limit - nonAnalyze.length
  const analyze = remaining > 0
    ? await many<DebtJoinedJob>(
        `SELECT j.id, j.call_id, j.job_type, j.status, j.attempts, j.last_error,
                j.scheduled_for, j.created_at,
                row_to_json(c.*) AS calls
         FROM debt_processing_jobs j
         LEFT JOIN debt_calls c ON c.id = j.call_id
         WHERE j.status = 'queued'
           AND j.scheduled_for <= now()
           AND j.job_type = 'analyze'
         ORDER BY j.scheduled_for ASC
         LIMIT 1`
      )
    : []

  return [...nonAnalyze, ...analyze]
}

export async function markDebtJobRunning(id: string): Promise<void> {
  await query(`UPDATE debt_processing_jobs SET status = 'running', scheduled_for = now() WHERE id = $1`, [id])
}

export async function markDebtJobDone(id: string): Promise<void> {
  await query(`UPDATE debt_processing_jobs SET status = 'done' WHERE id = $1`, [id])
}

export async function markDebtJobFailed(
  id: string,
  error: string,
  attempts: number,
  isRateLimit = false
): Promise<void> {
  if (isRateLimit) {
    await query(
      `UPDATE debt_processing_jobs
       SET status = 'queued', scheduled_for = now() + interval '90 seconds', last_error = $2
       WHERE id = $1`,
      [id, error]
    )
    return
  }

  const newAttempts = attempts + 1
  const backoffMinutes = BACKOFF_MINUTES[Math.min(newAttempts - 1, BACKOFF_MINUTES.length - 1)]

  if (newAttempts >= 3) {
    await query(
      `UPDATE debt_processing_jobs SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`,
      [id, newAttempts, error]
    )
  } else {
    await query(
      `UPDATE debt_processing_jobs
       SET status = 'queued', attempts = $2, last_error = $3,
           scheduled_for = now() + ($4::int * interval '1 minute')
       WHERE id = $1`,
      [id, newAttempts, error, backoffMinutes]
    )
  }
}
