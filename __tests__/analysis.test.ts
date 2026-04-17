import { describe, it, expect } from 'vitest'
import { AnalysisSchema } from '../types/analysis'

const validAnalysis = {
  summary: 'The caller inquired about auto insurance rates.',
  language: 'en',
  agent_speaker: 'Speaker A',
  quality_score: 75,
  quality_breakdown: {
    agent_professionalism: 8,
    caller_engagement: 7,
    qualification_completeness: 8,
    call_outcome_clarity: 7,
  },
  call_outcome: 'transferred',
  outcome_confidence: 'high',
  extracted_data: {
    caller_stated_name: 'John Smith',
    caller_location_state: 'California',
    intent_or_need: 'Looking for cheaper auto insurance',
    objections_raised: ['Too expensive'],
    commitments_made: ['Will review quote'],
    payment_info_collected: false,
    callback_requested: false,
  },
  flags: [],
  flag_details: {},
  coaching_notes: null,
}

describe('AnalysisSchema', () => {
  it('validates a complete valid analysis', () => {
    expect(() => AnalysisSchema.parse(validAnalysis)).not.toThrow()
  })

  it('rejects quality_score out of range', () => {
    expect(() => AnalysisSchema.parse({ ...validAnalysis, quality_score: 150 })).toThrow()
    expect(() => AnalysisSchema.parse({ ...validAnalysis, quality_score: -1 })).toThrow()
  })

  it('rejects invalid call_outcome', () => {
    expect(() => AnalysisSchema.parse({ ...validAnalysis, call_outcome: 'invalid_outcome' })).toThrow()
  })

  it('rejects invalid language', () => {
    expect(() => AnalysisSchema.parse({ ...validAnalysis, language: 'fr' })).toThrow()
  })

  it('allows null coaching_notes', () => {
    const result = AnalysisSchema.parse({ ...validAnalysis, coaching_notes: null })
    expect(result.coaching_notes).toBeNull()
  })

  it('allows empty flags array', () => {
    const result = AnalysisSchema.parse({ ...validAnalysis, flags: [] })
    expect(result.flags).toEqual([])
  })
})
