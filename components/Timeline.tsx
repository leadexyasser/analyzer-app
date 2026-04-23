'use client'

import { useMemo } from 'react'

interface Props {
  hourly: number[]
  timezone?: string
}

export function Timeline({ hourly }: Props) {
  const max = Math.max(...hourly, 1)
  const W = 1000
  const H = 100
  const PAD_L = 28
  const PAD_B = 24
  const PAD_T = 12
  const chartW = W - PAD_L
  const chartH = H - PAD_B - PAD_T
  const barW = Math.floor(chartW / 24) - 2
  const now = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Etc/GMT+5', hour: '2-digit', hour12: false }).format(new Date())
  )

  const bars = useMemo(() =>
    hourly.map((count, h) => {
      const x = PAD_L + Math.round((h / 24) * chartW) + 1
      const barH = count === 0 ? 2 : Math.max(4, Math.round((count / max) * chartH))
      const y = PAD_T + chartH - barH
      const isNow = h === now
      const past = h < now
      return { x, y, barH, count, h, isNow, past }
    }), [hourly, max, now, chartH])

  const xTicks = [0, 3, 6, 9, 12, 15, 18, 21]

  const fmtHour = (h: number) => {
    if (h === 0) return '12 AM'
    if (h === 12) return '12 PM'
    return h < 12 ? `${h} AM` : `${h - 12} PM`
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>
          Timeline — Today (by hour)
        </p>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--rb-text-3)' }}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-2 rounded-sm" style={{ background: 'var(--rb-accent)' }} />
            Calls
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', overflow: 'visible' }}
        aria-label="Calls per hour today"
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map(pct => {
          const y = PAD_T + chartH - Math.round(pct * chartH)
          const val = Math.round(pct * max)
          return (
            <g key={pct}>
              <line x1={PAD_L} y1={y} x2={W} y2={y} stroke="#1e2d40" strokeWidth="1" strokeDasharray="4 4" />
              <text x={PAD_L - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#4d6078">{val}</text>
            </g>
          )
        })}

        {/* Bars */}
        {bars.map(({ x, y, barH, count, h, isNow, past }) => (
          <g key={h}>
            {/* Actual bar */}
            <rect
              x={x} y={y} width={barW} height={barH} rx="2"
              fill={
                count === 0 ? '#1e2d40'
                : isNow ? '#00c9a7'
                : past ? '#00c9a766'
                : '#1e2d40'
              }
            />
            {/* Full-height hover overlay for tooltip discovery (including zero-count hours) */}
            <rect
              x={x} y={PAD_T} width={barW} height={chartH} rx="2"
              fill="transparent"
            >
              <title>{count === 0 ? `No calls at ${fmtHour(h)}` : `${fmtHour(h)}: ${count} call${count !== 1 ? 's' : ''}`}</title>
            </rect>
          </g>
        ))}

        {/* X-axis line */}
        <line x1={PAD_L} y1={PAD_T + chartH} x2={W} y2={PAD_T + chartH} stroke="#1e2d40" strokeWidth="1" />

        {/* X-axis labels */}
        {xTicks.map(h => {
          const x = PAD_L + Math.round((h / 24) * chartW) + barW / 2
          return (
            <text key={h} x={x} y={H - 6} textAnchor="middle" fontSize="9" fill="#4d6078">
              {fmtHour(h)}
            </text>
          )
        })}

        {/* "Now" marker */}
        {(() => {
          const x = PAD_L + Math.round((now / 24) * chartW) + barW / 2
          return (
            <g>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + chartH} stroke="#00c9a7" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
              <text x={x} y={PAD_T - 2} textAnchor="middle" fontSize="8" fill="#00c9a7">now</text>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
