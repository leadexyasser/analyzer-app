'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

const PRESETS = [
  { label: 'Today', days: 0 },
  { label: '7d',    days: 7 },
  { label: '30d',   days: 30 },
  { label: '90d',   days: 90 },
]

const inputStyle: React.CSSProperties = {
  background: 'var(--rb-surface-2)',
  border: '1px solid var(--rb-border-2)',
  color: 'var(--rb-text)',
  borderRadius: '0.375rem',
  fontSize: '12px',
  padding: '5px 10px',
  outline: 'none',
  colorScheme: 'dark',
  transition: 'border-color 150ms',
}

export function DateRangeControl() {
  const router   = useRouter()
  const pathname = usePathname()
  const sp       = useSearchParams()

  const currentPreset = sp.get('preset') ?? '7d'
  const currentFrom   = sp.get('from') ?? ''
  const currentTo     = sp.get('to')   ?? ''

  const [from, setFrom] = useState(currentFrom)
  const [to,   setTo]   = useState(currentTo)

  useEffect(() => { setFrom(currentFrom); setTo(currentTo) }, [currentFrom, currentTo])

  function applyPreset(preset: string) {
    const params = new URLSearchParams(sp.toString())
    params.set('preset', preset)
    params.delete('from')
    params.delete('to')
    router.push(`${pathname}?${params}`)
  }

  function applyCustom(newFrom: string, newTo: string) {
    if (!newFrom && !newTo) return
    const params = new URLSearchParams(sp.toString())
    params.set('preset', 'custom')
    if (newFrom) params.set('from', newFrom); else params.delete('from')
    if (newTo)   params.set('to',   newTo);   else params.delete('to')
    router.push(`${pathname}?${params}`)
  }

  const isCustomActive = currentPreset === 'custom'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Preset pills */}
      <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--rb-border-2)' }}>
        {PRESETS.map((p, i) => {
          const active = currentPreset === p.label
          return (
            <button
              key={p.label}
              onClick={() => applyPreset(p.label)}
              className="text-xs font-medium px-3 py-1.5 transition-colors"
              style={{
                background: active ? 'var(--rb-accent)' : 'var(--rb-surface)',
                color: active ? '#0d1117' : 'var(--rb-text-2)',
                borderRight: i < PRESETS.length - 1 ? '1px solid var(--rb-border-2)' : 'none',
              }}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Custom date range — auto-applies on blur when both fields touched */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          aria-label="From date"
          value={from}
          onChange={e => setFrom(e.target.value)}
          onBlur={e => { if (from !== currentFrom || to !== currentTo) applyCustom(e.target.value, to) }}
          style={{
            ...inputStyle,
            borderColor: isCustomActive && from ? 'var(--rb-accent)' : undefined,
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--rb-accent)')}
        />
        <span className="text-xs" style={{ color: 'var(--rb-text-3)' }}>→</span>
        <input
          type="date"
          aria-label="To date"
          value={to}
          onChange={e => setTo(e.target.value)}
          onBlur={e => { if (from !== currentFrom || to !== currentTo) applyCustom(from, e.target.value) }}
          style={{
            ...inputStyle,
            borderColor: isCustomActive && to ? 'var(--rb-accent)' : undefined,
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--rb-accent)')}
        />
      </div>
    </div>
  )
}
