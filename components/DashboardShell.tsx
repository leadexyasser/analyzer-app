'use client'

import { useState } from 'react'
import { NavLinks } from '@/components/NavLinks'
import { LogoutButton } from '@/components/LogoutButton'

interface Props {
  email: string
  children: React.ReactNode
}

export function DashboardShell({ email, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--background)' }}>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 md:hidden"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className="fixed md:sticky top-0 left-0 z-30 w-56 flex-shrink-0 flex flex-col h-screen"
        style={{
          background: 'var(--rb-sidebar)',
          borderRight: '1px solid var(--rb-border)',
          transform: sidebarOpen ? 'translateX(0)' : undefined,
          transition: 'transform 200ms ease',
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

        <NavLinks />

        {/* User */}
        <div className="px-3 py-4 space-y-2" style={{ borderTop: '1px solid var(--rb-border)' }}>
          <div className="flex items-center gap-2 px-1">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
            >
              {email[0]?.toUpperCase() ?? '?'}
            </div>
            <p className="text-[11px] truncate flex-1" title={email} style={{ color: 'var(--rb-text-2)' }}>
              {email}
            </p>
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* Sidebar hidden on mobile by default */}
      <style>{`
        @media (max-width: 767px) {
          aside { transform: translateX(-100%); }
        }
      `}</style>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="h-12 flex items-center px-4 md:px-6 shrink-0"
          style={{ borderBottom: '1px solid var(--rb-border)', background: 'var(--rb-sidebar)' }}
        >
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden flex flex-col justify-center gap-1 w-8 h-8 rounded-md mr-3"
            style={{ color: 'var(--rb-text-2)' }}
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Open navigation menu"
          >
            <span className="block h-0.5 w-5 rounded-full" style={{ background: 'currentColor' }} />
            <span className="block h-0.5 w-5 rounded-full" style={{ background: 'currentColor' }} />
            <span className="block h-0.5 w-5 rounded-full" style={{ background: 'currentColor' }} />
          </button>

          {/* App name — mobile only */}
          <span className="md:hidden text-xs font-bold" style={{ color: 'var(--rb-text)' }}>Call Analyzer</span>

          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--rb-text-2)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--rb-green)' }} />
              Live
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
