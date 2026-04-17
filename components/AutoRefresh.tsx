'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

const INTERVAL_MS = 30_000

export function AutoRefresh() {
  const router = useRouter()
  const [auto, setAuto] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [countdown, setCountdown] = useState(INTERVAL_MS / 1000)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function refresh() {
    startTransition(() => router.refresh())
  }

  function clearTimers() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }

  useEffect(() => {
    if (!auto) { clearTimers(); setCountdown(INTERVAL_MS / 1000); return }

    setCountdown(INTERVAL_MS / 1000)

    intervalRef.current = setInterval(() => {
      startTransition(() => router.refresh())
      setCountdown(INTERVAL_MS / 1000)
    }, INTERVAL_MS)

    countdownRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1))
    }, 1000)

    return clearTimers
  }, [auto, router])

  return (
    <div className="flex items-center gap-2">
      {/* Manual refresh */}
      <button
        onClick={refresh}
        disabled={isPending}
        title="Refresh now"
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        style={{
          background: 'var(--rb-surface)',
          border: '1px solid var(--rb-border-2)',
          color: 'var(--rb-text-2)',
        }}
      >
        <RefreshCw size={12} className={isPending ? 'animate-spin' : ''} />
        Refresh
      </button>

      {/* Auto-refresh toggle */}
      <button
        onClick={() => setAuto(a => !a)}
        className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        style={{
          background: auto ? 'var(--rb-accent)22' : 'var(--rb-surface)',
          border: `1px solid ${auto ? 'var(--rb-accent)44' : 'var(--rb-border-2)'}`,
          color: auto ? 'var(--rb-accent)' : 'var(--rb-text-2)',
        }}
      >
        {/* Toggle pill */}
        <span
          className="relative inline-flex items-center w-7 h-4 rounded-full transition-colors shrink-0"
          style={{ background: auto ? 'var(--rb-accent)' : 'var(--rb-border-2)' }}
        >
          <span
            className="absolute w-3 h-3 rounded-full transition-transform"
            style={{
              background: '#fff',
              transform: auto ? 'translateX(14px)' : 'translateX(2px)',
              boxShadow: '0 1px 2px rgba(0,0,0,.4)',
            }}
          />
        </span>
        Auto
        {auto && (
          <span className="tabular-nums" style={{ color: 'var(--rb-text-3)', fontSize: '10px' }}>
            {countdown}s
          </span>
        )}
      </button>
    </div>
  )
}
