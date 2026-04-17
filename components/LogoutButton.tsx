'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
      style={{ color: 'var(--rb-text-3)', background: 'transparent' }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--rb-surface-2)'
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--rb-text)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--rb-text-3)'
      }}
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 2H2v9h3M9 9l3-3-3-3M12 6H5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Sign out
    </button>
  )
}
