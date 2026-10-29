import type { Metadata } from 'next'
import { CampaignDashboard } from '@/components/CampaignDashboard'
import { CAMPAIGNS } from '@/lib/campaigns'

export const revalidate = 30
export const metadata: Metadata = { title: 'Spanish FE · Dashboard' }

export default async function SpanishDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const c = CAMPAIGNS.spanish
  return (
    <CampaignDashboard
      title={c.title}
      subtitle={c.subtitle}
      campaignScope={c.scope}
      searchParams={sp}
    />
  )
}
