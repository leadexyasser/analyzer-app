'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'

interface Props {
  dateFrom: string
  dateTo: string
}

export function ReanalyzeAllButton({ dateFrom, dateTo }: Props) {
  const [state, setState] = useState<'idle' | 'confirming' | 'loading'>('idle')

  const handleClick = async () => {
    if (state === 'idle') { setState('confirming'); return }
    setState('loading')
    try {
      const res = await fetch('/api/calls/reanalyze-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: dateFrom, to: dateTo }),
      })
      const json = await res.json()
      if (res.ok) {
        toast.success(`Re-analyzing ${json.queued} call${json.queued !== 1 ? 's' : ''} — check back in a few minutes`)
      } else {
        toast.error(json.error ?? 'Failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setState('idle')
    }
  }

  if (state === 'confirming') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span style={{ color: 'var(--rb-text-3)' }}>Re-analyze all calls in range?</span>
        <button
          onClick={handleClick}
          className="px-2.5 py-1 rounded-lg text-xs font-bold"
          style={{ background: 'var(--rb-amber)', color: '#0d1117' }}
        >
          Yes
        </button>
        <button
          onClick={() => setState('idle')}
          className="px-2.5 py-1 rounded-lg text-xs font-bold"
          style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === 'loading'}
      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
      style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)', color: 'var(--rb-text-2)' }}
    >
      <RefreshCw size={11} className={state === 'loading' ? 'animate-spin' : ''} />
      {state === 'loading' ? 'Queuing…' : 'Re-analyze All'}
    </button>
  )
}
