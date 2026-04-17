import Groq from 'groq-sdk'
import { createServiceClient } from '@/lib/supabase/server'
import { AnalysisSchema } from '@/types/analysis'

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const WHISPER_MODEL = 'whisper-large-v3-turbo'
const LLM_MODEL = 'llama-3.3-70b-versatile'

async function logApiCall(params: {
  call_id: string | null
  service: 'groq_whisper' | 'groq_llm'
  duration_ms: number
  status_code: number
  tokens_used?: number | null
  error?: string | null
}) {
  try {
    const supabase = createServiceClient()
    await supabase.from('api_logs').insert({
      call_id: params.call_id,
      service: params.service,
      request_duration_ms: params.duration_ms,
      status_code: params.status_code,
      tokens_used: params.tokens_used ?? null,
      error: params.error ?? null,
    })
  } catch {
    // Non-critical — don't let logging failure break the pipeline
  }
}

export class GroqRateLimitError extends Error {
  constructor() {
    super('Groq rate limit exceeded (429)')
    this.name = 'GroqRateLimitError'
  }
}

export async function transcribeAudio(
  fileBuffer: Buffer,
  filename: string,
  callId: string | null = null
): Promise<{
  text: string
  segments: Array<{ start: number; end: number; text: string }>
}> {
  const start = Date.now()

  try {
    const file = new File([fileBuffer.buffer as ArrayBuffer], filename, { type: 'audio/mpeg' })
    const response = await groq.audio.transcriptions.create({
      file,
      model: WHISPER_MODEL,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    })

    const duration = Date.now() - start
    await logApiCall({ call_id: callId, service: 'groq_whisper', duration_ms: duration, status_code: 200 })

    const segments = (response as any).segments ?? []
    return { text: (response as any).text ?? '', segments }
  } catch (err: any) {
    const duration = Date.now() - start
    const status = err?.status ?? err?.statusCode ?? 500

    await logApiCall({
      call_id: callId,
      service: 'groq_whisper',
      duration_ms: duration,
      status_code: status,
      error: err?.message,
    })

    if (status === 429) throw new GroqRateLimitError()
    throw err
  }
}

/**
 * Pseudo-speaker diarization via pause detection.
 * Groq Whisper has no native diarization — we detect speaker turns
 * by treating gaps >1.5s between segments as a speaker change.
 * This is imperfect: overlapping speech, interruptions, and very
 * short segments may be mis-attributed. The LLM analysis prompt
 * explicitly notes this limitation.
 */
export function buildSpeakerLabeledTranscript(
  segments: Array<{ start: number; end: number; text: string }>
): string {
  if (segments.length === 0) return ''

  const PAUSE_THRESHOLD_SEC = 1.5
  let currentSpeaker = 'A'
  let lastEnd = segments[0].end
  const lines: string[] = []

  for (const seg of segments) {
    const gap = seg.start - lastEnd
    if (gap > PAUSE_THRESHOLD_SEC) {
      currentSpeaker = currentSpeaker === 'A' ? 'B' : 'A'
    }
    lines.push(`[${seg.start.toFixed(1)}s] Speaker ${currentSpeaker}: ${seg.text.trim()}`)
    lastEnd = seg.end
  }

  return lines.join('\n')
}

const ANALYSIS_PROMPT_TEMPLATE = `You analyze recorded phone calls between a call center agent and an inbound caller from paid advertising campaigns. Return a single JSON object evaluating the call.

IMPORTANT RULES:
1. Output ONLY valid JSON. No markdown, no code fences, no text before or after.
2. Every field in the schema is required. If unknown, use null or empty array, never omit.
3. Note: speakers are labeled "Speaker A" / "Speaker B" based on pause detection, which is imperfect. Infer which is the agent from context (agents introduce themselves, ask qualifying questions, follow scripts).

CALL METADATA:
- Campaign: {campaign_name}
- Buyer: {buyer_name}
- Duration: {duration_seconds} seconds
- Revenue: ${'{revenue}'}

TRANSCRIPT:
{transcript_text}

Return a JSON object with this exact structure:

{
  "summary": "<2-3 sentences describing what happened>",
  "language": "<one of: en, es, mixed, other>",
  "agent_speaker": "<one of: Speaker A, Speaker B, unclear>",
  "quality_score": <integer 0-100>,
  "quality_breakdown": {
    "agent_professionalism": <integer 0-10>,
    "caller_engagement": <integer 0-10>,
    "qualification_completeness": <integer 0-10>,
    "call_outcome_clarity": <integer 0-10>
  },
  "call_outcome": "<one of: transferred, qualified_no_transfer, not_qualified, hung_up_early, voicemail, wrong_number, callback_scheduled, sale_closed, unclear>",
  "outcome_confidence": "<one of: high, medium, low>",
  "extracted_data": {
    "caller_stated_name": "<string or null>",
    "caller_location_state": "<string or null>",
    "intent_or_need": "<string or null>",
    "objections_raised": ["<string>", ...],
    "commitments_made": ["<string>", ...],
    "payment_info_collected": <boolean>,
    "callback_requested": <boolean>
  },
  "flags": ["<snake_case_flag>", ...],
  "flag_details": { "<flag_name>": "<one sentence explanation>" },
  "coaching_notes": "<1-2 sentence suggestion for the agent, or null>"
}

Valid flag values (use only these):
- agent_unprofessional
- agent_script_deviation
- caller_confused
- caller_hostile
- compliance_concern
- dead_air_excessive
- premature_hangup
- language_mismatch
- audio_quality_poor
- insufficient_audio
- duplicate_caller_suspected

Scoring guidance:
- quality_score weights: professionalism 30%, engagement 20%, qualification 30%, outcome clarity 20%
- If transcript is empty or too short to analyze (<5 exchanges), return quality_score: 0, call_outcome: "unclear", flags: ["insufficient_audio"]
- Be strict on compliance flags — flag anything concerning for human review.

Return the JSON object now.`

export async function analyzeCall(params: {
  callId: string
  transcript_text: string
  campaign_name: string | null
  buyer_name: string | null
  duration_seconds: number | null
  revenue: number | null
}) {
  const prompt = ANALYSIS_PROMPT_TEMPLATE
    .replace('{campaign_name}', params.campaign_name ?? 'Unknown')
    .replace('{buyer_name}', params.buyer_name ?? 'Unknown')
    .replace('{duration_seconds}', String(params.duration_seconds ?? 0))
    .replace('{revenue}', String(params.revenue ?? 0))
    .replace('{transcript_text}', params.transcript_text || '(no transcript)')

  const start = Date.now()

  const callLlm = async (messages: Groq.Chat.ChatCompletionMessageParam[]) => {
    return groq.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages,
    })
  }

  let rawResponse = ''
  try {
    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt },
    ]

    const completion = await callLlm(messages)
    rawResponse = completion.choices[0]?.message?.content ?? ''
    const tokensUsed = completion.usage?.total_tokens ?? null
    const duration = Date.now() - start

    await logApiCall({
      call_id: params.callId,
      service: 'groq_llm',
      duration_ms: duration,
      status_code: 200,
      tokens_used: tokensUsed,
    })

    // First parse attempt
    const parsed = JSON.parse(rawResponse)
    return AnalysisSchema.parse(parsed)
  } catch (err: any) {
    const status = err?.status ?? err?.statusCode ?? 500
    if (status === 429) {
      await logApiCall({ call_id: params.callId, service: 'groq_llm', duration_ms: Date.now() - start, status_code: 429, error: 'rate_limit' })
      throw new GroqRateLimitError()
    }

    // Schema parse failure — retry once with a stricter prompt
    if (err?.name === 'ZodError' || err instanceof SyntaxError) {
      try {
        const retryMessages: Groq.Chat.ChatCompletionMessageParam[] = [
          { role: 'user', content: prompt },
          { role: 'assistant', content: rawResponse },
          {
            role: 'user',
            content:
              'Your previous response was not valid JSON matching the required schema. Return ONLY the JSON object, no other text.',
          },
        ]
        const retryStart = Date.now()
        const retryCompletion = await callLlm(retryMessages)
        const retryRaw = retryCompletion.choices[0]?.message?.content ?? ''
        const retryDuration = Date.now() - retryStart

        await logApiCall({
          call_id: params.callId,
          service: 'groq_llm',
          duration_ms: retryDuration,
          status_code: 200,
          tokens_used: retryCompletion.usage?.total_tokens ?? null,
        })

        return AnalysisSchema.parse(JSON.parse(retryRaw))
      } catch (retryErr: any) {
        const retryStatus = retryErr?.status ?? 500
        await logApiCall({ call_id: params.callId, service: 'groq_llm', duration_ms: Date.now() - start, status_code: retryStatus, error: retryErr?.message })
        throw new Error(`Analysis parse failed after retry: ${retryErr?.message}\nRaw: ${rawResponse}`)
      }
    }

    await logApiCall({ call_id: params.callId, service: 'groq_llm', duration_ms: Date.now() - start, status_code: status, error: err?.message })
    throw err
  }
}
