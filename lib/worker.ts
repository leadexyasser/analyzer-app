import { query } from '@/lib/db'
import { dequeueJobs, markJobRunning, markJobDone, markJobFailed, enqueueJob } from '@/lib/queue'
import { downloadAudio } from '@/lib/audio'
import { uploadRecording, downloadRecording } from '@/lib/storage'
import { transcribeAudio, analyzeCall, RateLimitError } from '@/lib/ai'

const BATCH_SIZE = 3

// Drains the queue in-process until the queue empties or we hit the deadline.
// No HTTP self-chaining — every trigger point (cron, webhook, retry-stuck, reanalyze) calls
// this directly via `after()`, so chain reliability doesn't depend on the network or env URLs.
export async function runWorker(opts: { deadlineMs?: number } = {}): Promise<{ ok: true; processed: number; iterations: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 75_000)
  let totalProcessed = 0
  let iterations = 0

  while (Date.now() < deadline) {
    const jobs = await dequeueJobs(BATCH_SIZE)
    if (jobs.length === 0) break
    iterations++

    await Promise.all(jobs.map(async (job) => {
      await markJobRunning(job.id)
      try {
        await processJob(job as unknown as JobRow)
        await markJobDone(job.id)
      } catch (err: unknown) {
        const isRateLimit = err instanceof RateLimitError
        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        await markJobFailed(job.id, errMsg, job.attempts, isRateLimit)

        if (isRateLimit) {
          await query(`UPDATE calls SET status = 'pending' WHERE id = $1`, [job.call_id])
        } else if ((job.attempts + 1) >= 3) {
          await query(
            `UPDATE calls SET status = 'failed', error_message = $2 WHERE id = $1`,
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
  ringba_call_id: string
  recording_url_original: string | null
  recording_storage_path: string | null
  transcript_text: string | null
  campaign_name: string | null
  buyer_name: string | null
  duration_seconds: number | null
  revenue: number | string | null
}

type JobRow = { id: string; call_id: string; job_type: string; attempts: number; calls: CallRow | null }

async function processJob(job: JobRow) {
  const call = job.calls
  if (!call) throw new Error(`Call not found for job ${job.id}`)

  switch (job.job_type) {
    case 'download':   await handleDownload(call);   break
    case 'transcribe': await handleTranscribe(call); break
    case 'analyze':    await handleAnalyze(call);    break
    default: throw new Error(`Unknown job type: ${job.job_type}`)
  }
}

async function handleDownload(call: CallRow) {
  await query(`UPDATE calls SET status = 'downloading' WHERE id = $1`, [call.id])
  if (!call.recording_url_original) throw new Error('No recording URL on call')

  const buffer = await downloadAudio(call.recording_url_original)
  const filename = `recording_${call.ringba_call_id}.mp3`
  const storagePath = await uploadRecording(call.id, buffer, filename)

  await query(
    `UPDATE calls SET recording_storage_path = $2, status = 'pending' WHERE id = $1`,
    [call.id, storagePath]
  )

  await enqueueJob(call.id, 'transcribe')
}

async function handleTranscribe(call: CallRow) {
  await query(`UPDATE calls SET status = 'transcribing' WHERE id = $1`, [call.id])
  if (!call.recording_storage_path) throw new Error('No storage path for transcription')

  // Droplet storage is a single file per call now — no legacy ffmpeg-split chunks to concat.
  const buffer = await downloadRecording(call.recording_storage_path)
  const filename = call.recording_storage_path.split('/').pop() ?? 'recording.mp3'
  const result = await transcribeAudio(buffer, filename, call.id)

  const transcript = {
    utterances: result.utterances,
    text: result.text,
    agent_channel: result.agent_channel,
    audio_duration: result.audio_duration,
    language_code: result.language_code,
  }

  await query(
    `UPDATE calls
     SET transcript = $2::jsonb, transcript_text = $3, status = 'pending'
     WHERE id = $1`,
    [call.id, JSON.stringify(transcript), result.transcript_text]
  )

  await enqueueJob(call.id, 'analyze')
}

async function handleAnalyze(call: CallRow) {
  await query(`UPDATE calls SET status = 'analyzing' WHERE id = $1`, [call.id])
  if (!call.transcript_text) throw new Error('No transcript for analysis')

  const analysis = await analyzeCall({
    callId: call.id,
    transcript_text: call.transcript_text,
    campaign_name: call.campaign_name,
    buyer_name: call.buyer_name,
    duration_seconds: call.duration_seconds,
    revenue: call.revenue == null ? null : Number(call.revenue),
  })

  await query(
    `UPDATE calls
     SET analysis = $2::jsonb,
         quality_score = $3,
         flags = $4::text[],
         status = 'complete',
         error_message = NULL
     WHERE id = $1`,
    [call.id, JSON.stringify(analysis), analysis.quality_score, analysis.flags]
  )
}
