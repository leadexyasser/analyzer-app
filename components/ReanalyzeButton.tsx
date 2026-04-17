'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface Props {
  callId: string
  onSuccess?: () => void
  size?: 'sm' | 'md'
}

export function ReanalyzeButton({ callId, onSuccess, size = 'md' }: Props) {
  const [loading, setLoading] = useState(false)

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setLoading(true)
    try {
      const res = await fetch(`/api/calls/${callId}/reanalyze`, { method: 'POST' })
      if (res.ok) {
        toast.success('Re-analysis started — refresh in ~60s')
        onSuccess?.()
      } else {
        toast.error((await res.json()).error ?? 'Failed')
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
      className="font-bold rounded-lg whitespace-nowrap disabled:opacity-50 transition-colors"
      style={{
        background: 'var(--rb-accent)',
        color: '#0d1117',
        fontSize: size === 'sm' ? '10px' : '12px',
        padding: size === 'sm' ? '4px 10px' : '6px 14px',
      }}
    >
      {loading ? 'Starting…' : 'Re-analyze'}
    </button>
  )
}
