import OpenAI from 'openai'
import { query } from '@/lib/db'
import { DebtAnalysisSchema, type DebtAnalysis } from '@/types/debt'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const LLM_MODEL = 'gpt-4o'
const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2'
const TRANSCRIPTION_MODEL = 'universal-3-pro'
const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 16

export class RateLimitError extends Error {
  constructor() { super('OpenAI rate limit exceeded (429)'); this.name = 'RateLimitError' }
}

async function logApiCall(params: {
  call_id: string | null
  service: string
  duration_ms: number
  status_code: number
  tokens_used?: number | null
  error?: string | null
}): Promise<void> {
  try {
    await query(
      `INSERT INTO debt_api_logs (call_id, service, request_duration_ms, status_code, tokens_used, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [params.call_id, params.service, params.duration_ms, params.status_code, params.tokens_used ?? null, params.error ?? null]
    )
  } catch {
    // Non-critical
  }
}

// ---------- Transcription (Spanish, dual_channel) ----------

export type Utterance = { channel: '1' | '2'; start: number; end: number; text: string; confidence?: number }

export type TranscriptionResult = {
  text: string
  utterances: Utterance[]
  agent_channel: '1' | '2'
  transcript_text: string
  audio_duration: number | null
  language_code: string | null
}

export async function transcribeSpanishAudio(
  fileBuffer: Buffer,
  filename: string,
  callId: string | null
): Promise<TranscriptionResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set')
  const start = Date.now()

  const uploadRes = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
    body: fileBuffer as unknown as BodyInit,
  })
  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: uploadRes.status, error: `upload: ${errText.slice(0, 200)}` })
    throw new Error(`AssemblyAI upload failed: ${uploadRes.status}`)
  }
  const { upload_url } = await uploadRes.json() as { upload_url: string }

  const submitRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: 'es',            // Spanish
      dual_channel: true,             // Ringba stereo: L/R = agent/caller
      speech_models: [TRANSCRIPTION_MODEL],
      punctuate: true,
      format_text: true,
      disfluencies: false,
    }),
  })
  if (!submitRes.ok) {
    const errText = await submitRes.text()
    await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: submitRes.status, error: `submit: ${errText.slice(0, 200)}` })
    throw new Error(`AssemblyAI submit failed: ${submitRes.status}`)
  }
  const submission = await submitRes.json() as { id: string }
  const transcriptId = submission.id

  type PollResult = {
    utterances?: Array<{ channel: string | number; start: number; end: number; text: string; confidence?: number }>
    text?: string
    audio_duration?: number
    language_code?: string
    status?: string
    error?: string
  }
  let result: PollResult | null = null

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const pollRes = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, { headers: { authorization: apiKey } })
    if (!pollRes.ok) throw new Error(`AssemblyAI poll failed: ${pollRes.status}`)
    const p = await pollRes.json() as PollResult
    if (p.status === 'completed') { result = p; break }
    if (p.status === 'error') {
      await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: 500, error: `transcription error: ${p.error}` })
      throw new Error(`AssemblyAI transcription error: ${p.error}`)
    }
  }
  if (!result) {
    const elapsed = POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS / 1000
    await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: 504, error: `timeout after ${elapsed}s` })
    throw new Error(`AssemblyAI timeout after ${elapsed}s — transcript_id=${transcriptId} may still finish; retry will pick it up`)
  }

  const utterances: Utterance[] = (result.utterances ?? []).map(u => ({
    channel: String(u.channel) as '1' | '2',
    start: u.start, end: u.end, text: u.text, confidence: u.confidence,
  }))

  const agent_channel = identifyAgentChannel(utterances)
  const transcript_text = buildLabeledTranscript(utterances, agent_channel)

  await logApiCall({ call_id: callId, service: 'assemblyai', duration_ms: Date.now() - start, status_code: 200 })

  return {
    text: result.text ?? '',
    utterances,
    agent_channel,
    transcript_text,
    audio_duration: result.audio_duration ?? null,
    language_code: result.language_code ?? null,
  }
}

function identifyAgentChannel(u: Utterance[]): '1' | '2' {
  if (u.length === 0) return '2'
  // Inbound calls: agent (the greeter) speaks first.
  const sorted = [...u].sort((a, b) => a.start - b.start)
  const firstSpeaker = sorted[0].channel
  // Sanity: if the "first speaker" talks 3x less than the other, invert.
  const talk: Record<string, number> = { '1': 0, '2': 0 }
  for (const x of u) talk[x.channel] += x.end - x.start
  const other = firstSpeaker === '1' ? '2' : '1'
  if (talk[firstSpeaker] * 3 < talk[other]) return other as '1' | '2'
  return firstSpeaker
}

function buildLabeledTranscript(u: Utterance[], agent_channel: '1' | '2'): string {
  const sorted = [...u].sort((a, b) => a.start - b.start)
  return sorted
    .map(x => {
      const role = x.channel === agent_channel ? 'AGENT' : 'CALLER'
      const sec = (x.start / 1000).toFixed(1)
      return `[${sec}s] ${role}: ${x.text.trim()}`
    })
    .join('\n')
}

// ---------- Debt Spanish analysis (English output) ----------

const MAX_TRANSCRIPT_CHARS = 60_000

const DEBT_PROMPT_TEMPLATE = `You are an expert call quality analyst for a SPANISH-LANGUAGE DEBT CONSOLIDATION business. All calls are INBOUND — callers dialed in after seeing/hearing a Spanish-language advertisement about debt relief.

CRITICAL: The transcript below uses CHANNEL-SEPARATED speaker labels (AGENT / CALLER) determined from stereo channels — TRUST THE LABELS. The transcript is in SPANISH. Your OUTPUT MUST BE IN ENGLISH except for verbatim caller/agent quotes, which stay in the original Spanish.

RULES:
1. Output ONLY valid JSON. No markdown, no code fences, no prose.
2. Every field required. Use null / empty array if unknown.
3. Base every field ONLY on what is explicitly said. No guessing.
4. For compliance booleans: default FALSE. Only flag TRUE with clear, direct evidence.
5. Quotes must be verbatim in the original language. Everything else in English.

CALL METADATA:
- Campaign: {campaign}
- Duration: {duration_seconds} seconds
- Connected length: {connected_seconds} seconds

TRANSCRIPT (each line: [time] AGENT: … or [time] CALLER: … — in Spanish):
{transcript_text}

--- FIELD DEFINITIONS — READ CAREFULLY ---

HANGUP_REASON — one short English sentence describing why the call ended.
  Examples: "Caller lost interest after learning about fees.", "Caller had insufficient debt.", "Agent transferred to closer.", "Call cut off unexpectedly (network drop).", "Caller wanted to think about it.", "Caller was already enrolled in another program."
HANGUP_PARTY — "caller" (hung up first), "agent" (transferred / dismissed), or "unclear".

QUALITY SCORE (0-100) — how good a lead this is for debt consolidation.
  Scoring components (all 0-10):
    debt_load_disclosed (30%): did the caller state a specific debt amount?
    debt_load_meaningful (30%): is the debt amount at or above the industry threshold (typically $10,000)?
    caller_interest (25%): did the caller express genuine interest in a debt program?
    agent_professionalism (15%): rapport, tone, competence.
  Final quality_score = round(0.30*debt_load_disclosed + 0.30*debt_load_meaningful + 0.25*caller_interest + 0.15*agent_professionalism) * 10.

COMPLIANCE SCORE (0-100) — 100 = clean, deductions for each red-flag mention.
  Start at 100. Deduct as follows:
    government_program_mentioned = TRUE → -40  (agent or caller frames the service as a government / federal program, e.g. "programa del gobierno", "programa federal", "el gobierno")
    free_money_mentioned = TRUE → -40           (framed as free money / grants / gifted funds, e.g. "dinero gratis", "subvención", "regalo del gobierno")
    loan_mentioned = TRUE → -30                 (offered as a LOAN, e.g. "un préstamo", "prestamo", "loan" — debt CONSOLIDATION is not a loan; offering a loan is a compliance risk)
  Compliance is worse when the AGENT says these things than when the CALLER asks about them. If the CALLER asks (e.g., "es del gobierno?" / "es un préstamo?") and the AGENT correctly clarifies "no", DO NOT flag any compliance issue — this is normal script handling.
  If the agent affirms or agrees ("sí, es del gobierno" / "sí, es un préstamo"), FLAG IT.

DEBT_INFO:
  stated_debt_amount_usd: exact numeric amount in USD the CALLER disclosed, or null.
  debt_amount_verbatim: the exact Spanish phrase from the caller (e.g. "tengo como quince mil de deuda"), or null.
  debt_types: array of types mentioned in English (e.g. ["credit card","medical","personal loan","payday loan"]).
  debt_meets_threshold: "yes" if >= $10,000, "no" if < $10,000, "unclear" if not disclosed.
  interest_verdict: caller's expressed level of interest.
  interest_quote: the caller's exact Spanish quote showing their interest level, or null.

CALLER_INFO:
  stated_name / location_state (2-letter code) — only if explicitly said.
  speaks_english: is the caller comfortable in English too? Rarely relevant, "unclear" is fine as default.
  can_afford_payments: did the caller confirm they can afford a monthly payment plan?

FLAGS — array of tags, from this set only:
  agent_unprofessional, caller_hostile, compliance_concern, insufficient_audio, language_mismatch,
  debt_too_low, caller_uninterested, premature_hangup, audio_quality_poor, wrong_number

compliance_concern MUST be added whenever ANY compliance boolean is true.
insufficient_audio for very short calls (<30s or <5 exchanges).

Return this exact JSON structure:

{
  "summary": "<2-3 sentence English summary: who called, what they wanted, how it went, outcome>",
  "language": "<es | en | mixed | other>",
  "hangup_reason": "<one short English sentence>",
  "hangup_party": "<caller | agent | unclear>",
  "quality_score": <0-100 integer>,
  "quality_breakdown": {
    "debt_load_disclosed": <0-10>,
    "debt_load_meaningful": <0-10>,
    "caller_interest": <0-10>,
    "agent_professionalism": <0-10>
  },
  "compliance_score": <0-100 integer>,
  "compliance_breakdown": {
    "government_program_mentioned": <boolean>,
    "government_program_quote": "<verbatim Spanish quote with speaker prefix, or null>",
    "free_money_mentioned": <boolean>,
    "free_money_quote": "<verbatim Spanish quote or null>",
    "loan_mentioned": <boolean>,
    "loan_quote": "<verbatim Spanish quote or null>",
    "mentioned_by": "<agent | caller | both | none>"
  },
  "debt_info": {
    "stated_debt_amount_usd": <number or null>,
    "debt_amount_verbatim": "<Spanish quote or null>",
    "debt_types": ["<type in English>"],
    "debt_meets_threshold": "<yes | no | unclear>",
    "interest_verdict": "<high | medium | low | not_interested | unclear>",
    "interest_quote": "<Spanish quote or null>"
  },
  "caller_info": {
    "stated_name": "<name or null>",
    "location_state": "<2-letter US state code or null>",
    "speaks_english": "<yes | no | partial | unclear>",
    "can_afford_payments": "<yes | no | unclear>"
  },
  "flags": ["<flag>"],
  "flag_details": { "<flag>": "<one English sentence with verbatim Spanish evidence including speaker>" },
  "coaching_notes": "<1-2 English sentences of actionable coaching for the agent, or null>"
}

Return the JSON now.`

export async function analyzeDebtCall(params: {
  callId: string
  transcript_text: string
  campaign: string | null
  duration_seconds: number | null
  connected_length_seconds: number | null
}): Promise<DebtAnalysis> {
  const rawTranscript = params.transcript_text || '(no transcript)'
  const transcript = rawTranscript.length > MAX_TRANSCRIPT_CHARS
    ? rawTranscript.slice(0, MAX_TRANSCRIPT_CHARS) + '\n\n[transcript truncated — call too long]'
    : rawTranscript

  const prompt = DEBT_PROMPT_TEMPLATE
    .replace('{campaign}', params.campaign ?? 'Unknown')
    .replace('{duration_seconds}', String(params.duration_seconds ?? 0))
    .replace('{connected_seconds}', String(params.connected_length_seconds ?? 0))
    .replace('{transcript_text}', transcript)

  const start = Date.now()
  let rawResponse = ''
  try {
    const completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })
    rawResponse = completion.choices[0]?.message?.content ?? ''
    await logApiCall({
      call_id: params.callId,
      service: 'openai_llm',
      duration_ms: Date.now() - start,
      status_code: 200,
      tokens_used: completion.usage?.total_tokens ?? null,
    })
    return DebtAnalysisSchema.parse(JSON.parse(rawResponse))
  } catch (err: unknown) {
    const errAny = err as { status?: number; statusCode?: number; message?: string; name?: string }
    const status = errAny?.status ?? errAny?.statusCode ?? 500
    if (status === 429) {
      await logApiCall({ call_id: params.callId, service: 'openai_llm', duration_ms: Date.now() - start, status_code: 429, error: 'rate_limit' })
      throw new RateLimitError()
    }
    if (errAny?.name === 'ZodError' || err instanceof SyntaxError) {
      // One retry with a "fix your JSON" nudge.
      try {
        const retry = await openai.chat.completions.create({
          model: LLM_MODEL,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: rawResponse },
            { role: 'user', content: 'Your previous response was not valid JSON matching the required schema. Return ONLY the JSON object, no other text.' },
          ],
        })
        const retryRaw = retry.choices[0]?.message?.content ?? ''
        await logApiCall({
          call_id: params.callId, service: 'openai_llm',
          duration_ms: Date.now() - start, status_code: 200,
          tokens_used: retry.usage?.total_tokens ?? null,
        })
        return DebtAnalysisSchema.parse(JSON.parse(retryRaw))
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : 'unknown'
        await logApiCall({ call_id: params.callId, service: 'openai_llm', duration_ms: Date.now() - start, status_code: 500, error: retryMsg })
        throw new Error(`Analysis parse failed after retry: ${retryMsg}`)
      }
    }
    await logApiCall({ call_id: params.callId, service: 'openai_llm', duration_ms: Date.now() - start, status_code: status, error: errAny?.message })
    throw err
  }
}
