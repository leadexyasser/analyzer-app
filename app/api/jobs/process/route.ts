import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { dequeueJobs, markJobRunning, markJobDone, markJobFailed, enqueueJob } from '@/lib/queue'
import { downloadAudio } from '@/lib/audio'
import { uploadRecording } from '@/lib/storage'
import { transcribeAudio, analyzeCall, RateLimitError } from '@/lib/ai'

export const runtime = 'nodejs'
// 90s: transcribe job may poll AssemblyAI for ~50s on long calls; analyze adds another 5-15s
export const maxDuration = 90

const BATCH_SIZE = 3

async function runWorker() {
  const jobs = await dequeueJobs(BATCH_SIZE)
  if (jobs.length === 0) {
    return { ok: true, processed: 0, message: 'No jobs queued' }
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
        await supabase.from('calls').update({ status: 'pending' }).eq('id', job.call_id)
      } else if ((job.attempts + 1) >= 3) {
        await supabase
          .from('calls')
          .update({ status: 'failed', error_message: errMsg })
          .eq('id', job.call_id)
      }
      return { job_id: job.id, status: isRateLimit ? 'rate_limited' : 'failed', error: errMsg }
    }
  }))

  // Chain a follow-up invocation whenever we did real work. Since the queue caps
  // analyze at 1 per invocation (Tier 1 OpenAI TPM constraint), a "full batch" can
  // legitimately be just 1 analyze job. Chaining after any work drains bursts in
  // seconds without waiting for the cron tick; idle invocations (jobs.length === 0)
  // exit early above and never chain, so the loop stops naturally.
  if (jobs.length >= 1) {
    after(async () => {
      const host =
        process.env.NEXT_PUBLIC_APP_URL ??
        (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : null)
      if (!host || !process.env.CRON_SECRET) return
      try {
        await fetch(`${host}/api/jobs/process`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, 'Content-Type': 'application/json' },
        })
      } catch {}
    })
  }

  return { ok: true, processed: jobs.length, results }
}

function isAuthorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

// Vercel Cron triggers via GET (with auto-injected Authorization: Bearer ${CRON_SECRET}).
// Internal chain-calls and manual triggers use POST. Both paths share the same handler.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runWorker())
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runWorker())
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
  const storagePath = await uploadRecording(call.id, buffer, filename)

  await supabase
    .from('calls')
    .update({
      recording_storage_path: storagePath,
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

  // Read recording from Supabase. List files in case an older call stored multiple chunks
  // — we concat them in order so AssemblyAI sees one continuous stream.
  const { data: files, error: listErr } = await supabase.storage
    .from('recordings')
    .list(`calls/${call.id}`)
  if (listErr) throw new Error(`Storage list failed: ${listErr.message}`)
  if (!files || files.length === 0) throw new Error('No recording files found in storage')

  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name))
  const buffers: Buffer[] = []
  for (const file of sortedFiles) {
    const { data: fileData } = await supabase.storage
      .from('recordings')
      .download(`calls/${call.id}/${file.name}`)
    if (!fileData) continue
    const arrayBuffer = await fileData.arrayBuffer()
    buffers.push(Buffer.from(arrayBuffer))
  }
  const combined = Buffer.concat(buffers)
  const filename = sortedFiles[0].name

  const result = await transcribeAudio(combined, filename, call.id)

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
