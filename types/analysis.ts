import { z } from 'zod'

export const QualityBreakdownSchema = z.object({
  agent_professionalism: z.number().int().min(0).max(10),
  caller_engagement: z.number().int().min(0).max(10),
  qualification_completeness: z.number().int().min(0).max(10),
  call_outcome_clarity: z.number().int().min(0).max(10),
})

export const ExtractedDataSchema = z.object({
  caller_stated_name: z.string().nullable(),
  caller_location_state: z.string().nullable(),
  intent_or_need: z.string().nullable(),
  objections_raised: z.array(z.string()),
  commitments_made: z.array(z.string()),
  payment_info_collected: z.boolean(),
  callback_requested: z.boolean(),
})

export const LeadIntentSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.enum(['qualified', 'borderline', 'unqualified', 'invalid']),
  is_genuine_inquiry: z.boolean(),
  intent_signals: z.array(z.string()),
  red_flags: z.array(z.string()),
  misalignment_reason: z.string().nullable(),
})

export const FinalExpenseQualifierSchema = z.object({
  // ── Qualifying factors ───────────────────────────────────────────────────
  age_mentioned: z.number().nullable(),
  age_verdict: z.enum(['good', 'borderline', 'bad', 'unknown']),

  interested_in_life_insurance: z.enum(['yes', 'no', 'unclear']),
  insurance_interest_notes: z.string().nullable(),

  has_bank_account: z.enum(['yes', 'no', 'unclear', 'unknown']).transform((v): 'yes' | 'no' | 'unclear' => v === 'unknown' ? 'unclear' : v as 'yes' | 'no' | 'unclear'),

  can_afford: z.enum(['yes', 'concerns', 'no', 'unclear', 'unknown']).transform((v): 'yes' | 'concerns' | 'no' | 'unclear' => v === 'unknown' ? 'unclear' : v as 'yes' | 'concerns' | 'no' | 'unclear'),
  affordability_notes: z.string().nullable(),

  // ── Compliance flags ─────────────────────────────────────────────────────
  free_government_mentions: z.boolean(),
  free_government_quotes: z.array(z.string()),

  outbound_call_claimed: z.boolean(),
  outbound_call_quote: z.string().nullable(),

  ftc_regulatory_mention: z.boolean(),
  ftc_quote: z.string().nullable(),

  scam_keywords_mentioned: z.boolean(),
  scam_quotes: z.array(z.string()),

  misleading_ad_mention: z.boolean(),
  misleading_quotes: z.array(z.string()),

  // ── Overall ──────────────────────────────────────────────────────────────
  qualifier_score: z.number().int().min(0).max(100),
  qualifier_verdict: z.enum(['qualified', 'borderline', 'disqualified', 'compliance_risk']),
  qualifier_summary: z.string(),
})

export const ValidFlags = [
  'agent_unprofessional',
  'agent_script_deviation',
  'caller_confused',
  'caller_hostile',
  'compliance_concern',
  'dead_air_excessive',
  'premature_hangup',
  'language_mismatch',
  'audio_quality_poor',
  'insufficient_audio',
  'duplicate_caller_suspected',
] as const

export type ValidFlag = (typeof ValidFlags)[number]

export const CallOutcomeEnum = z.enum([
  'transferred',
  'qualified_no_transfer',
  'not_qualified',
  'hung_up_early',
  'voicemail',
  'wrong_number',
  'callback_scheduled',
  'sale_closed',
  'unclear',
])

export const AnalysisSchema = z.object({
  summary: z.string(),
  language: z.enum(['en', 'es', 'mixed', 'other']),
  // agent_speaker removed — now determined by channel separation, not LLM inference
  agent_speaker: z.enum(['Speaker A', 'Speaker B', 'AGENT', 'CALLER', 'unclear']).optional().nullable(),
  quality_score: z.number().int().min(0).max(100),
  quality_breakdown: QualityBreakdownSchema,
  call_outcome: CallOutcomeEnum,
  outcome_confidence: z.enum(['high', 'medium', 'low']),
  lead_intent: LeadIntentSchema,
  extracted_data: ExtractedDataSchema,
  flags: z.array(z.string()),
  flag_details: z.record(z.string(), z.string()),
  coaching_notes: z.string().nullable(),
  final_expense: FinalExpenseQualifierSchema.optional().nullable(),
})

export type Analysis = z.infer<typeof AnalysisSchema>
export type CallOutcome = z.infer<typeof CallOutcomeEnum>
export type QualityBreakdown = z.infer<typeof QualityBreakdownSchema>
export type ExtractedData = z.infer<typeof ExtractedDataSchema>
export type LeadIntent = z.infer<typeof LeadIntentSchema>
export type FinalExpenseQualifier = z.infer<typeof FinalExpenseQualifierSchema>
