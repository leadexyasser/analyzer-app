import { query } from '@/lib/db'
import { dequeueJobs, markJobRunning, markJobDone, markJobFailed, enqueueJob } from '@/lib/queue'
import { downloadAudio } from '@/lib/audio'
import { uploadRecording, downloadRecording } from '@/lib/storage'
import { transcribeAudio, analyzeCall, RateLimitError } from '@/lib/ai'
import { notifyClose } from '@/lib/telegram'
import { resolveClosingBuyer } from '@/lib/closing-buyer'

const BATCH_SIZE = 3

// Drains the queue in-process until the queue empties or we hit the deadline.
// No HTTP self-chaining — every trigger point (cron, webhook, retry-stuck, reanalyze) calls
// this directly via `after()`, so chain reliability doesn't depend on the network or env URLs.
export async function runWorker(opts: { deadlineMs?: number } = {}): Promise<{ ok: true; processed: number; iterations: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 270_000)
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
  caller_id: string | null
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

  // Short pre-speech hang-ups (caller drops before saying anything) — AssemblyAI succeeds
  // with an empty transcript. Analyze would trap in a retry loop ("No transcript for analysis"),
  // so we short-circuit here: mark complete with a synthetic insufficient_audio record so the
  // call still counts toward hang-up metrics (which is real signal for landing/ring quality).
  const hasSpeech = (result.transcript_text ?? '').trim().length > 0
  if (!hasSpeech) {
    const synthetic = buildInsufficientAudioAnalysis(result.audio_duration ?? call.duration_seconds ?? 0)
    await query(
      `UPDATE calls
       SET transcript = $2::jsonb,
           transcript_text = $3,
           analysis = $4::jsonb,
           quality_score = $5,
           flags = $6::text[],
           status = 'complete',
           error_message = NULL
       WHERE id = $1`,
      [call.id, JSON.stringify(transcript), result.transcript_text ?? '', JSON.stringify(synthetic), synthetic.quality_score, synthetic.flags]
    )
    return
  }

  await query(
    `UPDATE calls
     SET transcript = $2::jsonb, transcript_text = $3, status = 'pending'
     WHERE id = $1`,
    [call.id, JSON.stringify(transcript), result.transcript_text]
  )

  await enqueueJob(call.id, 'analyze')
}

function buildInsufficientAudioAnalysis(audioSeconds: number) {
  const durationLabel = audioSeconds > 0 ? `${Math.round(audioSeconds)}s of audio` : 'no audio'
  return {
    summary: `Caller hung up before speaking (${durationLabel}). No transcribable content — treated as a pre-speech drop-off.`,
    language: 'other' as const,
    quality_score: 5,
    quality_breakdown: {
      agent_professionalism: 0,
      caller_engagement: 0,
      qualification_completeness: 0,
      call_outcome_clarity: 5,
    },
    call_outcome: 'hung_up_early' as const,
    outcome_confidence: 'high' as const,
    lead_intent: {
      score: 0,
      verdict: 'invalid' as const,
      is_genuine_inquiry: false,
      intent_signals: [],
      red_flags: [],
      misalignment_reason: 'Caller hung up before any speech was captured',
    },
    extracted_data: {
      caller_stated_name: null,
      caller_location_state: null,
      intent_or_need: null,
      objections_raised: [],
      commitments_made: [],
      payment_info_collected: false,
      callback_requested: false,
    },
    flags: ['insufficient_audio', 'premature_hangup'],
    flag_details: {
      insufficient_audio: 'AssemblyAI returned zero utterances for the recording.',
      premature_hangup: 'Call ended before caller spoke.',
    },
    coaching_notes: null,
    final_expense: {
      age_mentioned: null,
      age_verdict: 'unknown' as const,
      interested_in_life_insurance: 'unclear' as const,
      insurance_interest_notes: null,
      has_bank_account: 'unclear' as const,
      can_afford: 'unclear' as const,
      affordability_notes: null,
      free_government_mentions: false,
      free_government_quotes: [],
      outbound_call_claimed: false,
      outbound_call_quote: null,
      ftc_regulatory_mention: false,
      ftc_quote: null,
      scam_keywords_mentioned: false,
      scam_quotes: [],
      misleading_ad_mention: false,
      misleading_quotes: [],
      qualifier_score: 0,
      qualifier_verdict: 'disqualified' as const,
      qualifier_summary: 'Caller hung up before speaking; no qualification signal available.',
    },
  }
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

  // Fire Telegram close notification (one-time). We flip metadata.telegram_notified_at
  // atomically inside the same UPDATE that guards against re-notification — this way the
  // check-and-set is race-free even if two workers process the same close concurrently.
  if (analysis.call_outcome === 'sale_closed') {
    const claim = await query<{ id: string }>(
      `UPDATE calls
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('telegram_notified_at', now()::text)
       WHERE id = $1
         AND (metadata->>'telegram_notified_at') IS NULL
       RETURNING id`,
      [call.id]
    )
    if ((claim.rowCount ?? 0) > 0) {
      // Count today's closes (America/New_York calendar day) so the notification shows "#N today".
      const countRes = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM calls
         WHERE analysis->>'call_outcome' = 'sale_closed'
           AND (call_started_at AT TIME ZONE 'America/New_York')::date
             = ((SELECT call_started_at FROM calls WHERE id = $1) AT TIME ZONE 'America/New_York')::date`,
        [call.id]
      )
      const todayCloseNumber = countRes.rows[0]?.count ? Number(countRes.rows[0].count) : null

      const fe = (analysis as Record<string, unknown>).final_expense as Record<string, unknown> | undefined
      const evidence = fe?.enrollment_evidence as Record<string, unknown> | undefined

      await notifyClose({
        id: call.id,
        caller_id: call.caller_id ?? null,
        duration_seconds: call.duration_seconds,
        advisor_name: (evidence?.licensed_advisor_name as string) ?? null,
        policy_number: (evidence?.policy_number as string) ?? null,
        premium_amount: (evidence?.premium_amount as string) ?? null,
        coverage_amount: (evidence?.coverage_amount as string) ?? null,
        billing_date: (evidence?.billing_date as string) ?? null,
        close_confidence: (evidence?.close_confidence as string) ?? null,
        todayCloseNumber,
        campaignLabel: call.campaign_name ?? call.buyer_name ?? null,
        closingBuyer: resolveClosingBuyer(call.buyer_name, call.transcript_text),
      })
    }
  }
}
