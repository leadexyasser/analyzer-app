'use client'

import { useState } from 'react'
import { toast } from 'sonner'

export function RetryStuckButton() {
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/jobs/retry-stuck', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        const total = (data.reset ?? 0) + (data.requeued ?? 0)
        if (total === 0) toast.success('No stuck calls — everything is processing')
        else toast.success(`Restarted ${total} stuck call${total !== 1 ? 's' : ''}`)
      } else {
        toast.error('Failed to retry stuck calls')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
      style={{
        background: 'var(--rb-surface)',
        border: '1px solid var(--rb-border-2)',
        color: 'var(--rb-text-2)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--rb-accent)'
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--rb-accent)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--rb-border-2)'
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--rb-text-2)'
      }}
    >
      <span className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : 'bg-[#283347]'}`} />
      {loading ? 'Restarting…' : 'Retry stuck calls'}
    </button>
  )
}
