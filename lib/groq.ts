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

const ANALYSIS_PROMPT_TEMPLATE = `You analyze recorded inbound phone calls for a FINAL EXPENSE life insurance business. Callers respond to ads and are screened by agents. You must extract both general call quality AND final-expense-specific qualification data. Return a single JSON object.

IMPORTANT RULES:
1. Output ONLY valid JSON. No markdown, no code fences, no text before or after.
2. Every field is required. Use null or empty array if unknown — never omit a field.
3. Speakers are labeled "Speaker A" / "Speaker B" via pause detection (imperfect). Infer which is the agent from context.
4. For final_expense fields, extract information ONLY from what is explicitly said in the transcript — do not assume.

CALL METADATA:
- Campaign: {campaign_name}
- Buyer/Target: {buyer_name}
- Duration: {duration_seconds} seconds
- Revenue: ${'{revenue}'}

TRANSCRIPT:
{transcript_text}

Return this exact JSON structure:

{
  "summary": "<2-3 sentences: what happened, caller need, outcome>",
  "language": "<en | es | mixed | other>",
  "agent_speaker": "<Speaker A | Speaker B | unclear>",
  "quality_score": <0-100>,
  "quality_breakdown": {
    "agent_professionalism": <0-10>,
    "caller_engagement": <0-10>,
    "qualification_completeness": <0-10>,
    "call_outcome_clarity": <0-10>
  },
  "call_outcome": "<transferred | qualified_no_transfer | not_qualified | hung_up_early | voicemail | wrong_number | callback_scheduled | sale_closed | unclear>",
  "outcome_confidence": "<high | medium | low>",
  "lead_intent": {
    "score": <0-100, how well caller intent matches the campaign offer>,
    "verdict": "<qualified | borderline | unqualified | invalid>",
    "is_genuine_inquiry": <true if caller genuinely wanted the product/service>,
    "intent_signals": ["<direct quotes or phrases showing genuine interest>"],
    "red_flags": ["<phrases suggesting misled caller, wrong product, bot, or fraud>"],
    "misalignment_reason": "<one sentence explaining why intent doesn't match, or null if it does match>"
  },
  "extracted_data": {
    "caller_stated_name": "<string or null>",
    "caller_location_state": "<string or null>",
    "intent_or_need": "<string or null>",
    "objections_raised": ["<string>"],
    "commitments_made": ["<string>"],
    "payment_info_collected": <boolean>,
    "callback_requested": <boolean>
  },
  "flags": ["<flag>"],
  "flag_details": { "<flag>": "<one sentence>" },
  "coaching_notes": "<1-2 sentence agent coaching tip, or null>",
  "final_expense": {
    "age_mentioned": <exact age the caller stated as a number, or null if never mentioned>,
    "age_verdict": "<good if 40-80 | borderline if 81-85 | bad if 86+ | unknown if not mentioned>",
    "interested_in_life_insurance": "<yes | no | unclear — based on their direct answer when asked>",
    "insurance_interest_notes": "<exact quote of what they said about interest, or null>",
    "has_bank_account": "<yes | no | unclear — did they confirm having a bank account, credit union, or credit card>",
    "can_afford": "<yes | concerns | no | unclear — yes if they confirmed ability to pay; concerns if they mentioned fixed income, tight budget, or hesitation; no if they explicitly said they cannot afford it>",
    "affordability_notes": "<exact quote about affordability/income concerns, or null>",
    "free_government_mentions": <true if anyone on the call mentioned 'free', 'government', 'government program', 'free benefits', 'government benefits', or similar>,
    "free_government_quotes": ["<exact quotes where free or government was mentioned>"],
    "outbound_call_claimed": <true if the caller said they were called, called back, or received an outbound call — we are INBOUND ONLY so this is a compliance red flag>,
    "outbound_call_quote": "<exact quote where caller claimed they were called, or null>",
    "ftc_regulatory_mention": <true if anyone mentioned FTC, filing a complaint, reporting to a regulatory body, BBB, attorney general, or similar>,
    "ftc_quote": "<exact quote, or null>",
    "scam_keywords_mentioned": <true if anyone used words like scam, fraud, fake, rip off, con, deceived, tricked, lied>,
    "scam_quotes": ["<exact quotes containing scam-related words>"],
    "misleading_ad_mention": <true if the caller mentioned the ad was misleading, false advertising, the ad said something different, or they were misled by the advertisement>,
    "misleading_quotes": ["<exact quotes about misleading ads>"],
    "qualifier_score": <0-100. Start at 100. Deduct: age 86+ (-20), age unknown (-10), age 81-85 (-5), no insurance interest (-15), no bank account (-15), affordability concerns (-10), cannot afford (-20), free/govt mention (-30), outbound call claimed (-25), FTC/regulatory mention (-40), scam keywords (-35), misleading ad mention (-30). Minimum 0.>,
    "qualifier_verdict": "<qualified if score>=70 and no compliance flags | borderline if score 40-69 and no compliance flags | compliance_risk if ANY of free_government_mentions OR outbound_call_claimed OR ftc_regulatory_mention OR scam_keywords_mentioned OR misleading_ad_mention is true | disqualified if score<40>",
    "qualifier_summary": "<1-2 sentences summarizing qualification status and the most important finding>"
  }
}

Valid flags: agent_unprofessional, agent_script_deviation, caller_confused, caller_hostile, compliance_concern, dead_air_excessive, premature_hangup, language_mismatch, audio_quality_poor, insufficient_audio, duplicate_caller_suspected

Scoring:
- quality_score: professionalism 30%, engagement 20%, qualification 30%, outcome clarity 20%
- Any compliance flag (free/govt, outbound claim, FTC, scam, misleading ad) should also trigger the "compliance_concern" flag and significantly lower quality_score
- lead_intent.score: 100 = caller clearly wanted exactly what was advertised; 0 = completely wrong product, bot, or fraud
- If transcript too short (<5 exchanges): quality_score 0, call_outcome "unclear", flags ["insufficient_audio"], lead_intent.verdict "invalid", all final_expense fields set to unknown/null/false/[]

Return the JSON now.`

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
