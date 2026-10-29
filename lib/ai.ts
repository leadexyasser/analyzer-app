import OpenAI from 'openai'
import { query } from '@/lib/db'
import { AnalysisSchema, type CampaignType } from '@/types/analysis'

// Detect campaign type from campaign_name + buyer_name. Spanish FE RTT calls follow a
// completely different sales flow than in-call closes — the licensed advisor closes on the
// buyer's side, family consult is normal, and callbacks are pipeline not losses. We route
// to a specialized prompt block for these.
function detectCampaignType(campaign_name: string | null, buyer_name: string | null): CampaignType {
  const c = (campaign_name ?? '').toLowerCase()
  const b = (buyer_name ?? '').toLowerCase()
  // Spanish FE RTT — Insurance Supermarket, RingbaX Spanish, Scale Club Spanish targets all
  // route through licensed advisors, not in-call closers.
  if (c.includes('spanish') || c.includes('español') || b.includes('insurance supermarket')) {
    return 'rtt_spanish'
  }
  if (c.includes('debt') || c.includes('deuda')) return 'debt'
  // Everything else assumes traditional in-call close (English FE, direct sale campaigns)
  if (c.includes('final expense') || c.includes('fe')) return 'in_call_close'
  return 'other'
}

// Additional prompt block injected ONLY for rtt_spanish campaigns. Overrides base rules
// where the RTT reality differs from the default in-call close assumption.
const RTT_SPANISH_MODE = `
=== MODE: SPANISH FE RTT (Real-Time Transfer to Licensed Advisor) ===

This is a Spanish-language Final Expense call routed to Insurance Supermarket or similar RTT buyer. The sales flow is FUNDAMENTALLY DIFFERENT from English in-call close campaigns:

1. Our agent qualifies the caller (age, health, bank type, ZIP for state licensing).
2. Our agent transfers to a LICENSED ADVISOR on the buyer's side (Rubén Paula, André Baena, Francisco Lopez, Wendy, María Briones, Valentina, Néstor Rodríguez, Abdiel Escalera, etc.).
3. The licensed advisor runs medical questions, HIPAA authorization for EMC National Life, underwriting approval, quotes options, asks for bank info, issues policy number, sets billing date.

RE-INTERPRET THE OUTCOME ENUM FOR THIS MODE:

- sale_closed — bank routing (9 digits) AND account digits appear verbatim in transcript AND a policy number is spoken verbatim by the closer. Nothing else counts. If either is missing, DO NOT set sale_closed.

- transferred — a licensed advisor took over the call (voice change, self-introduction, or explicit handoff by our qualifier). This is our BILLABLE conversion regardless of whether they closed on the buyer's side. Track separately from sale_closed.

- callback_scheduled — advisor and caller agreed on a specific future time to continue. This is a POSITIVE PIPELINE state in Spanish FE culture, NOT a loss. Latino families making a $50-200/mo decision routinely consult with hija/esposo/hijo before committing — that is the normal path, not a failure. Score quality of the callback commitment separately (specific time locked = high intent; vague "call me back later" = low intent).

- qualified_no_transfer — caller was fully qualified but the qualifier did NOT successfully transfer to a licensed advisor. This IS a loss on our side (something failed in our handoff).

- not_qualified — hard disqualification: age >85, terminal illness, no bank, no citizenship.

- hung_up_early — <60s or dropped mid-qualification.

CULTURAL & PROCESS INTERPRETATION RULES:

1. "Voy a hablar con mi hija/esposo/familia" is NOT a rejection. It is HIGH intent. Tag as objection_tag: family_consult_needed AND set callback_scheduled if a specific time was locked, else qualified_no_transfer with high lead_intent.score.

2. "Ya tengo una póliza con Senior Life / Colonial Penn / Lincoln Heritage" — caller has existing coverage. If advisor pushes REPLACEMENT and caller declines, tag existing_cheaper_policy. This is a SALES SCRIPT failure by the buyer's advisor, not lead quality. Caller may still be closeable on a SUPPLEMENT policy.

3. Fraud wariness ("no doy mi social por teléfono", "he tenido malas experiencias") is NORMAL protective behavior. Tag as trust_hesitation. Do NOT trigger compliance flags unless the caller is directly accusing THIS operation.

4. "Ahorita no tengo el número de seguro social a la mano" or similar SSN-not-available. Tag ssn_not_available. This is a pre-qualification gap on OUR side — our qualifier should verify SSN readiness before transferring.

5. "Tengo que ir a trabajar" / "tengo una cita" / hard time constraint. Tag time_conflict. Also a pre-qual gap — our qualifier should confirm 20-30 min availability.

6. "Se está oyendo entrecortado" / call quality issues → audio_quality_issue tag.

7. If the qualifier stalled or the transfer took too long and the caller lost patience → advisor_transfer_delayed.

QUALITY SCORE REWEIGHTING FOR RTT:

For Spanish FE RTT calls the OUR-AGENT quality score should weight:
  - qualification_completeness (40%) — did we collect the right info?
  - handoff_smoothness (30%) — did we transfer cleanly to a licensed advisor?
  - agent_professionalism (20%) — tone, pace, cultural fit
  - caller_engagement (10%) — did the caller stay engaged?

The traditional "call_outcome_clarity" weight is LOWER because our qualifier doesn't decide the outcome — the licensed advisor does, downstream, off our recording.

FIELDS TO POPULATE:

- campaign_type: "rtt_spanish"
- objection_tags: array of applicable tags from the enum (0-3 typical). Only include tags with clear evidence in the transcript.
- handoff_smoothness: 0-10 rating. Score 0 if no transfer attempted; 1-3 if transfer was fumbled (dead air, misrouting); 4-6 if transfer happened but qualifier missed context handoff to the advisor; 7-10 if qualifier smoothly briefed the advisor on caller's needs before handoff.

The RTT mode block OVERRIDES conflicting rules in the base prompt. Where the base prompt says "sale_closed requires our agent to close," THIS mode's definition wins.
`


export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// DeepSeek is OpenAI-API-compatible, so we reuse the OpenAI SDK with a different baseURL.
// deepseek-chat = V3 (their frontier general model). Priced ~$0.27/M input, $1.10/M output —
// roughly 10x cheaper than GPT-4o at our volume with similar Spanish close-detection quality.
//
// 25s timeout: DeepSeek's normal p99 for our analyze prompts is ~5s. 25s catches the hang
// case fast enough that even 3 concurrent batch timeouts + gpt-4o-mini fallback stays under
// the 90s Vercel function budget (25s hang × 1 batch + ~10s fallback = 35s, well within).
// Without a client timeout the OpenAI SDK waits ~10 minutes, which killed the queue during
// DeepSeek's Sept-14 capacity hiccup.
export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
  timeout: 25_000,
  maxRetries: 0,
})
const DEEPSEEK_MODEL = 'deepseek-chat'
// Fallback: when DeepSeek fails, we retry the same call with gpt-4o-mini. Costs ~$0.15/M
// input, $0.60/M output — a few pennies per fallback call, but keeps the queue draining
// through any DeepSeek outage. gpt-4o-mini's Spanish close-detection quality is near
// GPT-4o and safely above the "is this a close?" threshold this pipeline needs.
const FALLBACK_MODEL = 'gpt-4o-mini'

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
  service: 'assemblyai' | 'openai_llm' | 'groq_whisper' | 'deepgram' | 'gemini' | 'deepseek'
  duration_ms: number
  status_code: number
  tokens_used?: number | null
  error?: string | null
}) {
  try {
    await query(
      `INSERT INTO api_logs (call_id, service, request_duration_ms, status_code, tokens_used, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.call_id,
        params.service,
        params.duration_ms,
        params.status_code,
        params.tokens_used ?? null,
        params.error ?? null,
      ]
    )
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

// Deepgram Nova-3 replacement for AssemblyAI. Same public contract, drop-in.
// Uses synchronous pre-recorded endpoint — returns full result on one HTTP call, no polling.
// Handles multi-hour audio natively (no submission timeout window like the AssemblyAI flow had).
export async function transcribeAudio(
  fileBuffer: Buffer,
  filename: string,
  callId: string | null = null
): Promise<TranscriptionResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY not set')

  const start = Date.now()

  // Deepgram: submit audio bytes directly to /v1/listen, get transcript back in one call.
  // multichannel=true → Ringba's stereo (L=caller, R=agent) is split per-channel.
  // language=multi → auto-detects Spanish + English code-switching (common in Latino FE calls).
  // model=nova-3 → best available for Spanish accuracy.
  const url = new URL('https://api.deepgram.com/v1/listen')
  url.searchParams.set('model', 'nova-3')
  url.searchParams.set('language', 'multi')
  url.searchParams.set('multichannel', 'true')
  url.searchParams.set('punctuate', 'true')
  url.searchParams.set('utterances', 'true')
  url.searchParams.set('smart_format', 'true')

  // Content-type from extension. Ringba delivers WAV or MP3.
  const mime = filename.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav'

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': mime,
    },
    body: fileBuffer as any,
    // No client-side timeout — Deepgram takes ~8-30s even for 3+ hour audio.
    // If Node's default socket timeout hits, worker will retry via job queue.
  })

  if (!res.ok) {
    const errText = await res.text()
    await logApiCall({ call_id: callId, service: 'deepgram', duration_ms: Date.now() - start, status_code: res.status, error: `submit: ${errText.slice(0, 200)}` })
    throw new Error(`Deepgram submit failed: ${res.status} ${errText.slice(0, 200)}`)
  }

  const result: any = await res.json()

  // Deepgram utterances: { start (sec, float), end (sec, float), transcript, channel (0|1), confidence }
  // Our Utterance shape: { channel: '1'|'2', start/end in ms, text, confidence }
  const rawUtts = result.results?.utterances ?? []
  const utterances: Utterance[] = rawUtts.map((u: any) => ({
    channel: (u.channel === 0 ? '1' : '2') as '1' | '2',
    start: Math.round(u.start * 1000),
    end: Math.round(u.end * 1000),
    text: u.transcript,
    confidence: u.confidence,
  }))

  const agent_channel = identifyAgentChannel(utterances)
  const transcript_text = buildChannelLabeledTranscript(utterances, agent_channel)

  // Combined full text across channels, sorted by time (matches AssemblyAI's result.text shape).
  const full_text = [...utterances]
    .sort((a, b) => a.start - b.start)
    .map(u => u.text)
    .join(' ')

  // First detected language per channel — pick the majority language for the language_code field.
  const langs: string[] = []
  for (const ch of result.results?.channels ?? []) {
    const l = ch?.alternatives?.[0]?.languages
    if (Array.isArray(l) && l.length > 0) langs.push(l[0])
  }
  const language_code = langs[0] ?? null

  await logApiCall({
    call_id: callId,
    service: 'deepgram',
    duration_ms: Date.now() - start,
    status_code: 200,
  })

  return {
    text: full_text,
    utterances,
    agent_channel,
    transcript_text,
    audio_duration: result.metadata?.duration ?? null,
    language_code,
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

CALL OUTCOME — critical, read all of this.

There are TWO valid sale-close patterns for final expense. Detect BOTH:

  PATTERN A — Agent closes on the call (traditional):
    (a) AGENT collected payment method details (bank routing/account, card number, premium payment) — digits read on the call;
    (b) CALLER gave explicit verbal consent to enroll;
    (c) AGENT confirmed enrollment/approval.

  PATTERN B — RTT / licensed advisor closes on the call (common on Spanish FE and any "*RTT" target):
    A qualifier agent talks to the caller first, then the call is warm-transferred to a licensed advisor / closer / senior agent who takes over and enrolls the caller live on the recording. The close signals are DIFFERENT from Pattern A — look for any TWO of the following on the same call:
    (a) A policy number is spoken by the closing agent. Ex: "el número de póliza suya es IS39006" / "your policy number is ABC12345" / "número de policy" / "policy number". This is the strongest single signal — a policy number issued = enrollment attempted.
    (b) Bank routing digits AND account digits are read live (either side reads them). Nine-digit routing + variable-length account = strong close signal.
    (c) A billing/effective date is confirmed. Ex: "vamos a cobrar el 15 de agosto" / "billing on August 15th" / "the policy is effective [date]" / "cobrar en el [date]".
    (d) The closing agent congratulates the caller after collecting payment info. Ex: "muchas felicidades" / "welcome to [carrier]" / "congratulations, you're covered" / "está aprobada".
    (e) A rate/premium amount is locked in with the caller's acceptance. Ex: "$40 al mes, ¿está bien?" — CALLER: "sí, está bien" / caller agrees to a specific dollar amount and it's confirmed by the closer.

TRANSFERRED — the call was warm-transferred to another party but no close signals fired. Detect via any of:
  - Explicit AGENT statement: "let me transfer you", "voy a transferirle", "connecting you with a licensed advisor".
  - Voice/speaker change to a new agent introducing themselves (esp. saying "licensed advisor", "asesor autorizado", "senior advisor", "carrier").
  - System event in the recording: "you have been kicked from this conference" / hold music followed by new voice / call ID handoff.
  - Handoff to a NAMED person (ex: "transferring you to Michelle Salinas / Raymond García") — this is a transfer even if the LLM can't hear the second party.

QUALIFIED_NO_TRANSFER — caller was fully qualified (age good, insurance interest yes, bank yes, can afford), but no transfer language and no close signals. Common ending: "we'll call you back" / "let me talk to my family first" / callback scheduled.

CALLBACK_SCHEDULED — the agent and caller agreed on a specific future call time. Ex: "espera mi llamada mañana" / "we'll call you Sunday afternoon". Also fires when the agent says "we'll follow up".

NOT_QUALIFIED — caller answered qualifying questions but failed on age, health, or affordability.

HUNG_UP_EARLY — call ended in under 60 seconds OR caller dropped before qualification finished.

UNCLEAR — use ONLY when signals conflict or are missing. Never use unclear when Pattern B signals are present.

Priority when multiple outcomes look possible:
  sale_closed > transferred > qualified_no_transfer > callback_scheduled > not_qualified > hung_up_early > unclear

Hard mapping rules — apply BEFORE picking the outcome:
  1. If enrollment_evidence.close_confidence is "moderate" or "strong" AND the caller did NOT explicitly reject the sale after the signals → outcome MUST be sale_closed.
  2. If enrollment_evidence.licensed_advisor_present is true (a second closing agent, licensed advisor, or senior advisor took over the call) → outcome MUST be at least "transferred". You may only downgrade to "qualified_no_transfer" if NO licensed advisor was ever on the call.
  3. If a specific future callback time was locked in AND rule 1/2 didn't fire → callback_scheduled.
  4. Only after applying rules 1-3, fall back to qualified_no_transfer / not_qualified / hung_up_early / unclear.

A licensed advisor / carrier closer being on the call always means the transfer HAPPENED. Whether the sale then closed on their side is a separate signal captured in enrollment_evidence — a failed close on the advisor's side is still a transferred call, not a qualified_no_transfer.

INSURANCE SUPERMARKET / EMC NATIONAL LIFE ENROLLMENT FINGERPRINT (Spanish FE RTT buyer):
The buyer for the Spanish Final Expense RTT campaign is "Insurance Supermarket" placing policies with "EMC National Life" (EMCNL / IMCNL / EMC / IMC in transcripts). They read a HIPAA/authorization block that mentions "PO Box 9144, Des Moines, IA" — this identifies the buyer, not a close.

DO NOT HALLUCINATE. Only the following strict rules determine sale_closed. Do not invent policy numbers, do not carry over examples from these instructions. Every value in enrollment_evidence must be extracted VERBATIM from the transcript.

Sale_closed for this buyer requires ALL THREE:
  (a) A 9-digit bank routing number appears in the transcript as spoken digits, AND an account number of 6-12 digits also appears. The digits must be literally present in the transcript text — grep-able. If you cannot quote the specific digits, set payment_digits_read = false.
  (b) The closer speaks a specific policy number that is literally present in the transcript. Policy number formats include things like alphanumeric strings (e.g. two letters followed by 5-6 digits) said character-by-character. If no such string is spoken in the transcript, set policy_number_issued = false and policy_number = null. DO NOT make one up.
  (c) The closer says "Felicidades" AFTER the bank digits are read and the policy number is issued. Find this in the transcript AFTER the point where the bank digits appear.

If any of (a), (b), (c) cannot be verified with a verbatim transcript quote, outcome is NOT sale_closed.

CRITICAL — "Felicidades" is used in TWO contexts by these closers:
  1. UNDERWRITING APPROVAL (before bank info): "Felicidades, me la aprobaron para vida excepcional" or "Felicidades, la aprobamos". This means MIB medical check passed. It is NOT a close.
  2. FINAL WRAP after bank info + policy number: THIS is the close signal.
  If bank digits do not appear in the transcript, "Felicidades" is context #1, not a close.

Emailing a "policy" PDF or brochure ("le mandé la póliza por correo") is NOT the same as issuing a policy number on the call. If the closer says "le mandé por email" without the caller having read bank digits, this is a marketing send, not a close.

Callback scheduled but no bank digits yet → callback_scheduled. The buyer's closers routinely say "vamos a llamar mañana / el domingo" when they didn't get bank info THIS call. That callback IS the next attempt to close — the current call did NOT close.

The evidence_quotes array MUST contain the verbatim transcript lines that support each true boolean. If a boolean is true but you cannot produce the supporting verbatim quote, the boolean must be false.

DO NOT confuse: caller mentioning an existing policy with a DIFFERENT carrier (e.g. Senior Life, Lincoln Heritage, Colonial Penn) does NOT mean the caller is sticking with them. This buyer's script actively encourages replacing existing coverage with EMC National Life. Watch for the closer saying "cancele el otro" / "cancela aquella" AFTER the new policy is set up — this indicates the new EMC policy was successfully issued.

OUTBOUND_CALL_CLAIMED — TRUE only if the CALLER explicitly claims OUR side called THEM first.
  TRUE: "you called me", "someone from your company called me", "I got a call from you guys and I'm calling back".
  FALSE (common false positives): "I was just on the phone", "it popped up on my phone", "I saw it on my phone", "I called in", "I'm calling about the ad", "I was on another call".
  Anything said by the AGENT does NOT trigger this flag. The flag is exclusively about CALLER accusations of an outbound call from us.

FREE_GOVERNMENT_MENTIONS — TRUE only when the AGENT explicitly frames the product as free/government, OR the CALLER quotes a source (ad, prior agent, family member) that told them the product was free or a government benefit. The bar is HIGH — the caller must clearly attribute a "free" / "government" / "money being given" claim to the ad or a prior source, not merely wonder about cost or reference their own government income.
  TRUE examples:
    - AGENT: "this is a government program" / "the federal government pays for this".
    - CALLER: "the ad said it was a free government benefit" / "they told me it was free" / "me dijeron que era gratis" / "es dinero que el gobierno le está dando" / "vi en el anuncio que era gratis".
  FALSE (DO NOT trigger — these are NOT compliance issues):
    - CALLER mentions being on SSI / disability / Medicare / Social Security / government assistance as their income source — income facts about the caller, not claims about the product. Ex: "solo vivo de mi Seguro Social", "I'm on disability".
    - CALLER asks whether the product costs money or is free ("is this free?", "¿es gratis?", "how much does this cost?") — a question is not an accusation.
    - CALLER expresses hope/wish that it's free without attributing to a source: "I was hoping it would be free", "ojalá fuera gratis".
    - AGENT mentions "government-issued ID" (verification step) or "Social Security number" as a data field.
    - AGENT clarifies pricing ("this is not free, it's \$40/month") — clarification is not a violation.
  Key test: is the caller quoting a source that told them it's free/government? If it's just their own question, wish, or confusion, DO NOT flag.

MISLEADING_AD_MENTION — TRUE only if the CALLER explicitly states the advertisement said something FALSE, DIFFERENT, or MISREPRESENTED compared to what they're being told on the call. The bar is HIGH — the caller must clearly accuse the ad of misrepresenting the offer.
  TRUE examples:
    - CALLER: "the ad said I'd get \$50,000 for free"
    - CALLER: "it said no medical exam but you're asking questions"
    - CALLER: "the ad said something different from what you're telling me"
    - CALLER: "the ad lied" / "el anuncio mintió" / "no era lo que decía el anuncio" / "me engañaron con el anuncio"
    - CALLER quoting a specific ad promise that contradicts the current offer.
  FALSE (DO NOT trigger — these are normal due-diligence / curiosity, NOT compliance issues):
    - CALLER mentions seeing the ad as the reason they called: "I saw your ad", "vi el anuncio", "saw it on Facebook / TikTok".
    - CALLER expresses wariness / wants to verify the ad's claim: "let me see if it's true", "voy a preguntar a ver si es cierto", "a ver si es verdad", "quería checar si es real" — wanting to verify is NOT accusing.
    - CALLER asks clarifying questions about what the ad offered: "the ad mentioned burial coverage, is that what this is?", "el anuncio decía algo del mortorio, ¿es esto?".
    - CALLER is confused about the product generally, without attributing the confusion to the ad.
    - AGENT clarifying or restating ad copy.
  Key test: is the caller ACCUSING the ad of being wrong, or just REFERENCING the ad? Referencing = FALSE. Accusing = TRUE.

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
  "campaign_type": "<rtt_spanish | in_call_close | debt | other — set by the injected MODE block if any, else match on campaign/buyer name>",
  "objection_tags": ["<0-3 tags from the RTT enum: family_consult_needed | existing_cheaper_policy | ssn_not_available | bank_info_declined | time_conflict | trust_hesitation | medical_disqualification | affordability_concern | audio_quality_issue | advisor_transfer_delayed | callback_scheduled_positive — only for rtt_spanish; empty array otherwise>"],
  "handoff_smoothness": <0-10 for rtt_spanish calls where a transfer was attempted; null otherwise>,
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
    "enrollment_evidence": {
      "policy_number_issued":     <boolean — true if a policy number was spoken by the closer, in ANY format (e.g. "IS39006", "ABC-12345", "número de póliza")>,
      "policy_number":            "<the exact policy number string, or null>",
      "payment_digits_read":      <boolean — true if bank routing AND account digits, OR card number digits, were actually read aloud (not just requested)>,
      "billing_date_confirmed":   <boolean — true if a specific billing/effective date was locked in and acknowledged>,
      "billing_date":             "<date string as stated, or null>",
      "closer_congratulations":   <boolean — true if the closer said 'felicidades' / 'congratulations' / 'welcome' AFTER payment info was taken>,
      "premium_amount_locked":    <boolean — true if a specific monthly premium ($X/month) was quoted and the caller accepted>,
      "premium_amount":           "<the premium string as stated, or null>",
      "licensed_advisor_present": <boolean — true if a second agent (licensed advisor / senior agent / closer) joined the call after a transfer>,
      "licensed_advisor_name":    "<name if stated, or null>",
      "close_confidence":         "<none | weak | moderate | strong — based on how many of the above fired: 0=none, 1=weak, 2=moderate, 3+=strong>",
      "evidence_quotes":          ["<exact quotes with speaker prefix that support the above signals, max 4>"]
    },
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

// DeepSeek V3 has a 128k-token input window. On our Spanish transcripts that maps to
// ~325k chars (measured: 98k chars → 38k tokens = ~2.55 chars/token on their tokenizer).
// Cap at 280k chars to leave safe headroom for the prompt template + JSON output budget.
// Head + tail split preserves both the intro (advisor identity) and the enrollment tail
// (bank digits, ACH consent) where the close signals live.
const MAX_TRANSCRIPT_CHARS = 280_000
const HEAD_KEEP = 80_000
const TAIL_KEEP = 200_000

function windowTranscript(raw: string): string {
  if (raw.length <= MAX_TRANSCRIPT_CHARS) return raw
  const head = raw.slice(0, HEAD_KEEP)
  const tail = raw.slice(-TAIL_KEEP)
  return head + '\n\n[transcript middle truncated — call unusually long. showing head + tail]\n\n' + tail
}

export async function analyzeCall(params: {
  callId: string
  transcript_text: string
  campaign_name: string | null
  buyer_name: string | null
  duration_seconds: number | null
  revenue: number | null
}) {
  const rawTranscript = params.transcript_text || '(no transcript)'
  const transcript = windowTranscript(rawTranscript)

  const campaignType = detectCampaignType(params.campaign_name, params.buyer_name)
  // Inject the mode-specific block at the TOP of the prompt so its overrides land before base rules.
  const modeBlock = campaignType === 'rtt_spanish' ? RTT_SPANISH_MODE + '\n' : ''

  const prompt = modeBlock + ANALYSIS_PROMPT_TEMPLATE
    .replace('{campaign_name}', params.campaign_name ?? 'Unknown')
    .replace('{buyer_name}', params.buyer_name ?? 'Unknown')
    .replace('{duration_seconds}', String(params.duration_seconds ?? 0))
    .replace('{revenue}', String(params.revenue ?? 0))
    .replace('{transcript_text}', transcript)

  const start = Date.now()

  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set')

  // Primary: DeepSeek (cheap). Fallback: gpt-4o-mini on OpenAI (per user — 2026-10-01).
  const callLlm = async (messages: OpenAI.Chat.ChatCompletionMessageParam[]) => {
    try {
      return await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages,
      })
    } catch (err) {
      const e = err as { status?: number; statusCode?: number; name?: string; message?: string; code?: string }
      const status = e?.status ?? e?.statusCode ?? 0
      const transient = (status >= 500 && status < 600)
        || e?.name === 'APIConnectionError' || e?.name === 'APIConnectionTimeoutError'
        || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET' || e?.code === 'ECONNREFUSED'
        || (typeof e?.message === 'string' && /timeout|aborted|connection/i.test(e.message))
      if (!transient) throw err
      await logApiCall({
        call_id: params.callId,
        service: 'deepseek',
        duration_ms: Date.now() - start,
        status_code: status || 599,
        error: `fallback_triggered: ${String(e.message).slice(0, 200)}`,
      })
      const fallbackStart = Date.now()
      const result = await openai.chat.completions.create({
        model: FALLBACK_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages,
      })
      await logApiCall({
        call_id: params.callId,
        service: 'openai_llm',
        duration_ms: Date.now() - fallbackStart,
        status_code: 200,
        tokens_used: result.usage?.total_tokens ?? null,
      })
      return result
    }
  }

  let rawResponse = ''
  try {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt },
    ]
    const completion = await callLlm(messages)
    rawResponse = completion.choices[0]?.message?.content ?? ''
    const tokensUsed = completion.usage?.total_tokens ?? null

    await logApiCall({
      call_id: params.callId,
      service: 'deepseek',
      duration_ms: Date.now() - start,
      status_code: 200,
      tokens_used: tokensUsed,
    })

    const parsed = JSON.parse(rawResponse)
    return AnalysisSchema.parse(parsed)
  } catch (err: any) {
    const status = err?.status ?? err?.statusCode ?? 500

    // OpenAI (and DeepSeek fallback) return 429 on rate limits. Map to RateLimitError so
    // the job scheduler backs off using the existing retry policy.
    if (status === 429) {
      await logApiCall({ call_id: params.callId, service: 'openai_llm', duration_ms: Date.now() - start, status_code: 429, error: 'rate_limit' })
      throw new RateLimitError()
    }

    // Schema violation / bad JSON → one correction round-trip.
    if (err?.name === 'ZodError' || err instanceof SyntaxError) {
      try {
        const retryStart = Date.now()
        const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: 'user', content: prompt },
          { role: 'assistant', content: rawResponse },
          {
            role: 'user',
            content: 'Your previous response was not valid JSON matching the required schema. Return ONLY the JSON object, no other text.',
          },
        ]
        const retry = await callLlm(retryMessages)
        const retryRaw = retry.choices[0]?.message?.content ?? ''
        await logApiCall({
          call_id: params.callId,
          service: 'deepseek',
          duration_ms: Date.now() - retryStart,
          status_code: 200,
          tokens_used: retry.usage?.total_tokens ?? null,
        })
        return AnalysisSchema.parse(JSON.parse(retryRaw))
      } catch (retryErr: any) {
        const retryStatus = retryErr?.status ?? 500
        await logApiCall({ call_id: params.callId, service: 'deepseek', duration_ms: Date.now() - start, status_code: retryStatus, error: retryErr?.message })
        throw new Error(`Analysis parse failed after retry: ${retryErr?.message}\nRaw: ${rawResponse}`)
      }
    }

    await logApiCall({ call_id: params.callId, service: 'deepseek', duration_ms: Date.now() - start, status_code: status, error: err?.message })
    throw err
  }
}
