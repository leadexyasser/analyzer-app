'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
}

const NAV: NavItem[] = [
  {
    label: 'Final Expense',
    href: '/dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 2h12v2H2zM2 7h12v2H2zM2 12h8v2H2z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: 'Debt Spanish',
    href: '/dashboard/debt',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4v8M6 6h3.5a1.5 1.5 0 010 3H6M9.5 12H6" strokeLinecap="round" />
      </svg>
    ),
  },
]

// Longest matching prefix wins so /dashboard/debt doesn't also light up /dashboard.
function pickActive(pathname: string): string | null {
  const matches = NAV
    .filter(item => pathname === item.href || pathname.startsWith(item.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)
  return matches[0]?.href ?? null
}

export function NavLinks() {
  const pathname = usePathname()
  const activeHref = pickActive(pathname)

  return (
    <nav className="flex-1 py-3 space-y-0.5 px-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest px-2 py-2" style={{ color: 'var(--rb-text-3)' }}>
        Analytics
      </p>
      {NAV.map(item => {
        const active = activeHref === item.href
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
