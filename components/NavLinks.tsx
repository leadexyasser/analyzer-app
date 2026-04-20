'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav className="flex-1 py-3 space-y-0.5 px-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest px-2 py-2" style={{ color: 'var(--rb-text-3)' }}>
        Analytics
      </p>
      {NAV.map(item => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors hover:bg-[var(--rb-surface-2)] focus-visible:bg-[var(--rb-surface-2)]"
            style={{
              background: active ? 'var(--rb-accent)22' : undefined,
              color: active ? 'var(--rb-accent)' : 'var(--rb-text-2)',
            }}
          >
            {item.icon}
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
