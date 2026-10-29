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

  // ── Enrollment evidence (Pattern B / RTT close detection) ────────────────
  // Present on all analyses going forward; optional so historical rows still validate.
  enrollment_evidence: z.object({
    policy_number_issued: z.boolean(),
    policy_number: z.string().nullable(),
    payment_digits_read: z.boolean(),
    billing_date_confirmed: z.boolean(),
    billing_date: z.string().nullable(),
    closer_congratulations: z.boolean(),
    premium_amount_locked: z.boolean(),
    premium_amount: z.string().nullable(),
    licensed_advisor_present: z.boolean(),
    licensed_advisor_name: z.string().nullable(),
    close_confidence: z.enum(['none', 'weak', 'moderate', 'strong']),
    evidence_quotes: z.array(z.string()),
  }).optional().nullable(),

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

// RTT-specific objection tags — closed enum so the LLM can't invent new categories.
// These reflect the actual failure modes we've observed on Spanish FE RTT calls.
export const RttObjectionTags = [
  'family_consult_needed',       // "let me talk to my hija/esposo/familia first" — HIGH intent, callback likely
  'existing_cheaper_policy',     // caller has prior FE at a lower rate → advisor pushed replacement wrong
  'ssn_not_available',           // caller doesn't have SSN handy — pre-qual gap on our side
  'bank_info_declined',          // caller flat refused to give routing/account
  'time_conflict',               // caller had a hard time constraint (work, appointment, family event)
  'trust_hesitation',            // fraud-wary but not accusing — normal protective behavior
  'medical_disqualification',    // failed underwriting (health, age, prescriptions)
  'affordability_concern',       // premium too high for stated income
  'audio_quality_issue',         // call kept dropping / muffled
  'advisor_transfer_delayed',    // qualifier stalled → caller lost patience before licensed advisor arrived
  'callback_scheduled_positive', // active callback commitment with specific time — pipeline, not loss
] as const

export type RttObjectionTag = (typeof RttObjectionTags)[number]

// Campaign type gates which prompt block runs. rtt_spanish uses the licensed-advisor-close rules;
// in_call_close uses the traditional agent-closes-on-call rules. Anything else falls back to base.
export const CampaignTypes = ['rtt_spanish', 'in_call_close', 'debt', 'other'] as const
export type CampaignType = (typeof CampaignTypes)[number]

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
  // RTT/Spanish-FE fields — optional so historical rows without them still validate.
  campaign_type: z.enum(CampaignTypes).optional().nullable(),
  // The LLM occasionally invents adjacent tag names (e.g. "misleading_ad_mention" — which is
  // a compliance flag, not an objection). Accept any string array and filter to the allowed
  // enum values at parse time so one hallucinated tag doesn't kill the whole analysis.
  objection_tags: z.array(z.string()).optional().nullable().transform(
    (arr) => arr?.filter((t): t is RttObjectionTag => (RttObjectionTags as readonly string[]).includes(t)) ?? null
  ),
  // 0-10 rating of how cleanly the qualifier handed off to the licensed advisor.
  // Only meaningful when campaign_type = 'rtt_spanish' AND a transfer happened.
  handoff_smoothness: z.number().int().min(0).max(10).optional().nullable(),
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
