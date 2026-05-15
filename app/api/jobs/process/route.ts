import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { dequeueJobs, markJobRunning, markJobDone, markJobFailed, enqueueJob } from '@/lib/queue'
import { downloadAudio, splitAudioIfNeeded } from '@/lib/audio'
import { uploadRecording } from '@/lib/storage'
import { transcribeAudio, buildSpeakerLabeledTranscript, analyzeCall, RateLimitError } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobs = await dequeueJobs(3)
  if (jobs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No jobs queued' })
  }

  const results = await Promise.all(jobs.map(async (job) => {
    await markJobRunning(job.id)
    try {
      await processJob(job)
      await markJobDone(job.id)
      return { job_id: job.id, status: 'done' }
    } catch (err: any) {
      const isRateLimit = err instanceof RateLimitError
      const errMsg = err?.message ?? 'Unknown error'
      await markJobFailed(job.id, errMsg, job.attempts, isRateLimit)

      const supabase = createServiceClient()
      if (isRateLimit) {
        // Don't leave the call stuck on 'analyzing'/'transcribing' between retries —
        // drop it back to 'pending' so the dashboard reflects reality.
        await supabase
          .from('calls')
          .update({ status: 'pending' })
          .eq('id', job.call_id)
      } else if ((job.attempts + 1) >= 3) {
        await supabase
          .from('calls')
          .update({ status: 'failed', error_message: errMsg })
          .eq('id', job.call_id)
      }
      return { job_id: job.id, status: isRateLimit ? 'rate_limited' : 'failed', error: errMsg }
    }
  }))

  return NextResponse.json({ ok: true, processed: jobs.length, results })
}

async function processJob(job: any) {
  const supabase = createServiceClient()
  const call = job.calls

  if (!call) throw new Error(`Call not found for job ${job.id}`)

  switch (job.job_type) {
    case 'download':
      await handleDownload(call, supabase)
      break
    case 'transcribe':
      await handleTranscribe(call, supabase)
      break
    case 'analyze':
      await handleAnalyze(call, supabase)
      break
    default:
      throw new Error(`Unknown job type: ${job.job_type}`)
  }
}

async function handleDownload(call: any, supabase: any) {
  await supabase.from('calls').update({ status: 'downloading' }).eq('id', call.id)

  if (!call.recording_url_original) {
    throw new Error('No recording URL on call')
  }

  const buffer = await downloadAudio(call.recording_url_original)
  const filename = `recording_${call.ringba_call_id}.mp3`
  const chunks = await splitAudioIfNeeded(buffer, filename)

  // For chunked files, store the first chunk path — subsequent chunks handled during transcription
  const storagePath = await uploadRecording(call.id, chunks[0].buffer, chunks[0].filename)

  // If multiple chunks, store all additional chunks too
  const allPaths = [storagePath]
  for (let i = 1; i < chunks.length; i++) {
    const p = await uploadRecording(call.id, chunks[i].buffer, chunks[i].filename)
    allPaths.push(p)
  }

  await supabase
    .from('calls')
    .update({
      recording_storage_path: allPaths[0],
      status: 'pending',
    })
    .eq('id', call.id)

  await enqueueJob(call.id, 'transcribe')
}

async function handleTranscribe(call: any, supabase: any) {
  await supabase.from('calls').update({ status: 'transcribing' }).eq('id', call.id)

  if (!call.recording_storage_path) {
    throw new Error('No storage path for transcription')
  }

  // List all chunks in storage for this call
  const { data: files, error } = await supabase.storage
    .from('recordings')
    .list(`calls/${call.id}`)

  if (error) throw new Error(`Storage list failed: ${error.message}`)

  const { createServiceClient: makeClient } = await import('@/lib/supabase/server')
  const storageClient = makeClient()

  let allSegments: Array<{ start: number; end: number; text: string }> = []
  let fullText = ''
  let timeOffset = 0

  for (const file of (files ?? [])) {
    const { data: fileData } = await storageClient.storage
      .from('recordings')
      .download(`calls/${call.id}/${file.name}`)

    if (!fileData) continue

    const arrayBuffer = await fileData.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const result = await transcribeAudio(buffer, file.name, call.id)

    // Adjust segment timestamps for chunks
    const adjustedSegments = result.segments.map((seg) => ({
      start: seg.start + timeOffset,
      end: seg.end + timeOffset,
      text: seg.text,
    }))

    allSegments = [...allSegments, ...adjustedSegments]
    fullText += (fullText ? ' ' : '') + result.text

    // Advance offset by last segment end time
    if (result.segments.length > 0) {
      timeOffset = allSegments[allSegments.length - 1].end
    }
  }

  const transcript_text = buildSpeakerLabeledTranscript(allSegments)

  await supabase
    .from('calls')
    .update({
      transcript: { segments: allSegments, text: fullText },
      transcript_text,
      status: 'pending',
    })
    .eq('id', call.id)

  await enqueueJob(call.id, 'analyze')
}

async function handleAnalyze(call: any, supabase: any) {
  await supabase.from('calls').update({ status: 'analyzing' }).eq('id', call.id)

  if (!call.transcript_text) {
    throw new Error('No transcript for analysis')
  }

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
