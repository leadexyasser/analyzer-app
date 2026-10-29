import type { Metadata } from 'next'
import { CampaignDashboard } from '@/components/CampaignDashboard'
import { CAMPAIGNS } from '@/lib/campaigns'

export const revalidate = 30
export const metadata: Metadata = { title: 'English FE · Dashboard' }

export default async function EnglishDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const c = CAMPAIGNS.english
  return (
    <CampaignDashboard
      title={c.title}
      subtitle={c.subtitle}
      campaignScope={c.scope}
      searchParams={sp}
    />
  )
}
