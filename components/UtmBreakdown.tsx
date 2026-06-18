'use client'

import { useMemo, useState } from 'react'

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

type SortCol = 'name' | 'incoming' | 'completed' | 'closed' | 'closeRate' | 'revenue' | 'cpa' | 'avgQuality'
type SortDir = 'asc' | 'desc'

const TAG_LABELS: { key: UtmTag; label: string }[] = [
  { key: 'utm_content',  label: 'utm_content' },
  { key: 'utm_source',   label: 'utm_source' },
  { key: 'utm_medium',   label: 'utm_medium' },
  { key: 'utm_campaign', label: 'utm_campaign' },
  { key: 'utm_id',       label: 'utm_id' },
]

function money(v: number) { return v === 0 ? '$0' : `$${v.toFixed(0)}` }

// Compute the derived numbers used for sorting / display so we don't recompute inline.
function derive(r: UtmRow) {
  const closeRate = r.completed > 0 ? (r.closed / r.completed) * 100 : -1 // -1 sentinel so 0% calls rank below valid 0%
  const cpa = r.closed > 0 ? r.revenue / r.closed : null
  return { closeRate, cpa }
}

function SortableTH({
  children, col, right = false, sort, setSort,
}: {
  children: React.ReactNode
  col: SortCol
  right?: boolean
  sort: { col: SortCol; dir: SortDir }
  setSort: (s: { col: SortCol; dir: SortDir }) => void
}) {
  const active = sort.col === col
  const indicator = active ? (sort.dir === 'desc' ? '▼' : '▲') : ''
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${right ? 'text-right' : 'text-left'} cursor-pointer select-none transition-colors hover:bg-[var(--rb-surface-2)]`}
      style={{ color: active ? 'var(--rb-accent)' : 'var(--rb-text-3)', background: 'var(--rb-sidebar)', borderBottom: '1px solid var(--rb-border)' }}
      onClick={() => {
        // Click cycles: toggle direction when same column; switch column resets to desc (most useful default for numeric stats).
        if (sort.col === col) setSort({ col, dir: sort.dir === 'desc' ? 'asc' : 'desc' })
        else setSort({ col, dir: col === 'name' ? 'asc' : 'desc' })
      }}
    >
      <span className={`inline-flex items-center gap-1.5 ${right ? 'justify-end w-full' : ''}`}>
        {children}
        <span className="text-[9px] tabular-nums" style={{ width: 10, color: active ? 'var(--rb-accent)' : 'var(--rb-text-3)', opacity: active ? 1 : 0.35 }}>
          {active ? indicator : '⇅'}
        </span>
      </span>
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
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: 'incoming', dir: 'desc' })
  const rows = byUtm[tag] ?? []

  const sortedRows = useMemo(() => {
    const dir = sort.dir === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      const da = derive(a)
      const db = derive(b)

      // Pull the comparator value for the active column. Nulls always sort to the bottom
      // regardless of direction — "no value" shouldn't beat valid measurements.
      const valueOf = (r: UtmRow, d: { closeRate: number; cpa: number | null }): number | string | null => {
        switch (sort.col) {
          case 'name':       return r.name
          case 'incoming':   return r.incoming
          case 'completed':  return r.completed
          case 'closed':     return r.closed
          case 'closeRate':  return d.closeRate < 0 ? null : d.closeRate
          case 'revenue':    return r.revenue
          case 'cpa':        return d.cpa
          case 'avgQuality': return r.avgQuality
        }
      }
      const va = valueOf(a, da)
      const vb = valueOf(b, db)

      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1

      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir
      return ((va as number) - (vb as number)) * dir
    })
  }, [rows, sort])

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
  const totalCloseRate  = totals.completed > 0 ? Math.round((totals.closed / totals.completed) * 100) : null
  const totalCpa        = totals.closed > 0 ? totals.revenue / totals.closed : null

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
              <SortableTH col="name"       sort={sort} setSort={setSort}>{tag}</SortableTH>
              <SortableTH col="incoming"   right sort={sort} setSort={setSort}>Calls</SortableTH>
              <SortableTH col="completed"  right sort={sort} setSort={setSort}>Completed</SortableTH>
              <SortableTH col="closed"     right sort={sort} setSort={setSort}>Closed</SortableTH>
              <SortableTH col="closeRate"  right sort={sort} setSort={setSort}>Close Rate</SortableTH>
              <SortableTH col="revenue"    right sort={sort} setSort={setSort}>Revenue</SortableTH>
              <SortableTH col="cpa"        right sort={sort} setSort={setSort}>CPA</SortableTH>
              <SortableTH col="avgQuality" right sort={sort} setSort={setSort}>Avg Quality</SortableTH>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={8}>
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
                {sortedRows.map((row, i) => {
                  const { closeRate: rawRate, cpa } = derive(row)
                  const closeRate = rawRate < 0 ? null : Math.round(rawRate)
                  return (
                    <tr
                      key={`${tag}-${row.name}-${i}`}
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
                        {closeRate == null
                          ? <span style={{ color: 'var(--rb-text-3)' }}>—</span>
                          : <span style={{ color: closeRate >= 10 ? 'var(--rb-green)' : closeRate > 0 ? 'var(--rb-amber)' : 'var(--rb-text-3)' }}>
                              {closeRate}%
                            </span>}
                      </TD>
                      <TD right accent>{money(row.revenue)}</TD>
                      <TD right>
                        {cpa != null
                          ? <span className="font-bold" style={{ color: 'var(--rb-text)' }}>${cpa.toFixed(0)}</span>
                          : <span style={{ color: 'var(--rb-text-3)' }}>—</span>}
                      </TD>
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
                    {totalCloseRate == null ? '—' : `${totalCloseRate}%`}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-accent)' }}>{money(totals.revenue)}</td>
                  <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text)' }}>
                    {totalCpa != null ? `$${totalCpa.toFixed(0)}` : '—'}
                  </td>
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
