// Shared scoring logic — used in server stats AND client components

export const FE_WEIGHTS = { age: 35, insurance: 30, bank: 20, afford: 15 } as const

export function computeFELeadQuality(fe: any): number | null {
  if (!fe) return null
  let num = 0, den = 0

  if (fe.age_verdict !== 'unknown') {
    den += FE_WEIGHTS.age
    num += fe.age_verdict === 'good' ? FE_WEIGHTS.age
      : fe.age_verdict === 'borderline' ? FE_WEIGHTS.age * 0.6
      : 0
  }
  if (fe.interested_in_life_insurance !== 'unclear') {
    den += FE_WEIGHTS.insurance
    num += fe.interested_in_life_insurance === 'yes' ? FE_WEIGHTS.insurance : 0
  }
  if (fe.has_bank_account !== 'unclear') {
    den += FE_WEIGHTS.bank
    num += fe.has_bank_account === 'yes' ? FE_WEIGHTS.bank : 0
  }
  if (fe.can_afford !== 'unclear') {
    den += FE_WEIGHTS.afford
    num += fe.can_afford === 'yes' ? FE_WEIGHTS.afford
      : fe.can_afford === 'concerns' ? FE_WEIGHTS.afford * 0.5
      : 0
  }

  if (den === 0) return null
  return Math.round((num / den) * 100)
}

export function hasComplianceIssue(fe: any): boolean {
  if (!fe) return false
  return !!(
    fe.free_government_mentions ||
    fe.outbound_call_claimed ||
    fe.ftc_regulatory_mention ||
    fe.scam_keywords_mentioned ||
    fe.misleading_ad_mention
  )
}

export const COMPLIANCE_FLAG_LABELS: Record<string, string> = {
  free_government_mentions: 'Free / Gov angle',
  outbound_call_claimed:    'Outbound claim',
  ftc_regulatory_mention:   'FTC / Regulatory',
  scam_keywords_mentioned:  'Scam keywords',
  misleading_ad_mention:    'Misleading ad',
}
