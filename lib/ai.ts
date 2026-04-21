import OpenAI from 'openai'
import Groq from 'groq-sdk'
import { createServiceClient } from '@/lib/supabase/server'
import { AnalysisSchema } from '@/types/analysis'

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// Groq Whisper: ultra-fast transcription (~10x faster than OpenAI)
const WHISPER_MODEL = 'whisper-large-v3-turbo'
// OpenAI gpt-4o: best accuracy for nuanced call analysis
const LLM_MODEL = 'gpt-4o'

async function logApiCall(params: {
  call_id: string | null
  service: 'groq_whisper' | 'openai_llm'
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

export class RateLimitError extends Error {
  constructor() {
    super('OpenAI rate limit exceeded (429)')
    this.name = 'RateLimitError'
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

    if (status === 429) throw new RateLimitError()
    throw err
  }
}

/**
 * Pseudo-speaker diarization via pause detection.
 * Whisper has no native diarization — we detect speaker turns
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

const ANALYSIS_PROMPT_TEMPLATE = `You are an expert call quality analyst for a FINAL EXPENSE life insurance business. All calls are INBOUND — callers dialed in after seeing an advertisement. Your job is to extract accurate call quality metrics and compliance signals. Be precise: only flag something if you have clear evidence in the transcript.

CORE RULES:
1. Output ONLY valid JSON. No markdown, no code fences, no text before or after.
2. Every field is required. Use null or empty array if unknown — never omit a field.
3. Speakers labeled "Speaker A" / "Speaker B" via pause detection (imperfect). Infer agent vs caller from context — the agent asks qualifying questions, follows a script, uses insurance terminology.
4. Base every field ONLY on what is explicitly said. Do not infer or assume.
5. When in doubt about a compliance flag — do NOT trigger it. Only flag with clear, direct evidence.

CALL METADATA:
- Campaign: {campaign_name}
- Buyer/Target: {buyer_name}
- Duration: {duration_seconds} seconds
- Revenue: ${'{revenue}'}

TRANSCRIPT:
{transcript_text}

--- FIELD DEFINITIONS (read carefully before filling) ---

CALL OUTCOME — "sale_closed" requires ALL of: (a) agent collected payment method details (bank account/routing number, credit card number, or premium payment confirmed), AND (b) caller gave explicit verbal consent to enroll, AND (c) agent confirmed enrollment/approval. "transferred" = agent transferred to another line/closer. "qualified_no_transfer" = caller qualifies but wasn't transferred. Do not guess — use "unclear" if unsure.

OUTBOUND_CALL_CLAIMED — TRUE only if the caller explicitly states that OUR company or agent called THEM first (e.g., "you called me", "someone from your company called me", "I got a call from you guys and I'm calling back"). FALSE for ALL of these (common false positives): "I was just on the phone", "it popped up on my phone", "I saw it on my phone", "I called in", "I'm calling about the ad", "I was on another call". The question is: did the caller accuse US of making an outbound call to them? Only flag if YES.

FREE_GOVERNMENT_MENTIONS — TRUE only if the ad, agent, or caller described the life insurance product as "free", "government-sponsored", "government program", "federally funded", or similar misleading framing. TRUE examples: "the ad said it was a free government benefit", "they said it's a government program". FALSE examples: agent mentions "government-issued ID", caller mentions "I'm on government assistance/SSI/disability" (those are income facts, not misleading claims about the product).

MISLEADING_AD_MENTION — TRUE only if the caller explicitly says the advertisement misrepresented what was being offered. TRUE examples: "the ad said I'd get $50,000 for free", "it said no medical exam but now you're asking questions", "the ad said something different from what you're telling me". FALSE: caller being confused about insurance in general.

SALE_CLOSED vs QUALIFIED_NO_TRANSFER — sale_closed = payment collected + enrollment confirmed. qualified_no_transfer = caller qualified but call ended without completing a sale or transfer.

PAYMENT_INFO_COLLECTED — TRUE only if bank routing number, account number, or credit card details were actually collected/read on the call.

---

Return this exact JSON structure:

{
  "summary": "<2-3 sentences: who called, what they wanted, what happened, outcome>",
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
    "is_genuine_inquiry": <true if caller genuinely wanted life insurance>,
    "intent_signals": ["<direct quotes showing genuine interest>"],
    "red_flags": ["<phrases suggesting misled caller, wrong product, bot, or fraud>"],
    "misalignment_reason": "<one sentence if intent doesn't match offer, otherwise null>"
  },
  "extracted_data": {
    "caller_stated_name": "<string or null>",
    "caller_location_state": "<2-letter state code or null>",
    "intent_or_need": "<what the caller said they were looking for, or null>",
    "objections_raised": ["<verbatim or close paraphrase of objections>"],
    "commitments_made": ["<what caller agreed to>"],
    "payment_info_collected": <boolean — true ONLY if routing/account/card digits collected>,
    "callback_requested": <boolean>
  },
  "flags": ["<flag>"],
  "flag_details": { "<flag>": "<one sentence with evidence from transcript>" },
  "coaching_notes": "<1-2 sentences of specific, actionable coaching for the agent, or null>",
  "final_expense": {
    "age_mentioned": <number if caller stated their age, otherwise null>,
    "age_verdict": "<good if 40-80 | borderline if 81-85 | bad if 86+ | unknown if not mentioned>",
    "interested_in_life_insurance": "<yes | no | unclear — based on direct answer, not assumption>",
    "insurance_interest_notes": "<exact quote, or null>",
    "has_bank_account": "<yes | no | unclear — only yes if caller explicitly confirmed bank/credit union/credit card>",
    "can_afford": "<yes | concerns | no | unclear — concerns only if caller mentioned fixed income, tight budget, or payment hesitation>",
    "affordability_notes": "<exact quote about money/affordability, or null>",
    "free_government_mentions": <boolean — see definition above, do NOT flag income assistance mentions>,
    "free_government_quotes": ["<exact quotes — only populate if free_government_mentions is true>"],
    "outbound_call_claimed": <boolean — see definition above, very high bar, do NOT flag 'it popped up' or 'I was on the phone'>,
    "outbound_call_quote": "<exact quote — only populate if outbound_call_claimed is true, otherwise null>",
    "ftc_regulatory_mention": <boolean — true only if FTC, BBB, attorney general, or filing a complaint mentioned>,
    "ftc_quote": "<exact quote, or null>",
    "scam_keywords_mentioned": <boolean — true only if words like scam, fraud, fake, rip-off, con, deceived, tricked explicitly used>,
    "scam_quotes": ["<exact quotes — only populate if scam_keywords_mentioned is true>"],
    "misleading_ad_mention": <boolean — see definition above, caller must explicitly say the ad misrepresented the offer>,
    "misleading_quotes": ["<exact quotes — only populate if misleading_ad_mention is true>"],
    "qualifier_score": <0-100. Start at 100. Deduct: age 86+ (-20), age unknown (-10), age 81-85 (-5), no insurance interest (-15), no bank account (-15), affordability concerns (-10), cannot afford (-20), free/govt mention (-30), outbound call claimed (-25), FTC/regulatory mention (-40), scam keywords (-35), misleading ad mention (-30). Minimum 0.>,
    "qualifier_verdict": "<qualified if score>=70 and no compliance flags | borderline if score 40-69 and no compliance flags | compliance_risk if ANY compliance flag (free_government_mentions OR outbound_call_claimed OR ftc_regulatory_mention OR scam_keywords_mentioned OR misleading_ad_mention) is true | disqualified if score<40>",
    "qualifier_summary": "<1-2 sentences: lead quality verdict + single most important finding>"
  }
}

Valid flags: agent_unprofessional, agent_script_deviation, caller_confused, caller_hostile, compliance_concern, dead_air_excessive, premature_hangup, language_mismatch, audio_quality_poor, insufficient_audio, duplicate_caller_suspected

Scoring rules:
- quality_score: professionalism 30%, engagement 20%, qualification completeness 30%, outcome clarity 20%
- compliance_concern flag MUST be added whenever any compliance boolean is true; also lower quality_score significantly
- lead_intent.score: 100 = caller explicitly wanted life insurance; 0 = completely wrong product, bot, or fraud
- Short call (<5 exchanges or <60 seconds): quality_score ≤20, call_outcome "hung_up_early" or "unclear", flags must include "insufficient_audio", all final_expense qualification fields = "unclear"/null/false/[]

Return the JSON now.`

// gpt-4o-mini has 128k context. Cap transcript at ~60k chars (~15k tokens)
// to leave room for prompt + response, with generous headroom.
const MAX_TRANSCRIPT_CHARS = 60_000

export async function analyzeCall(params: {
  callId: string
  transcript_text: string
  campaign_name: string | null
  buyer_name: string | null
  duration_seconds: number | null
  revenue: number | null
}) {
  const rawTranscript = params.transcript_text || '(no transcript)'
  const transcript = rawTranscript.length > MAX_TRANSCRIPT_CHARS
    ? rawTranscript.slice(0, MAX_TRANSCRIPT_CHARS) + '\n\n[transcript truncated — call too long]'
    : rawTranscript

  const prompt = ANALYSIS_PROMPT_TEMPLATE
    .replace('{campaign_name}', params.campaign_name ?? 'Unknown')
    .replace('{buyer_name}', params.buyer_name ?? 'Unknown')
    .replace('{duration_seconds}', String(params.duration_seconds ?? 0))
    .replace('{revenue}', String(params.revenue ?? 0))
    .replace('{transcript_text}', transcript)

  const start = Date.now()

  const callLlm = async (messages: OpenAI.Chat.ChatCompletionMessageParam[]) => {
    return openai.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages,
    })
  }

  let rawResponse = ''
  try {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt },
    ]

    const completion = await callLlm(messages)
    rawResponse = completion.choices[0]?.message?.content ?? ''
    const tokensUsed = completion.usage?.total_tokens ?? null
    const duration = Date.now() - start

    await logApiCall({
      call_id: params.callId,
      service: 'openai_llm',
      duration_ms: duration,
      status_code: 200,
      tokens_used: tokensUsed,
    })

    const parsed = JSON.parse(rawResponse)
    return AnalysisSchema.parse(parsed)
  } catch (err: any) {
    const status = err?.status ?? err?.statusCode ?? 500
    if (status === 429) {
      await logApiCall({ call_id: params.callId, service: 'openai_llm', duration_ms: Date.now() - start, status_code: 429, error: 'rate_limit' })
      throw new RateLimitError()
    }

    // Schema parse failure — retry once with a stricter prompt
    if (err?.name === 'ZodError' || err instanceof SyntaxError) {
      try {
        const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
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
          service: 'openai_llm',
          duration_ms: retryDuration,
          status_code: 200,
          tokens_used: retryCompletion.usage?.total_tokens ?? null,
        })

        return AnalysisSchema.parse(JSON.parse(retryRaw))
      } catch (retryErr: any) {
        const retryStatus = retryErr?.status ?? 500
        await logApiCall({ call_id: params.callId, service: 'openai_llm', duration_ms: Date.now() - start, status_code: retryStatus, error: retryErr?.message })
        throw new Error(`Analysis parse failed after retry: ${retryErr?.message}\nRaw: ${rawResponse}`)
      }
    }

    await logApiCall({ call_id: params.callId, service: 'openai_llm', duration_ms: Date.now() - start, status_code: status, error: err?.message })
    throw err
  }
}
