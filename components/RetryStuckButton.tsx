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
        if (total === 0) {
          toast.success('No stuck calls found — everything looks good')
        } else {
          toast.success(`Restarted ${total} stuck call${total !== 1 ? 's' : ''} — processing now`)
        }
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
      className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors"
    >
      <span className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : 'bg-slate-300'}`} />
      {loading ? 'Restarting…' : 'Retry stuck calls'}
    </button>
  )
}
