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
  agent_speaker: z.enum(['Speaker A', 'Speaker B', 'unclear']),
  quality_score: z.number().int().min(0).max(100),
  quality_breakdown: QualityBreakdownSchema,
  call_outcome: CallOutcomeEnum,
  outcome_confidence: z.enum(['high', 'medium', 'low']),
  extracted_data: ExtractedDataSchema,
  flags: z.array(z.string()),
  flag_details: z.record(z.string(), z.string()),
  coaching_notes: z.string().nullable(),
})

export type Analysis = z.infer<typeof AnalysisSchema>
export type CallOutcome = z.infer<typeof CallOutcomeEnum>
export type QualityBreakdown = z.infer<typeof QualityBreakdownSchema>
export type ExtractedData = z.infer<typeof ExtractedDataSchema>
