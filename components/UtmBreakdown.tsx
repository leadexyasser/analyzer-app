'use client'

import { useState } from 'react'

export interface UtmRow {
  name: string
  incoming: number
  completed: number
  closed: number
  revenue: number
  payout: number
  duplicates: number
  avgQuality: number | null
}

export type UtmTag = 'utm_content' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_id'

interface Props {
  byUtm: Record<UtmTag, UtmRow[]>
}

const TAG_LABELS: { key: UtmTag; label: string }[] = [
  { key: 'utm_content',  label: 'utm_content' },
  { key: 'utm_source',   label: 'utm_source' },
  { key: 'utm_medium',   label: 'utm_medium' },
  { key: 'utm_campaign', label: 'utm_campaign' },
  { key: 'utm_id',       label: 'utm_id' },
]

function money(v: number) { return v === 0 ? '$0' : `$${v.toFixed(0)}` }

function TH({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={{ color: 'var(--rb-text-3)', background: 'var(--rb-sidebar)', borderBottom: '1px solid var(--rb-border)' }}
    >
      {children}
    </th>
  )
}

function TD({ children, right = false, accent = false }: { children: React.ReactNode; right?: boolean; accent?: boolean }) {
  return (
    <td
      className={`px-4 py-2.5 text-xs whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={{ color: accent ? 'var(--rb-accent)' : 'var(--rb-text-2)', borderBottom: '1px solid var(--rb-border)' }}
    >
      {children}
    </td>
  )
}

export function UtmBreakdown({ byUtm }: Props) {
  const [tag, setTag] = useState<UtmTag>('utm_content')
  const rows = byUtm[tag] ?? []

  const totals = rows.reduce(
    (acc, r) => ({
      incoming: acc.incoming + r.incoming,
      completed: acc.completed + r.completed,
      closed: acc.closed + r.closed,
      revenue: acc.revenue + r.revenue,
      payout: acc.payout + r.payout,
      duplicates: acc.duplicates + r.duplicates,
      qSum: acc.qSum + (r.avgQuality ?? 0),
      qCount: acc.qCount + (r.avgQuality != null ? 1 : 0),
    }),
    { incoming: 0, completed: 0, closed: 0, revenue: 0, payout: 0, duplicates: 0, qSum: 0, qCount: 0 }
  )
  const totalAvgQuality = totals.qCount > 0 ? Math.round(totals.qSum / totals.qCount) : null

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
      {/* Header + UTM tag selector */}
      <div className="flex items-center gap-1 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--rb-border)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest mr-4" style={{ color: 'var(--rb-text-3)' }}>UTM Breakdown</p>
        {TAG_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTag(key)}
            className="text-xs font-mono px-3 py-1.5 rounded-md transition-colors hover:bg-[var(--rb-surface-2)] focus-visible:bg-[var(--rb-surface-2)]"
            style={{
              background: tag === key ? 'var(--rb-accent)' + '22' : undefined,
              color: tag === key ? 'var(--rb-accent)' : 'var(--rb-text-3)',
              border: `1px solid ${tag === key ? 'var(--rb-accent)' + '44' : 'transparent'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <TH>{tag}</TH>
              <TH right>Calls</TH>
              <TH right>Completed</TH>
              <TH right>Closed</TH>
              <TH right>Close Rate</TH>
              <TH right>Revenue</TH>
              <TH right>Avg Quality</TH>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--rb-text-3)' }}>
                      <circle cx="14" cy="14" r="11" /><path d="M9 14h10M14 9v10" strokeLinecap="round" opacity=".4" />
                    </svg>
                    <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>No data for this period</p>
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {rows.map((row, i) => {
                  const closeRate = row.completed > 0 ? Math.round((row.closed / row.completed) * 100) : 0
                  return (
                    <tr
                      key={i}
                      style={{ background: i % 2 === 0 ? 'transparent' : 'var(--rb-sidebar)' + '66' }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--rb-surface-2)'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? 'transparent' : 'var(--rb-sidebar)' + '66'}
                    >
                      <TD>
                        <span
                          className="max-w-[260px] truncate block font-mono"
                          style={{ color: row.name === '(none)' ? 'var(--rb-text-3)' : 'var(--rb-text)' }}
                          title={row.name}
                        >
                          {row.name}
                        </span>
                      </TD>
                      <TD right>{row.incoming}</TD>
                      <TD right>
                        <span style={{ color: row.completed > 0 ? 'var(--rb-text-2)' : 'var(--rb-text-3)' }}>{row.completed}</span>
                      </TD>
                      <TD right>
                        <span style={{ color: row.closed > 0 ? 'var(--rb-green)' : 'var(--rb-text-3)' }}>{row.closed}</span>
                      </TD>
                      <TD right>
                        <span style={{ color: closeRate >= 10 ? 'var(--rb-green)' : closeRate > 0 ? 'var(--rb-amber)' : 'var(--rb-text-3)' }}>
                          {row.completed > 0 ? `${closeRate}%` : '—'}
                        </span>
                      </TD>
                      <TD right accent>{money(row.revenue)}</TD>
                      <TD right>
                        {row.avgQuality == null
                          ? <span style={{ color: 'var(--rb-text-3)' }}>—</span>
                          : <span style={{ color: row.avgQuality >= 70 ? 'var(--rb-green)' : row.avgQuality >= 40 ? 'var(--rb-amber)' : 'var(--rb-red)' }}>
                              {row.avgQuality}
                            </span>}
                      </TD>
                    </tr>
                  )
                })}
                <tr style={{ borderTop: '2px solid var(--rb-border-2)', background: 'var(--rb-sidebar)' }}>
                  <td className="px-4 py-2.5 text-xs font-bold" style={{ color: 'var(--rb-text-3)' }}>Totals</td>
                  <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text)' }}>{totals.incoming}</td>
                  <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text)' }}>{totals.completed}</td>
                  <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-green)' }}>{totals.closed}</td>
                  <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text-3)' }}>
                    {totals.completed > 0 ? `${Math.round((totals.closed / totals.completed) * 100)}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-accent)' }}>{money(totals.revenue)}</td>
                  <td className="px-4 py-2.5 text-xs font-bold text-right" style={{
                    color: totalAvgQuality == null ? 'var(--rb-text-3)'
                      : totalAvgQuality >= 70 ? 'var(--rb-green)'
                      : totalAvgQuality >= 40 ? 'var(--rb-amber)'
                      : 'var(--rb-red)',
                  }}>
                    {totalAvgQuality ?? '—'}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
