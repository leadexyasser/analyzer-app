import type { Metadata } from 'next'
import { AnalysisDashboard } from '@/components/AnalysisDashboard'
import { CAMPAIGNS } from '@/lib/campaigns'

// Always render fresh: the page re-syncs Meta spend when it has gone stale, so a cached
// render would serve figures the sync had already superseded.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Analysis · Spend & Profit' }

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  return <AnalysisDashboard campaignScope={CAMPAIGNS.spanish.scope} searchParams={sp} />
}
