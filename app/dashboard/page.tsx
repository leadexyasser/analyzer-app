import { redirect } from 'next/navigation'
import { DEFAULT_CAMPAIGN } from '@/lib/campaigns'

export default function DashboardIndex() {
  redirect(`/dashboard/${DEFAULT_CAMPAIGN}`)
}
