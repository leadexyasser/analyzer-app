import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/DashboardShell'
import { getSessionFromRequest } from '@/lib/auth'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionFromRequest()
  if (!session) redirect('/login')

  return (
    <DashboardShell email={session.email}>
      {children}
    </DashboardShell>
  )
}
