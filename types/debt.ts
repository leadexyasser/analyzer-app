import { z } from 'zod'

export type DebtCallStatus = 'pending' | 'downloading' | 'transcribing' | 'analyzing' | 'complete' | 'failed'
export type DebtJobType = 'download' | 'transcribe' | 'analyze'

export type DebtCall = {
  id: string
  recording_url_original: string
  received_at: string
  call_started_at: string | null
  campaign: string | null
  caller_id: string | null
  target_number: string | null
  number_pool: string | null
  is_duplicate: boolean | null
  time_to_call_seconds: number | null
  time_to_connect_seconds: number | null
  connected_length_seconds: number | null
  duration_seconds: number | null
  revenue: number | null
  recording_storage_path: string | null
  transcript: Record<string, unknown> | null
  transcript_text: string | null
  analysis: DebtAnalysis | null
  quality_score: number | null
  compliance_score: number | null
  flags: string[]
  status: DebtCallStatus
  error_message: string | null
  processing_attempts: number
  source_filename: string | null
  uploaded_at: string
  created_at: string
  updated_at: string
}

// ---------- LLM analysis output shape ----------

export const DebtAnalysisSchema = z.object({
  summary: z.string(),
  language: z.enum(['es', 'en', 'mixed', 'other']),
  hangup_reason: z.string(),
  hangup_party: z.enum(['caller', 'agent', 'unclear']),

  quality_score: z.number().min(0).max(100),
  quality_breakdown: z.object({
    debt_load_disclosed: z.number().min(0).max(10),
    debt_load_meaningful: z.number().min(0).max(10),
    caller_interest: z.number().min(0).max(10),
    agent_professionalism: z.number().min(0).max(10),
  }),

  compliance_score: z.number().min(0).max(100),
  compliance_breakdown: z.object({
    government_program_mentioned: z.boolean(),
    government_program_quote: z.string().nullable(),
    free_money_mentioned: z.boolean(),
    free_money_quote: z.string().nullable(),
    loan_mentioned: z.boolean(),
    loan_quote: z.string().nullable(),
    mentioned_by: z.enum(['agent', 'caller', 'both', 'none']),
  }),

  debt_info: z.object({
    stated_debt_amount_usd: z.number().nullable(),
    debt_amount_verbatim: z.string().nullable(),
    debt_types: z.array(z.string()),  // e.g. ["credit card","medical","personal loan"]
    debt_meets_threshold: z.enum(['yes', 'no', 'unclear']),  // typically >=$10k
    interest_verdict: z.enum(['high', 'medium', 'low', 'not_interested', 'unclear']),
    interest_quote: z.string().nullable(),
  }),

  caller_info: z.object({
    stated_name: z.string().nullable(),
    location_state: z.string().nullable(),
    speaks_english: z.enum(['yes', 'no', 'partial', 'unclear']),
    can_afford_payments: z.enum(['yes', 'no', 'unclear']),
  }),

  flags: z.array(z.string()),
  flag_details: z.record(z.string(), z.string()),
  coaching_notes: z.string().nullable(),

  // English translation of the whole labeled transcript, one line per utterance
  // in the same "[time] AGENT: …" / "[time] CALLER: …" format. Rendered as the
  // chat bubbles; the original Spanish stays in transcript.utterances for
  // compliance auditing.
  translated_transcript: z.string().nullable(),
})

export type DebtAnalysis = z.infer<typeof DebtAnalysisSchema>
