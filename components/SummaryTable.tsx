'use client'

import { useState } from 'react'

interface Row {
  name: string
  incoming: number
  completed: number
  revenue: number
  payout: number
  duplicates: number
  avgQuality: number | null
}

interface TargetRow {
  name: string
  incoming: number
  closed: number
  revenue: number
  cpa: number | null
}

interface Props {
  byCampaign: Row[]
  byPublisher: Row[]
  byTarget: TargetRow[]
}

type Tab = 'campaign' | 'publisher' | 'target'

function money(v: number) {
  return v === 0 ? '$0' : `$${v.toFixed(2)}`
}

function TH({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
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

export function SummaryTable({ byCampaign, byPublisher, byTarget }: Props) {
  const [tab, setTab] = useState<Tab>('campaign')

  const TH_label = tab === 'campaign' ? 'Campaign' : tab === 'publisher' ? 'Publisher' : 'Target (Buyer)'

  const totals = tab !== 'target'
    ? (tab === 'campaign' ? byCampaign : byPublisher).reduce(
        (acc, r) => ({
          incoming: acc.incoming + r.incoming,
          completed: acc.completed + r.completed,
          revenue: acc.revenue + r.revenue,
          payout: acc.payout + r.payout,
          duplicates: acc.duplicates + r.duplicates,
        }),
        { incoming: 0, completed: 0, revenue: 0, payout: 0, duplicates: 0 }
      )
    : null

  const targetTotals = tab === 'target'
    ? byTarget.reduce((acc, r) => ({
        incoming: acc.incoming + r.incoming,
        closed: acc.closed + r.closed,
        revenue: acc.revenue + r.revenue,
      }), { incoming: 0, closed: 0, revenue: 0 })
    : null

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: 'campaign',  label: 'Campaign' },
    { key: 'publisher', label: 'Publisher' },
    { key: 'target',    label: 'Target CPA' },
  ]

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}
    >
      {/* Tabs */}
      <div
        className="flex items-center gap-1 px-4 py-3"
        style={{ borderBottom: '1px solid var(--rb-border)' }}
      >
        <p className="text-[10px] font-bold uppercase tracking-widest mr-4" style={{ color: 'var(--rb-text-3)' }}>
          Summary
        </p>
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: tab === key ? 'var(--rb-accent)' + '22' : 'transparent',
              color: tab === key ? 'var(--rb-accent)' : 'var(--rb-text-3)',
              border: `1px solid ${tab === key ? 'var(--rb-accent)' + '44' : 'transparent'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        {tab !== 'target' ? (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <TH>{TH_label}</TH>
                <TH right>Incoming</TH>
                <TH right>Completed</TH>
                <TH right>Revenue</TH>
                <TH right>Payout</TH>
                <TH right>Duplicates</TH>
                <TH right>Avg Quality</TH>
              </tr>
            </thead>
            <tbody>
              {(tab === 'campaign' ? byCampaign : byPublisher).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--rb-text-3)' }}>No data</td>
                </tr>
              ) : (
                <>
                  {(tab === 'campaign' ? byCampaign : byPublisher).map((row, i) => (
                    <tr
                      key={i}
                      style={{ background: i % 2 === 0 ? 'transparent' : 'var(--rb-sidebar)' + '66' }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--rb-surface-2)'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? 'transparent' : 'var(--rb-sidebar)' + '66'}
                    >
                      <TD>
                        <span className="max-w-[240px] truncate block" style={{ color: 'var(--rb-text)' }}>{row.name}</span>
                      </TD>
                      <TD right>{row.incoming}</TD>
                      <TD right>
                        <span style={{ color: row.completed > 0 ? 'var(--rb-green)' : 'var(--rb-text-2)' }}>{row.completed}</span>
                      </TD>
                      <TD right accent>{money(row.revenue)}</TD>
                      <TD right>{money(row.payout)}</TD>
                      <TD right>
                        {row.duplicates > 0
                          ? <span style={{ color: 'var(--rb-amber)' }}>{row.duplicates}</span>
                          : <span style={{ color: 'var(--rb-text-3)' }}>0</span>}
                      </TD>
                      <TD right>
                        {row.avgQuality == null
                          ? <span style={{ color: 'var(--rb-text-3)' }}>—</span>
                          : <span style={{ color: row.avgQuality >= 70 ? 'var(--rb-green)' : row.avgQuality >= 40 ? 'var(--rb-amber)' : 'var(--rb-red)' }}>
                              {row.avgQuality}
                            </span>}
                      </TD>
                    </tr>
                  ))}
                  {totals && (
                    <tr style={{ borderTop: '2px solid var(--rb-border-2)', background: 'var(--rb-sidebar)' }}>
                      <td className="px-4 py-2.5 text-xs font-bold" style={{ color: 'var(--rb-text-3)' }}>Totals</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text)' }}>{totals.incoming}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-green)' }}>{totals.completed}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-accent)' }}>{money(totals.revenue)}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text)' }}>{money(totals.payout)}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: totals.duplicates > 0 ? 'var(--rb-amber)' : 'var(--rb-text-3)' }}>{totals.duplicates}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--rb-text-3)' }} />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        ) : (
          /* Target CPA table */
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <TH>Target (Buyer)</TH>
                <TH right>Calls</TH>
                <TH right>Closed</TH>
                <TH right>Close Rate</TH>
                <TH right>Revenue Paid</TH>
                <TH right>CPA</TH>
              </tr>
            </thead>
            <tbody>
              {byTarget.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--rb-text-3)' }}>No data</td>
                </tr>
              ) : (
                <>
                  {byTarget.map((row, i) => {
                    const closeRate = row.incoming > 0 ? Math.round((row.closed / row.incoming) * 100) : 0
                    return (
                      <tr
                        key={i}
                        style={{ background: i % 2 === 0 ? 'transparent' : 'var(--rb-sidebar)' + '66' }}
                        onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--rb-surface-2)'}
                        onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? 'transparent' : 'var(--rb-sidebar)' + '66'}
                      >
                        <TD>
                          <span className="max-w-[240px] truncate block" style={{ color: 'var(--rb-text)' }}>{row.name}</span>
                        </TD>
                        <TD right>{row.incoming}</TD>
                        <TD right>
                          <span style={{ color: row.closed > 0 ? 'var(--rb-green)' : 'var(--rb-text-3)' }}>
                            {row.closed}
                          </span>
                        </TD>
                        <TD right>
                          <span style={{ color: closeRate > 0 ? 'var(--rb-green)' : 'var(--rb-text-3)' }}>
                            {closeRate}%
                          </span>
                        </TD>
                        <TD right accent>{money(row.revenue)}</TD>
                        <TD right>
                          {row.cpa != null
                            ? <span className="font-bold" style={{ color: 'var(--rb-text)' }}>${row.cpa.toFixed(0)}</span>
                            : <span style={{ color: 'var(--rb-text-3)' }}>—</span>}
                        </TD>
                      </tr>
                    )
                  })}
                  {targetTotals && (
                    <tr style={{ borderTop: '2px solid var(--rb-border-2)', background: 'var(--rb-sidebar)' }}>
                      <td className="px-4 py-2.5 text-xs font-bold" style={{ color: 'var(--rb-text-3)' }}>Totals</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text)' }}>{targetTotals.incoming}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-green)' }}>{targetTotals.closed}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text-3)' }}>
                        {targetTotals.incoming > 0 ? `${Math.round((targetTotals.closed / targetTotals.incoming) * 100)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-accent)' }}>{money(targetTotals.revenue)}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right" style={{ color: 'var(--rb-text)' }}>
                        {targetTotals.closed > 0 ? `$${(targetTotals.revenue / targetTotals.closed).toFixed(0)}` : '—'}
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
