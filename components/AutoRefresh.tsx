'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

const INTERVAL_MS = 30_000

function relativeTime(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 10) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

export function AutoRefresh() {
  const router = useRouter()
  const [auto, setAuto] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [countdown, setCountdown] = useState(INTERVAL_MS / 1000)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [relLabel, setRelLabel] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const relRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function doRefresh() {
    startTransition(() => {
      router.refresh()
      const now = new Date()
      setLastUpdated(now)
      setRelLabel(relativeTime(now))
    })
  }

  function clearTimers() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }

  useEffect(() => {
    if (!auto) { clearTimers(); setCountdown(INTERVAL_MS / 1000); return }

    setCountdown(INTERVAL_MS / 1000)

    intervalRef.current = setInterval(() => {
      doRefresh()
      setCountdown(INTERVAL_MS / 1000)
    }, INTERVAL_MS)

    countdownRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1))
    }, 1000)

    return clearTimers
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, router])

  // Update relative label every 30s
  useEffect(() => {
    if (!lastUpdated) return
    relRef.current = setInterval(() => setRelLabel(relativeTime(lastUpdated)), 30_000)
    return () => { if (relRef.current) clearInterval(relRef.current) }
  }, [lastUpdated])

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Manual refresh */}
      <button
        onClick={doRefresh}
        disabled={isPending}
        title="Refresh now"
        aria-label="Refresh now"
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
        aria-pressed={auto}
        aria-label="Auto-refresh"
        className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        style={{
          background: auto ? 'var(--rb-accent)22' : 'var(--rb-surface)',
          border: `1px solid ${auto ? 'var(--rb-accent)44' : 'var(--rb-border-2)'}`,
          color: auto ? 'var(--rb-accent)' : 'var(--rb-text-2)',
        }}
      >
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

      {/* Last updated */}
      {relLabel && (
        <span className="tabular-nums" style={{ color: 'var(--rb-text-3)', fontSize: '10px' }}>
          Updated {relLabel}
        </span>
      )}
    </div>
  )
}
