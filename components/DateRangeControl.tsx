'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

const PRESETS = [
  { label: 'Today',  days: 0 },
  { label: '7d',     days: 7 },
  { label: '30d',    days: 30 },
  { label: '90d',    days: 90 },
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
}

export function DateRangeControl() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const currentFrom = sp.get('from') ?? ''
  const currentTo   = sp.get('to')   ?? ''
  const currentPreset = sp.get('preset') ?? '7d'

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

  function applyCustom() {
    if (!from && !to) return
    const params = new URLSearchParams(sp.toString())
    params.set('preset', 'custom')
    if (from) params.set('from', from)
    else params.delete('from')
    if (to) params.set('to', to)
    else params.delete('to')
    router.push(`${pathname}?${params}`)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Preset buttons */}
      <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--rb-border-2)' }}>
        {PRESETS.map(p => {
          const active = currentPreset === p.label
          return (
            <button
              key={p.label}
              onClick={() => applyPreset(p.label)}
              className="text-xs font-medium px-3 py-1.5 transition-colors"
              style={{
                background: active ? 'var(--rb-accent)' : 'var(--rb-surface)',
                color: active ? '#0d1117' : 'var(--rb-text-2)',
                borderRight: '1px solid var(--rb-border-2)',
              }}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Custom range */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          onChange={e => setFrom(e.target.value)}
          style={inputStyle}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--rb-accent)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--rb-border-2)')}
        />
        <span className="text-xs" style={{ color: 'var(--rb-text-3)' }}>→</span>
        <input
          type="date"
          value={to}
          onChange={e => setTo(e.target.value)}
          style={inputStyle}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--rb-accent)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--rb-border-2)')}
        />
        <button
          onClick={applyCustom}
          disabled={!from && !to}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          style={{ background: 'var(--rb-surface-2)', border: '1px solid var(--rb-border-2)', color: 'var(--rb-text-2)' }}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
