import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LogoutButton } from '@/components/LogoutButton'

const NAV = [
  {
    label: 'Call Logs',
    href: '/dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 2h12v2H2zM2 7h12v2H2zM2 12h8v2H2z" strokeLinejoin="round" />
      </svg>
    ),
  },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--background)' }}>

      {/* ── Sidebar ── */}
      <aside
        className="w-56 flex-shrink-0 flex flex-col"
        style={{
          background: 'var(--rb-sidebar)',
          borderRight: '1px solid var(--rb-border)',
          minHeight: '100vh',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        {/* Brand */}
        <div className="px-4 py-5" style={{ borderBottom: '1px solid var(--rb-border)' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center font-black text-sm"
              style={{ background: 'var(--rb-accent)', color: '#0d1117' }}
            >
              CA
            </div>
            <div>
              <p className="text-xs font-bold leading-tight" style={{ color: 'var(--rb-text)' }}>Call Analyzer</p>
              <p className="text-[10px]" style={{ color: 'var(--rb-text-3)' }}>Final Expense</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 space-y-0.5 px-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest px-2 py-2" style={{ color: 'var(--rb-text-3)' }}>
            Analytics
          </p>
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors"
              style={{ background: 'var(--rb-accent)' + '22', color: 'var(--rb-accent)' }}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="px-3 py-4 space-y-2" style={{ borderTop: '1px solid var(--rb-border)' }}>
          <div className="flex items-center gap-2 px-1">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
            >
              {user.email?.[0]?.toUpperCase()}
            </div>
            <p className="text-[11px] truncate flex-1" style={{ color: 'var(--rb-text-2)' }}>
              {user.email}
            </p>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="h-12 flex items-center px-6 shrink-0"
          style={{ borderBottom: '1px solid var(--rb-border)', background: 'var(--rb-sidebar)' }}
        >
          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--rb-text-2)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
