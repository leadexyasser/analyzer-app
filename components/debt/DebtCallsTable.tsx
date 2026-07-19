'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type DebtCallRow = {
  id: string
  call_started_at: string | null
  campaign: string | null
  caller_id: string | null
  duration_seconds: number | null
  connected_length_seconds: number | null
  revenue: number | string | null
  debt_amount_usd: number | string | null
  quality_score: number | null
  compliance_score: number | null
  status: string
  flags: string[] | null
  source_filename: string | null
}

const STATUS_COLOR: Record<string, string> = {
  complete: 'var(--rb-green)',
  failed: 'var(--rb-red)',
  pending: 'var(--rb-text-3)',
  downloading: 'var(--rb-accent)',
  transcribing: 'var(--rb-accent)',
  analyzing: 'var(--rb-accent)',
}

function fmtSecs(s: number | null): string {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtUsd(v: number | string | null | undefined): string {
  if (v == null) return '—'
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '$0'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function ScoreCell({ score, threshold = 70 }: { score: number | null; threshold?: number }) {
  if (score == null) return <span style={{ color: 'var(--rb-text-3)' }}>—</span>
  const color = score >= threshold ? 'var(--rb-green)' : score >= threshold - 20 ? 'var(--rb-amber)' : 'var(--rb-red)'
  return <span className="font-semibold tabular-nums" style={{ color }}>{score}</span>
}

export function DebtCallsTable({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const [rows, setRows] = useState<DebtCallRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const url = new URL('/api/debt/calls', window.location.origin)
    url.searchParams.set('page', String(page))
    if (dateFrom) url.searchParams.set('from', dateFrom)
    if (dateTo)   url.searchParams.set('to', dateTo)
    fetch(url.toString(), { cache: 'no-store' })
      .then(r => r.json())
      .then((data: { calls: DebtCallRow[]; total: number }) => {
        if (cancelled) return
        setRows(data.calls ?? [])
        setTotal(data.total ?? 0)
      })
      .catch(() => setRows([]))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page, dateFrom, dateTo])

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows
    const f = filter.trim().toLowerCase()
    return rows.filter(r =>
      (r.campaign?.toLowerCase().includes(f) ?? false) ||
      (r.caller_id?.toLowerCase().includes(f) ?? false)
    )
  }, [rows, filter])

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--rb-border)' }}>
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--rb-text)' }}>Calls</h2>
          <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>{total} total</p>
        </div>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter campaign or caller…"
          className="px-2.5 py-1.5 rounded-md text-xs outline-none w-64"
          style={{
            background: 'var(--rb-surface-2)',
            border: '1px solid var(--rb-border-2)',
            color: 'var(--rb-text)',
          }}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--rb-surface-2)' }}>
            <tr>
              {['Date', 'Campaign', 'Caller ID', 'Connected', 'Duration', 'Revenue', 'Debt Load', 'Quality', 'Compliance', 'Status'].map(h => (
                <th key={h} className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--rb-text-3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="text-center py-8" style={{ color: 'var(--rb-text-3)' }}>Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8" style={{ color: 'var(--rb-text-3)' }}>No calls yet — upload a Ringba CSV to get started.</td></tr>
            )}
            {!loading && filtered.map(row => (
              <tr key={row.id}
                  className="transition-colors hover:bg-[var(--rb-surface-2)]"
                  style={{ borderTop: '1px solid var(--rb-border)' }}>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--rb-text-2)' }}>
                  <Link href={`/dashboard/debt/calls/${row.id}`} className="hover:underline">
                    {fmtDate(row.call_started_at)}
                  </Link>
                </td>
                <td className="px-3 py-2 truncate max-w-[240px]" style={{ color: 'var(--rb-text-2)' }} title={row.campaign ?? ''}>{row.campaign ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--rb-text-2)' }}>{row.caller_id ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--rb-text-2)' }}>{fmtSecs(row.connected_length_seconds)}</td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--rb-text-2)' }}>{fmtSecs(row.duration_seconds)}</td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--rb-text-2)' }}>{fmtUsd(row.revenue)}</td>
                <td className="px-3 py-2 tabular-nums font-medium" style={{ color: row.debt_amount_usd != null ? 'var(--rb-accent)' : 'var(--rb-text-3)' }}>{fmtUsd(row.debt_amount_usd)}</td>
                <td className="px-3 py-2"><ScoreCell score={row.quality_score} /></td>
                <td className="px-3 py-2"><ScoreCell score={row.compliance_score} threshold={80} /></td>
                <td className="px-3 py-2 capitalize" style={{ color: STATUS_COLOR[row.status] ?? 'var(--rb-text-3)' }}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > rows.length && (
        <div className="flex items-center justify-between px-4 py-2 text-xs" style={{ borderTop: '1px solid var(--rb-border)', color: 'var(--rb-text-3)' }}>
          <span>Page {page} of {Math.ceil(total / 50)}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2 py-1 rounded-md disabled:opacity-40"
              style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
            >Prev</button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * 50 >= total}
              className="px-2 py-1 rounded-md disabled:opacity-40"
              style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
            >Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
