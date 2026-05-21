import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/server'
import { AnalysisSchema } from '@/types/analysis'

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const LLM_MODEL = 'gpt-4o'
const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2'
const TRANSCRIPTION_MODEL = 'universal-3-pro'
const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 16 // ~48s, well under 60s Vercel limit

export class RateLimitError extends Error {
  constructor() {
    super('OpenAI rate limit exceeded (429)')
    this.name = 'RateLimitError'
  }
}

async function logApiCall(params: {
  call_id: string | null
  service: 'assemblyai' | 'openai_llm' | 'groq_whisper'
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
    // Non-critical
  }
}

export type Utterance = {
  channel: '1' | '2'
  start: number   // ms
  end: number     // ms
  text: string
  confidence?: number
}

export type TranscriptionResult = {
  text: string
  utterances: Utterance[]
  agent_channel: '1' | '2'
  transcript_text: string         // AGENT/CALLER labeled, sorted by time
  audio_duration: number | null   // seconds
  language_code: string | null
}

export async function transcribeAudio(
  fileBuffer: Buffer,
  filename: string,
  callId: string | null = null
): Promise<TranscriptionResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set')

  const start = Date.now()

  // 1. Upload audio bytes to AssemblyAI (returns a private CDN URL)
  const uploadRes = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
    body: fileBuffer as any,
  })
  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: uploadRes.status, error: `upload: ${errText.slice(0, 200)}` })
    throw new Error(`AssemblyAI upload failed: ${uploadRes.status} ${errText.slice(0, 200)}`)
  }
  const { upload_url } = await uploadRes.json()

  // 2. Submit transcription with dual_channel (Ringba sends stereo: L=caller, R=agent)
  const submitRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      dual_channel: true,
      speech_models: [TRANSCRIPTION_MODEL],
      punctuate: true,
      format_text: true,
      disfluencies: false,
    }),
  })
  if (!submitRes.ok) {
    const errText = await submitRes.text()
    await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: submitRes.status, error: `submit: ${errText.slice(0, 200)}` })
    throw new Error(`AssemblyAI submit failed: ${submitRes.status} ${errText.slice(0, 200)}`)
  }
  const submission = await submitRes.json()
  const transcriptId = submission.id

  // 3. Poll until complete
  let result: any = null
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const pollRes = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
      headers: { authorization: apiKey },
    })
    if (!pollRes.ok) throw new Error(`AssemblyAI poll failed: ${pollRes.status}`)
    const p = await pollRes.json()
    if (p.status === 'completed') { result = p; break }
    if (p.status === 'error') {
      await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: 500, error: `transcription error: ${p.error}` })
      throw new Error(`AssemblyAI transcription error: ${p.error}`)
    }
  }
  if (!result) {
    const elapsed = POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS / 1000
    await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: 504, error: `timeout after ${elapsed}s, transcript_id=${transcriptId}` })
    throw new Error(`AssemblyAI timeout after ${elapsed}s — transcript_id=${transcriptId} may still finish; retry will pick it up`)
  }

  const utterances: Utterance[] = (result.utterances ?? []).map((u: any) => ({
    channel: String(u.channel) as '1' | '2',
    start: u.start,
    end: u.end,
    text: u.text,
    confidence: u.confidence,
  }))

  // 4. Identify which channel is the AGENT.
  // For inbound Ringba calls, the agent always speaks first (the greeting).
  // Tie-breaker: channel with more total spoken time = AGENT (script is longer than caller answers).
  const agent_channel = identifyAgentChannel(utterances)

  // 5. Build human-readable transcript with AGENT/CALLER labels
  const transcript_text = buildChannelLabeledTranscript(utterances, agent_channel)

  await logApiCall({
    call_id: callId,
    service: 'assemblyai',
    duration_ms: Date.now() - start,
    status_code: 200,
  })

  return {
    text: result.text ?? '',
    utterances,
    agent_channel,
    transcript_text,
    audio_duration: result.audio_duration ?? null,
    language_code: result.language_code ?? null,
  }
}

function identifyAgentChannel(utterances: Utterance[]): '1' | '2' {
  if (utterances.length === 0) return '2' // arbitrary default; transcript is empty anyway

  // Primary signal: whoever speaks first is the agent (inbound calls — agent answers)
  const sorted = [...utterances].sort((a, b) => a.start - b.start)
  const firstSpeaker = sorted[0].channel

  // Sanity check via total talk time. If the "first speaker" actually talks 3x LESS than the other,
  // something's off (e.g. caller said "hello?" before agent picked up audio) — fall back to talk-time.
  const talkTime: Record<string, number> = { '1': 0, '2': 0 }
  for (const u of utterances) talkTime[u.channel] += (u.end - u.start)

  const other = firstSpeaker === '1' ? '2' : '1'
  if (talkTime[firstSpeaker] * 3 < talkTime[other]) {
    return other as '1' | '2'
  }
  return firstSpeaker
}

function buildChannelLabeledTranscript(utterances: Utterance[], agent_channel: '1' | '2'): string {
  const sorted = [...utterances].sort((a, b) => a.start - b.start)
  return sorted
    .map(u => {
      const role = u.channel === agent_channel ? 'AGENT' : 'CALLER'
      const sec = (u.start / 1000).toFixed(1)
      return `[${sec}s] ${role}: ${u.text.trim()}`
    })
    .join('\n')
}

const ANALYSIS_PROMPT_TEMPLATE = `You are an expert call quality analyst for a FINAL EXPENSE life insurance business. All calls are INBOUND — callers dialed in after seeing an advertisement.

CRITICAL: The transcript below uses CHANNEL-SEPARATED speaker labels. AGENT and CALLER are determined from the stereo recording's left/right channels, not guessed from context. Trust the labels — they are FACT, not inference.

CORE RULES:
1. Output ONLY valid JSON. No markdown, no code fences, no text before or after.
2. Every field is required. Use null or empty array if unknown — never omit a field.
3. Base every field ONLY on what is explicitly said. Do not infer or assume.
4. When in doubt about a compliance flag — do NOT trigger it. Only flag with clear, direct evidence.
5. The speaker who said something matters: a compliance issue spoken by the AGENT is far more severe than the CALLER mentioning the same words in a question or complaint.

CALL METADATA:
- Campaign: {campaign_name}
- Buyer/Target: {buyer_name}
- Duration: {duration_seconds} seconds
- Revenue: \${revenue}

TRANSCRIPT (each line prefixed with [time] AGENT: or [time] CALLER:):
{transcript_text}

--- FIELD DEFINITIONS — READ BEFORE FILLING ---

CALL OUTCOME — "sale_closed" requires ALL three:
  (a) AGENT collected payment method details (bank routing/account, card number, premium payment) — verified by digits read on the call;
  (b) CALLER gave explicit verbal consent to enroll;
  (c) AGENT confirmed enrollment/approval.
"transferred" = AGENT transferred caller to another line/closer. "qualified_no_transfer" = caller qualifies but wasn't transferred. Use "unclear" if unsure — never guess sale_closed.

OUTBOUND_CALL_CLAIMED — TRUE only if the CALLER explicitly claims OUR side called THEM first.
  TRUE: "you called me", "someone from your company called me", "I got a call from you guys and I'm calling back".
  FALSE (common false positives): "I was just on the phone", "it popped up on my phone", "I saw it on my phone", "I called in", "I'm calling about the ad", "I was on another call".
  Anything said by the AGENT does NOT trigger this flag. The flag is exclusively about CALLER accusations of an outbound call from us.

FREE_GOVERNMENT_MENTIONS — TRUE only if the AGENT, or the CALLER quoting the ad, described the product as "free", "government-sponsored", "government program", "federally funded", or similar.
  TRUE: AGENT says "this is a government program", CALLER says "the ad said it was a free government benefit".
  FALSE: CALLER mentions being on SSI / disability / government assistance (those are income facts about the caller, not misleading claims about the product); AGENT mentions "government-issued ID" (verification step).

MISLEADING_AD_MENTION — TRUE only if the CALLER explicitly says the advertisement misrepresented what was offered.
  TRUE: CALLER says "the ad said I'd get \$50,000 for free", "it said no medical exam but you're asking questions", "the ad said something different from what you're telling me".
  FALSE: CALLER generally confused about insurance; AGENT clarifying ad copy.

FTC_REGULATORY_MENTION — TRUE only if FTC, BBB, attorney general, lawyer, or "filing a complaint" mentioned by EITHER side.

SCAM_KEYWORDS_MENTIONED — TRUE only if the CALLER directly ACCUSES this specific operation, agent, or company of being a scam, fraud, or deception. The bar is HIGH — the caller must be calling US or THIS call a scam.
  TRUE examples: "This is a scam.", "You're scamming me.", "I think this company is fraud.", "You guys are running a con.", "I've been deceived by your ad."
  FALSE (DO NOT trigger — these are normal protective behaviors, not compliance issues):
    - General wariness about sharing personal info: "I don't give my social out, too many scams", "I'm afraid of fraud", "How do I know this isn't a scam?", "I'm worried about identity theft."
    - Asking for legitimacy verification: "Are you real?", "Is this legitimate?", "Can I trust this?", "How do I know you're not fake?"
    - Mentioning unrelated past scams: "I got scammed last year by another company", "There's so much fraud these days."
    - Hesitation about giving bank/SSN info due to general scam fears.
  A caller saying "scam" or "fraud" while expressing hesitation, fear, or caution is NOT a compliance flag — it's normal protective behavior when sharing sensitive information. The flag is reserved for callers who clearly state THIS operation is a scam. AGENT mentions of "scam" (e.g. reassuring "this isn't a scam") never trigger.

PAYMENT_INFO_COLLECTED — TRUE only if specific bank routing/account digits or full card number were actually spoken on the call (by either side).

CALLER-only fields (use only CALLER lines):
  - caller_stated_name, caller_location_state, intent_or_need, objections_raised, commitments_made, callback_requested
  - age_mentioned, age_verdict
  - interested_in_life_insurance — from CALLER's direct yes/no/maybe
  - has_bank_account — yes only if CALLER explicitly confirmed bank/credit union/credit card; never inferred
  - can_afford — concerns only if CALLER mentions fixed income, tight budget, or payment hesitation

---

Return this exact JSON structure:

{
  "summary": "<2-3 sentences: who called, what they wanted, what happened, outcome>",
  "language": "<en | es | mixed | other>",
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
    "intent_signals": ["<direct CALLER quotes showing genuine interest>"],
    "red_flags": ["<phrases suggesting misled caller, wrong product, bot, or fraud>"],
    "misalignment_reason": "<one sentence if intent doesn't match offer, otherwise null>"
  },
  "extracted_data": {
    "caller_stated_name": "<string or null>",
    "caller_location_state": "<2-letter state code or null>",
    "intent_or_need": "<what the CALLER said they were looking for, or null>",
    "objections_raised": ["<verbatim CALLER objections>"],
    "commitments_made": ["<what CALLER agreed to>"],
    "payment_info_collected": <boolean — true ONLY if routing/account/card digits actually read on call>,
    "callback_requested": <boolean>
  },
  "flags": ["<flag>"],
  "flag_details": { "<flag>": "<one sentence with verbatim evidence including speaker>" },
  "coaching_notes": "<1-2 sentences of specific, actionable coaching for the agent, or null>",
  "final_expense": {
    "age_mentioned": <number if CALLER stated their age, otherwise null>,
    "age_verdict": "<good if 40-80 | borderline if 81-85 | bad if 86+ | unknown if not mentioned>",
    "interested_in_life_insurance": "<yes | no | unclear>",
    "insurance_interest_notes": "<exact CALLER quote, or null>",
    "has_bank_account": "<yes | no | unclear>",
    "can_afford": "<yes | concerns | no | unclear>",
    "affordability_notes": "<exact CALLER quote about money/affordability, or null>",
    "free_government_mentions": <boolean — see definition above>,
    "free_government_quotes": ["<exact quotes (include speaker AGENT/CALLER prefix) — only if true>"],
    "outbound_call_claimed": <boolean — see definition above; CALLER only>,
    "outbound_call_quote": "<exact CALLER quote — only if true, otherwise null>",
    "ftc_regulatory_mention": <boolean>,
    "ftc_quote": "<exact quote with speaker prefix, or null>",
    "scam_keywords_mentioned": <boolean — CALLER only>,
    "scam_quotes": ["<exact CALLER quotes — only if true>"],
    "misleading_ad_mention": <boolean — see definition above; CALLER only>,
    "misleading_quotes": ["<exact CALLER quotes — only if true>"],
    "qualifier_score": <0-100. Start at 100. Deduct: age 86+ (-20), age unknown (-10), age 81-85 (-5), no insurance interest (-15), no bank account (-15), affordability concerns (-10), cannot afford (-20), free/govt mention (-30), outbound call claimed (-25), FTC/regulatory mention (-40), scam keywords (-35), misleading ad mention (-30). Minimum 0.>,
    "qualifier_verdict": "<qualified if score>=70 and no compliance flags | borderline if score 40-69 and no compliance flags | compliance_risk if ANY compliance flag is true | disqualified if score<40>",
    "qualifier_summary": "<1-2 sentences: lead quality verdict + single most important finding>"
  }
}

Valid flags: agent_unprofessional, agent_script_deviation, caller_confused, caller_hostile, compliance_concern, dead_air_excessive, premature_hangup, language_mismatch, audio_quality_poor, insufficient_audio, duplicate_caller_suspected

Scoring rules:
- quality_score: professionalism 30%, engagement 20%, qualification completeness 30%, outcome clarity 20%
- compliance_concern flag MUST be added whenever any compliance boolean is true; also lower quality_score significantly
- lead_intent.score: 100 = CALLER explicitly wanted life insurance; 0 = wrong product, bot, or fraud
- Short call (<5 exchanges or <60 seconds): quality_score ≤20, call_outcome "hung_up_early" or "unclear", flags must include "insufficient_audio", all final_expense qualification fields = "unclear"/null/false/[]

Return the JSON now.`

// gpt-4o has 128k context. Cap transcript at ~60k chars (~15k tokens).
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
