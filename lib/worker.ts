import { createServiceClient } from '@/lib/supabase/server'
import { dequeueJobs, markJobRunning, markJobDone, markJobFailed, enqueueJob } from '@/lib/queue'
import { downloadAudio } from '@/lib/audio'
import { uploadRecording } from '@/lib/storage'
import { transcribeAudio, analyzeCall, RateLimitError } from '@/lib/ai'

const BATCH_SIZE = 3

// Drains the queue in-process until either the queue empties or we hit the deadline.
// No HTTP self-chaining — every trigger point (cron, webhook, retry-stuck, reanalyze) calls
// this directly via `after()`, so chain reliability doesn't depend on the network or env URLs.
export async function runWorker(opts: { deadlineMs?: number } = {}): Promise<{ ok: true; processed: number; iterations: number }> {
  // Default 75s leaves 15s headroom under the route's 90s maxDuration for the final response.
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
        await processJob(job)
        await markJobDone(job.id)
      } catch (err: any) {
        const isRateLimit = err instanceof RateLimitError
        const errMsg = err?.message ?? 'Unknown error'
        await markJobFailed(job.id, errMsg, job.attempts, isRateLimit)

        const supabase = createServiceClient()
        if (isRateLimit) {
          // Don't leave the call stuck mid-flight between retries
          await supabase.from('calls').update({ status: 'pending' }).eq('id', job.call_id)
        } else if ((job.attempts + 1) >= 3) {
          await supabase
            .from('calls')
            .update({ status: 'failed', error_message: errMsg })
            .eq('id', job.call_id)
        }
      }
    }))

    totalProcessed += jobs.length
  }

  return { ok: true, processed: totalProcessed, iterations }
}

async function processJob(job: any) {
  const supabase = createServiceClient()
  const call = job.calls
  if (!call) throw new Error(`Call not found for job ${job.id}`)

  switch (job.job_type) {
    case 'download':   await handleDownload(call, supabase);   break
    case 'transcribe': await handleTranscribe(call, supabase); break
    case 'analyze':    await handleAnalyze(call, supabase);    break
    default: throw new Error(`Unknown job type: ${job.job_type}`)
  }
}

async function handleDownload(call: any, supabase: any) {
  await supabase.from('calls').update({ status: 'downloading' }).eq('id', call.id)
  if (!call.recording_url_original) throw new Error('No recording URL on call')

  const buffer = await downloadAudio(call.recording_url_original)
  const filename = `recording_${call.ringba_call_id}.mp3`
  const storagePath = await uploadRecording(call.id, buffer, filename)

  await supabase
    .from('calls')
    .update({ recording_storage_path: storagePath, status: 'pending' })
    .eq('id', call.id)

  await enqueueJob(call.id, 'transcribe')
}

async function handleTranscribe(call: any, supabase: any) {
  await supabase.from('calls').update({ status: 'transcribing' }).eq('id', call.id)
  if (!call.recording_storage_path) throw new Error('No storage path for transcription')

  const { data: files, error: listErr } = await supabase.storage.from('recordings').list(`calls/${call.id}`)
  if (listErr) throw new Error(`Storage list failed: ${listErr.message}`)
  if (!files || files.length === 0) throw new Error('No recording files found in storage')

  // Concat any chunked storage from the legacy ffmpeg-split era so AssemblyAI sees one continuous file.
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name))
  const buffers: Buffer[] = []
  for (const file of sortedFiles) {
    const { data: fileData } = await supabase.storage.from('recordings').download(`calls/${call.id}/${file.name}`)
    if (!fileData) continue
    const arrayBuffer = await fileData.arrayBuffer()
    buffers.push(Buffer.from(arrayBuffer))
  }
  const combined = Buffer.concat(buffers)
  const result = await transcribeAudio(combined, sortedFiles[0].name, call.id)

  await supabase
    .from('calls')
    .update({
      transcript: {
        utterances: result.utterances,
        text: result.text,
        agent_channel: result.agent_channel,
        audio_duration: result.audio_duration,
        language_code: result.language_code,
      },
      transcript_text: result.transcript_text,
      status: 'pending',
    })
    .eq('id', call.id)

  await enqueueJob(call.id, 'analyze')
}

async function handleAnalyze(call: any, supabase: any) {
  await supabase.from('calls').update({ status: 'analyzing' }).eq('id', call.id)
  if (!call.transcript_text) throw new Error('No transcript for analysis')

  const analysis = await analyzeCall({
    callId: call.id,
    transcript_text: call.transcript_text,
    campaign_name: call.campaign_name,
    buyer_name: call.buyer_name,
    duration_seconds: call.duration_seconds,
    revenue: call.revenue,
  })

  await supabase
    .from('calls')
    .update({
      analysis,
      quality_score: analysis.quality_score,
      flags: analysis.flags,
      status: 'complete',
      error_message: null,
    })
    .eq('id', call.id)
}
