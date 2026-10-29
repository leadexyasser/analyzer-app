export type CampaignSlug = 'spanish' | 'english'

export type CampaignConfig = {
  slug: CampaignSlug
  title: string
  subtitle: string
  // Ringba's `campaign_name` value as it lands in the DB. Exact match.
  scope: string
}

export const CAMPAIGNS: Record<CampaignSlug, CampaignConfig> = {
  spanish: {
    slug: 'spanish',
    title: 'Final Expense · Spanish',
    subtitle: 'ES FE PPC',
    scope: '(3600) Spanish Final Expense - Inbounds',
  },
  english: {
    slug: 'english',
    title: 'Final Expense · English',
    subtitle: 'EN FE PPC',
    // Ringba renamed the campaign on ~2026-09 — was "(2647) Final Expense - Master".
    scope: 'Final Expense | English',
  },
}

export const DEFAULT_CAMPAIGN: CampaignSlug = 'spanish'
