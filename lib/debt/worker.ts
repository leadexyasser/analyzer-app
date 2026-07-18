import { query } from '@/lib/db'
import { dequeueDebtJobs, markDebtJobRunning, markDebtJobDone, markDebtJobFailed, enqueueDebtJob } from '@/lib/debt/queue'
import { downloadAudio } from '@/lib/audio'
import { uploadRecording, downloadRecording } from '@/lib/storage'
import { transcribeSpanishAudio, analyzeDebtCall, RateLimitError } from '@/lib/debt/ai'

const BATCH_SIZE = 3

export async function runDebtWorker(opts: { deadlineMs?: number } = {}): Promise<{ ok: true; processed: number; iterations: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 75_000)
  let totalProcessed = 0
  let iterations = 0

  while (Date.now() < deadline) {
    const jobs = await dequeueDebtJobs(BATCH_SIZE)
    if (jobs.length === 0) break
    iterations++

    await Promise.all(jobs.map(async (job) => {
      await markDebtJobRunning(job.id)
      try {
        await processJob(job as unknown as JobRow)
        await markDebtJobDone(job.id)
      } catch (err: unknown) {
        const isRateLimit = err instanceof RateLimitError
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        await markDebtJobFailed(job.id, errMsg, job.attempts, isRateLimit)

        if (isRateLimit) {
          await query(`UPDATE debt_calls SET status = 'pending' WHERE id = $1`, [job.call_id])
        } else if ((job.attempts + 1) >= 3) {
          await query(
            `UPDATE debt_calls SET status = 'failed', error_message = $2 WHERE id = $1`,
            [job.call_id, errMsg]
          )
        }
      }
    }))
    totalProcessed += jobs.length
  }

  return { ok: true, processed: totalProcessed, iterations }
}

type CallRow = {
  id: string
  recording_url_original: string | null
  recording_storage_path: string | null
  transcript_text: string | null
  campaign: string | null
  duration_seconds: number | null
  connected_length_seconds: number | null
}

type JobRow = { id: string; call_id: string; job_type: string; attempts: number; calls: CallRow | null }

async function processJob(job: JobRow): Promise<void> {
  const call = job.calls
  if (!call) throw new Error(`Debt call not found for job ${job.id}`)
  switch (job.job_type) {
    case 'download':   await handleDownload(call); break
    case 'transcribe': await handleTranscribe(call); break
    case 'analyze':    await handleAnalyze(call); break
    default: throw new Error(`Unknown job type: ${job.job_type}`)
  }
}

async function handleDownload(call: CallRow): Promise<void> {
  await query(`UPDATE debt_calls SET status = 'downloading' WHERE id = $1`, [call.id])
  if (!call.recording_url_original) throw new Error('No recording URL on debt call')

  const buffer = await downloadAudio(call.recording_url_original)
  // Namespace debt files under debt/ so FE and debt never collide in storage.
  const filename = `recording.mp3`
  const storagePath = await uploadRecording(`debt/${call.id}`, buffer, filename)

  await query(
    `UPDATE debt_calls SET recording_storage_path = $2, status = 'pending' WHERE id = $1`,
    [call.id, storagePath]
  )
  await enqueueDebtJob(call.id, 'transcribe')
}

async function handleTranscribe(call: CallRow): Promise<void> {
  await query(`UPDATE debt_calls SET status = 'transcribing' WHERE id = $1`, [call.id])
  if (!call.recording_storage_path) throw new Error('No storage path for transcription')

  const buffer = await downloadRecording(call.recording_storage_path)
  const filename = call.recording_storage_path.split('/').pop() ?? 'recording.mp3'
  const result = await transcribeSpanishAudio(buffer, filename, call.id)

  const transcript = {
    utterances: result.utterances,
    text: result.text,
    agent_channel: result.agent_channel,
    audio_duration: result.audio_duration,
    language_code: result.language_code,
  }

  await query(
    `UPDATE debt_calls
     SET transcript = $2::jsonb, transcript_text = $3, status = 'pending'
     WHERE id = $1`,
    [call.id, JSON.stringify(transcript), result.transcript_text]
  )
  await enqueueDebtJob(call.id, 'analyze')
}

async function handleAnalyze(call: CallRow): Promise<void> {
  await query(`UPDATE debt_calls SET status = 'analyzing' WHERE id = $1`, [call.id])
  if (!call.transcript_text) throw new Error('No transcript for analysis')

  const analysis = await analyzeDebtCall({
    callId: call.id,
    transcript_text: call.transcript_text,
    campaign: call.campaign,
    duration_seconds: call.duration_seconds,
    connected_length_seconds: call.connected_length_seconds,
  })

  await query(
    `UPDATE debt_calls
     SET analysis = $2::jsonb,
         quality_score = $3,
         compliance_score = $4,
         flags = $5::text[],
         status = 'complete',
         error_message = NULL
     WHERE id = $1`,
    [call.id, JSON.stringify(analysis), analysis.quality_score, analysis.compliance_score, analysis.flags]
  )
}
