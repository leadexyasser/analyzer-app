'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type State = 'idle' | 'confirming' | 'loading'

export function LogoutButton() {
  const router = useRouter()
  const [state, setState] = useState<State>('idle')

  const handleConfirm = async () => {
    setState('loading')
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (state === 'confirming') {
    return (
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-xs shrink-0" style={{ color: 'var(--rb-text-3)' }}>Sure?</span>
        <button
          onClick={handleConfirm}
          className="text-[11px] font-semibold px-2 py-1 rounded-md transition-opacity hover:opacity-80"
          style={{ background: 'var(--rb-red)', color: '#fff' }}
        >
          Yes
        </button>
        <button
          onClick={() => setState('idle')}
          className="text-[11px] px-2 py-1 rounded-md transition-opacity hover:opacity-80"
          style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)', border: '1px solid var(--rb-border-2)' }}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setState('confirming')}
      disabled={state === 'loading'}
      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 hover:bg-[var(--rb-surface-2)] focus-visible:bg-[var(--rb-surface-2)]"
      style={{ color: 'var(--rb-text-3)' }}
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M5 2H2v9h3M9 9l3-3-3-3M12 6H5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {state === 'loading' ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
