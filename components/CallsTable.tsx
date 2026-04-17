'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

function ReanalyzeButton({ callId }: { callId: string }) {
  const [loading, setLoading] = useState(false)
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setLoading(true)
    try {
      const res = await fetch(`/api/calls/${callId}/reanalyze`, { method: 'POST' })
      if (res.ok) toast.success('Re-analysis started — refresh in ~60s')
      else toast.error((await res.json()).error ?? 'Failed')
    } catch { toast.error('Network error') }
    finally { setLoading(false) }
  }
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="text-[10px] font-bold px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-50 transition-colors"
      style={{ background: 'var(--rb-accent)', color: '#0d1117' }}
    >
      {loading ? 'Starting…' : 'Re-analyze now'}
    </button>
  )
}
import { Call } from '@/types/database'
import { Analysis } from '@/types/analysis'
import { ChevronDown, ChevronRight, SlidersHorizontal, X } from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(date: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}
function dur(sec: number | null) {
  if (!sec) return '—'
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
function money(v: number | null) {
  if (v == null) return '—'
  return `$${Number(v).toFixed(2)}`
}

// ── atoms ─────────────────────────────────────────────────────────────────────

function QBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--rb-text-3)' }} className="text-xs">—</span>
  const [bg, color] =
    score >= 70 ? ['#0d2e1e', '#12b76a']
    : score >= 40 ? ['#2e1f04', '#f79009']
    : ['#2e0d0d', '#f04438']
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-md tabular-nums" style={{ background: bg, color }}>
      {score}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    complete:    ['#0d2e1e', '#12b76a'],
    failed:      ['#2e0d0d', '#f04438'],
    pending:     ['#1e2d40', '#7a8fa6'],
    downloading: ['#0d1e2e', '#38bdf8'],
    transcribing:['#1a0d2e', '#a78bfa'],
    analyzing:   ['#0d142e', '#6366f1'],
  }
  const [bg, color] = map[status] ?? ['#1e2d40', '#7a8fa6']
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ background: bg, color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {status}
    </span>
  )
}

function IntentBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null
  const map: Record<string, [string, string]> = {
    qualified:   ['#0d2e1e', '#12b76a'],
    borderline:  ['#2e1f04', '#f79009'],
    unqualified: ['#2e0d0d', '#f04438'],
    invalid:     ['#1e2d40', '#7a8fa6'],
  }
  const [bg, color] = map[verdict] ?? ['#1e2d40', '#7a8fa6']
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: bg, color }}>
      {verdict}
    </span>
  )
}

// ── expanded row ─────────────────────────────────────────────────────────────

function ExpandedRow({ call }: { call: Partial<Call> }) {
  const analysis = call.analysis as Analysis | null
  const fe = (analysis as any)?.final_expense

  return (
    <tr>
      <td
        colSpan={14}
        style={{ background: 'var(--rb-sidebar)', borderBottom: '1px solid var(--rb-border)' }}
      >
        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Final Expense prominent block */}
          <div className="lg:col-span-3">
            {(() => {
              const fe = (analysis as any)?.final_expense
              if (!fe) {
                return call.status === 'complete' ? (
                  <div
                    className="rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-4"
                    style={{ background: '#1c1204', border: '1px solid #3d2a08' }}
                  >
                    <div>
                      <p className="text-xs font-bold" style={{ color: '#f79009' }}>Final Expense Qualifier — Not analyzed yet</p>
                      <p className="text-xs mt-0.5" style={{ color: '#7a5c2e' }}>
                        This call was analyzed before the FE qualifier was added. Re-analyze to extract age, insurance interest, compliance flags, and more.
                      </p>
                    </div>
                    <ReanalyzeButton callId={call.id!} />
                  </div>
                ) : null
              }
              const MAP: Record<string, [string, string, string]> = {
                qualified:       ['#071a10', '#0d3321', '#12b76a'],
                borderline:      ['#1c1204', '#3d2a08', '#f79009'],
                disqualified:    ['#1c0808', '#3d1212', '#f04438'],
                compliance_risk: ['#200a0a', '#5c1414', '#f04438'],
              }
              const [bg, border, color] = MAP[fe.qualifier_verdict] ?? ['#141e2d', '#1e2d40', '#7a8fa6']
              const hasComp = fe.free_government_mentions || fe.outbound_call_claimed || fe.ftc_regulatory_mention || fe.scam_keywords_mentioned || fe.misleading_ad_mention
              const compFlags = [
                fe.free_government_mentions && 'Free/Gov mention',
                fe.outbound_call_claimed && 'Outbound call claimed',
                fe.ftc_regulatory_mention && 'FTC/Regulatory',
                fe.scam_keywords_mentioned && 'Scam keywords',
                fe.misleading_ad_mention && 'Misleading ad',
              ].filter(Boolean)
              const qualFlags = [
                fe.age_mentioned != null && `Age: ${fe.age_mentioned} (${fe.age_verdict})`,
                fe.interested_in_life_insurance !== 'unclear' && `Insurance interest: ${fe.interested_in_life_insurance}`,
                fe.has_bank_account !== 'unclear' && `Bank account: ${fe.has_bank_account}`,
                fe.can_afford !== 'unclear' && `Affordability: ${fe.can_afford}`,
              ].filter(Boolean)
              return (
                <div className="rounded-xl px-4 py-3 mb-4" style={{ background: bg, border: `1px solid ${border}` }}>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{hasComp ? '⚠️' : fe.qualifier_verdict === 'qualified' ? '✅' : '🟡'}</span>
                      <div>
                        <p className="text-xs font-bold" style={{ color }}>
                          Final Expense: {fe.qualifier_verdict.replace('_', ' ')} · {fe.qualifier_score}/100
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>{fe.qualifier_summary}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-right">
                      {qualFlags.map((f, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}>{f as string}</span>
                      ))}
                      {compFlags.map((f, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ background: '#200a0a', color: '#f04438', border: '1px solid #3d1212' }}>⚠ {f as string}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Summary */}
          <div className="lg:col-span-2 space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>
                Call Summary
              </p>
              {analysis?.summary
                ? <p className="text-sm leading-relaxed" style={{ color: 'var(--rb-text-2)' }}>{analysis.summary}</p>
                : <p className="text-sm italic" style={{ color: 'var(--rb-text-3)' }}>
                    {call.status !== 'complete' ? `Processing… (${call.status})` : 'No analysis'}
                  </p>
              }
            </div>

            {analysis && (
              <div className="flex flex-wrap gap-2">
                <span
                  className="text-xs px-2.5 py-1 rounded-md"
                  style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
                >
                  Outcome: <strong style={{ color: 'var(--rb-text)' }}>{analysis.call_outcome.replace(/_/g, ' ')}</strong>
                </span>
                <span
                  className="text-xs px-2.5 py-1 rounded-md"
                  style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
                >
                  Language: <strong style={{ color: 'var(--rb-text)' }}>{analysis.language.toUpperCase()}</strong>
                </span>
                <span
                  className="text-xs px-2.5 py-1 rounded-md"
                  style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
                >
                  Confidence: <strong style={{ color: 'var(--rb-text)' }}>{analysis.outcome_confidence}</strong>
                </span>
              </div>
            )}

            {(call.flags?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(call.flags ?? []).map(flag => (
                  <span
                    key={flag}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ background: '#2e0d0d', color: '#f04438', border: '1px solid #3d1212' }}
                  >
                    {flag.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}

            {/* Final Expense quick row */}
            {fe && (
              <div
                className="rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap"
                style={{ background: 'var(--rb-surface-2)', border: '1px solid var(--rb-border-2)' }}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>
                  Final Expense
                </span>
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-md"
                  style={{
                    background: fe.qualifier_verdict === 'qualified' ? '#0d2e1e'
                      : fe.qualifier_verdict === 'borderline' ? '#2e1f04'
                      : '#2e0d0d',
                    color: fe.qualifier_verdict === 'qualified' ? '#12b76a'
                      : fe.qualifier_verdict === 'borderline' ? '#f79009'
                      : '#f04438',
                  }}
                >
                  {fe.qualifier_verdict.replace('_', ' ')} · {fe.qualifier_score}/100
                </span>
                {fe.age_mentioned && (
                  <span className="text-xs" style={{ color: 'var(--rb-text-2)' }}>
                    Age: <strong style={{ color: 'var(--rb-text)' }}>{fe.age_mentioned}</strong>
                  </span>
                )}
                {(fe.free_government_mentions || fe.outbound_call_claimed || fe.ftc_regulatory_mention || fe.scam_keywords_mentioned || fe.misleading_ad_mention) && (
                  <span className="text-xs font-bold" style={{ color: '#f04438' }}>⚠ Compliance Issue</span>
                )}
              </div>
            )}

            {analysis?.coaching_notes && (
              <div
                className="rounded-lg px-4 py-3"
                style={{ background: '#0d1e30', border: '1px solid #1a3352' }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#38bdf8' }}>
                  Coaching Note
                </p>
                <p className="text-xs leading-relaxed" style={{ color: '#7cc8f0' }}>{analysis.coaching_notes}</p>
              </div>
            )}

            <Link
              href={`/dashboard/calls/${call.id}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
              style={{ color: 'var(--rb-accent)' }}
              onClick={e => e.stopPropagation()}
            >
              View full details — transcript, audio &amp; analysis →
            </Link>
          </div>

          {/* Scores */}
          <div className="space-y-3">
            {analysis && (
              <div
                className="rounded-xl p-4 space-y-3"
                style={{ background: 'var(--rb-surface-2)', border: '1px solid var(--rb-border-2)' }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>
                  Quality Score
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 rounded-full h-2" style={{ background: 'var(--rb-border)' }}>
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${analysis.quality_score}%`,
                        background: analysis.quality_score >= 70 ? 'var(--rb-green)' : analysis.quality_score >= 40 ? 'var(--rb-amber)' : 'var(--rb-red)',
                      }}
                    />
                  </div>
                  <span
                    className="text-base font-bold tabular-nums w-10 text-right"
                    style={{ color: analysis.quality_score >= 70 ? 'var(--rb-green)' : analysis.quality_score >= 40 ? 'var(--rb-amber)' : 'var(--rb-red)' }}
                  >
                    {analysis.quality_score}
                  </span>
                </div>
                {Object.entries(analysis.quality_breakdown).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-36 shrink-0 capitalize" style={{ color: 'var(--rb-text-3)' }}>{k.replace(/_/g, ' ')}</span>
                    <div className="flex-1 rounded-full h-1" style={{ background: 'var(--rb-border)' }}>
                      <div
                        className="h-1 rounded-full"
                        style={{
                          width: `${(v as number / 10) * 100}%`,
                          background: (v as number) >= 7 ? 'var(--rb-green)' : (v as number) >= 4 ? 'var(--rb-amber)' : 'var(--rb-red)',
                        }}
                      />
                    </div>
                    <span className="w-6 text-right font-medium" style={{ color: 'var(--rb-text-2)' }}>{v as number}</span>
                  </div>
                ))}
              </div>
            )}

            {analysis?.lead_intent && (
              <div
                className="rounded-xl p-4 space-y-3"
                style={{ background: 'var(--rb-surface-2)', border: '1px solid var(--rb-border-2)' }}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>
                  Lead Intent
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 rounded-full h-2" style={{ background: 'var(--rb-border)' }}>
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${analysis.lead_intent.score}%`,
                        background: analysis.lead_intent.score >= 70 ? 'var(--rb-green)' : analysis.lead_intent.score >= 40 ? 'var(--rb-amber)' : 'var(--rb-red)',
                      }}
                    />
                  </div>
                  <span className="text-base font-bold tabular-nums w-10 text-right" style={{ color: 'var(--rb-text)' }}>
                    {analysis.lead_intent.score}
                  </span>
                </div>
                <IntentBadge verdict={analysis.lead_intent.verdict} />
                {analysis.lead_intent.misalignment_reason && (
                  <p className="text-xs italic" style={{ color: 'var(--rb-amber)' }}>{analysis.lead_intent.misalignment_reason}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

// ── filters ───────────────────────────────────────────────────────────────────

interface Filters {
  status: string; campaign: string; publisher: string; target_name: string
  caller_id: string; end_call_source: string; is_duplicate: string
  min_score: string; max_score: string; from: string; to: string
}
const EMPTY: Filters = {
  status: '', campaign: '', publisher: '', target_name: '',
  caller_id: '', end_call_source: '', is_duplicate: '',
  min_score: '', max_score: '', from: '', to: '',
}

const inputStyle = {
  background: 'var(--rb-surface-2)',
  border: '1px solid var(--rb-border-2)',
  color: 'var(--rb-text)',
  borderRadius: '0.375rem',
  fontSize: '12px',
  padding: '5px 10px',
  outline: 'none',
  width: '100%',
}

function DarkInput({ placeholder, value, onChange, type = 'text' }: {
  placeholder?: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={inputStyle}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--rb-accent)')}
      onBlur={e => (e.currentTarget.style.borderColor = 'var(--rb-border-2)')}
    />
  )
}

function DarkSelect({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ ...inputStyle, cursor: 'pointer' }}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--rb-accent)')}
      onBlur={e => (e.currentTarget.style.borderColor = 'var(--rb-border-2)')}
    >
      {children}
    </select>
  )
}

function FiltersPanel({ filters, onChange, onReset }: {
  filters: Filters; onChange: (k: keyof Filters, v: string) => void; onReset: () => void
}) {
  const hasActive = Object.values(filters).some(Boolean)
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
        <DarkInput placeholder="Campaign" value={filters.campaign} onChange={v => onChange('campaign', v)} />
        <DarkInput placeholder="Publisher / Source" value={filters.publisher} onChange={v => onChange('publisher', v)} />
        <DarkInput placeholder="Target name" value={filters.target_name} onChange={v => onChange('target_name', v)} />
        <DarkInput placeholder="Caller ID" value={filters.caller_id} onChange={v => onChange('caller_id', v)} />
        <DarkInput placeholder="End call source" value={filters.end_call_source} onChange={v => onChange('end_call_source', v)} />

        <DarkSelect value={filters.status || 'all'} onChange={v => onChange('status', v === 'all' ? '' : v)}>
          <option value="all">All statuses</option>
          <option value="complete">Complete</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="downloading">Downloading</option>
          <option value="transcribing">Transcribing</option>
          <option value="analyzing">Analyzing</option>
        </DarkSelect>

        <DarkSelect value={filters.is_duplicate || 'all'} onChange={v => onChange('is_duplicate', v === 'all' ? '' : v)}>
          <option value="all">Duplicates: All</option>
          <option value="true">Duplicates only</option>
          <option value="false">Unique only</option>
        </DarkSelect>

        <DarkInput placeholder="Min score" type="number" value={filters.min_score} onChange={v => onChange('min_score', v)} />
        <DarkInput placeholder="Max score" type="number" value={filters.max_score} onChange={v => onChange('max_score', v)} />
        <DarkInput type="date" value={filters.from} onChange={v => onChange('from', v)} />
        <DarkInput type="date" value={filters.to} onChange={v => onChange('to', v)} />
      </div>
      {hasActive && (
        <button
          onClick={onReset}
          className="flex items-center gap-1 text-xs transition-colors"
          style={{ color: 'var(--rb-text-3)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--rb-red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--rb-text-3)')}
        >
          <X size={11} /> Clear filters
        </button>
      )}
    </div>
  )
}

// ── main ─────────────────────────────────────────────────────────────────────

export function CallsTable() {
  const [calls, setCalls] = useState<Partial<Call>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchCalls = useCallback(async (p: number, f: Filters) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p) })
    if (f.status) params.set('status', f.status)
    if (f.campaign) params.set('campaign', f.campaign)
    if (f.publisher) params.set('publisher', f.publisher)
    if (f.target_name) params.set('target_name', f.target_name)
    if (f.caller_id) params.set('caller_id', f.caller_id)
    if (f.end_call_source) params.set('end_call_source', f.end_call_source)
    if (f.is_duplicate) params.set('is_duplicate', f.is_duplicate)
    if (f.min_score) params.set('min_score', f.min_score)
    if (f.max_score) params.set('max_score', f.max_score)
    if (f.from) params.set('from', new Date(f.from).toISOString())
    if (f.to) { const d = new Date(f.to); d.setHours(23, 59, 59, 999); params.set('to', d.toISOString()) }
    const res = await fetch(`/api/calls?${params}`)
    const data = await res.json()
    setCalls(data.calls ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchCalls(page, filters), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [page, filters, fetchCalls])

  const setFilter = (k: keyof Filters, v: string) => { setFilters(f => ({ ...f, [k]: v })); setPage(1) }
  const totalPages = Math.ceil(total / 50)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const TH = ({ children }: { children: React.ReactNode }) => (
    <th
      className="text-left px-3 py-3 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
      style={{ color: 'var(--rb-text-3)', background: 'var(--rb-sidebar)' }}
    >
      {children}
    </th>
  )

  const COLS = ['Date', 'Source', 'Campaign', 'Caller ID', 'Dialed #', 'Dup', 'End Source', 'Target', 'Revenue', 'Payout', 'Duration', 'Quality', 'FE Qualifier', 'Status']

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>
          <span className="font-semibold tabular-nums" style={{ color: 'var(--rb-text)' }}>{total.toLocaleString()}</span> calls
        </p>
        <button
          onClick={() => setShowFilters(s => !s)}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
          style={{
            background: showFilters ? 'var(--rb-accent)' + '22' : 'var(--rb-surface)',
            border: `1px solid ${showFilters ? 'var(--rb-accent)' : 'var(--rb-border-2)'}`,
            color: showFilters ? 'var(--rb-accent)' : 'var(--rb-text-2)',
          }}
        >
          <SlidersHorizontal size={13} />
          Filters
          {activeFilterCount > 0 && (
            <span
              className="text-[10px] font-bold w-4 h-4 rounded-full inline-flex items-center justify-center"
              style={{ background: 'var(--rb-accent)', color: '#0d1117' }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <FiltersPanel filters={filters} onChange={setFilter} onReset={() => { setFilters(EMPTY); setPage(1) }} />
      )}

      {/* Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rb-border)' }}>
                <th style={{ width: 32, background: 'var(--rb-sidebar)' }} />
                {COLS.map(c => <TH key={c}>{c}</TH>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 7 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--rb-border)' }}>
                    <td />{COLS.map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-3 rounded animate-pulse" style={{ background: 'var(--rb-surface-2)' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 1} className="px-4 py-16 text-center text-sm" style={{ color: 'var(--rb-text-3)' }}>
                    No calls match your filters.
                  </td>
                </tr>
              ) : (
                calls.flatMap(call => {
                  const isExpanded = expandedId === call.id
                  const analysis = call.analysis as Analysis | null
                  const leadVerdict = analysis?.lead_intent?.verdict ?? null

                  const row = (
                    <tr
                      key={call.id}
                      className="cursor-pointer transition-colors"
                      style={{ borderBottom: '1px solid var(--rb-border)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--rb-surface-2)'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = isExpanded ? 'var(--rb-surface-2)' : 'transparent'}
                      onClick={() => setExpandedId(isExpanded ? null : (call.id ?? null))}
                    >
                      <td className="pl-3 py-3">
                        <span style={{ color: 'var(--rb-text-3)' }}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs tabular-nums" style={{ color: 'var(--rb-text-2)' }}>
                        {fmt(call.received_at ?? null)}
                      </td>
                      <td className="px-3 py-3 max-w-[100px]">
                        <span className="text-xs truncate block" style={{ color: 'var(--rb-text-2)' }}>{call.publisher_name ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 max-w-[140px]">
                        <span className="text-xs truncate block" style={{ color: 'var(--rb-text)' }}>{call.campaign_name ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs font-mono" style={{ color: 'var(--rb-text-2)' }}>{call.caller_id ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs font-mono" style={{ color: 'var(--rb-text-3)' }}>{(call as any).target_number ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3">
                        {(call as any).is_duplicate == null
                          ? <span style={{ color: 'var(--rb-text-3)' }} className="text-xs">—</span>
                          : (call as any).is_duplicate
                          ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#2e1f04', color: '#f79009' }}>DUP</span>
                          : <span className="text-xs" style={{ color: 'var(--rb-text-3)' }}>No</span>}
                      </td>
                      <td className="px-3 py-3 max-w-[100px]">
                        <span className="text-xs truncate block" style={{ color: 'var(--rb-text-3)' }}>{(call as any).end_call_source ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 max-w-[120px]">
                        <span className="text-xs truncate block" style={{ color: 'var(--rb-text-2)' }}>{(call as any).target_name ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--rb-green)' }}>{money(call.revenue ?? null)}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs tabular-nums" style={{ color: 'var(--rb-text-3)' }}>{money(call.payout ?? null)}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs tabular-nums" style={{ color: 'var(--rb-text-2)' }}>{dur(call.duration_seconds ?? null)}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <QBadge score={call.quality_score ?? null} />
                          {leadVerdict && <IntentBadge verdict={leadVerdict} />}
                        </div>
                      </td>
                      {/* FE Qualifier */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {(() => {
                          const fe = (analysis as any)?.final_expense
                          if (!fe) {
                            return call.status === 'complete'
                              ? <span className="text-[10px]" style={{ color: 'var(--rb-text-3)' }}>needs re-analysis</span>
                              : <span style={{ color: 'var(--rb-text-3)' }} className="text-xs">—</span>
                          }
                          const MAP: Record<string, [string, string]> = {
                            qualified:       ['#071a10', '#12b76a'],
                            borderline:      ['#2e1f04', '#f79009'],
                            disqualified:    ['#1c0808', '#f04438'],
                            compliance_risk: ['#200a0a', '#f04438'],
                          }
                          const [bg, color] = MAP[fe.qualifier_verdict] ?? ['#1e2d40', '#7a8fa6']
                          const hasComp = fe.free_government_mentions || fe.outbound_call_claimed || fe.ftc_regulatory_mention || fe.scam_keywords_mentioned || fe.misleading_ad_mention
                          return (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: bg, color }}>
                              {hasComp && '⚠ '}
                              {fe.qualifier_verdict.replace('_', ' ')}
                              <span className="opacity-70">· {fe.qualifier_score}</span>
                            </span>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={call.status ?? 'pending'} />
                      </td>
                    </tr>
                  )
                  return isExpanded ? [row, <ExpandedRow key={`${call.id}-exp`} call={call} />] : [row]
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid var(--rb-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--rb-text-3)' }}>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              {[
                { label: 'Previous', disabled: page === 1, onClick: () => setPage(p => p - 1) },
                { label: 'Next', disabled: page === totalPages, onClick: () => setPage(p => p + 1) },
              ].map(btn => (
                <button
                  key={btn.label}
                  disabled={btn.disabled}
                  onClick={btn.onClick}
                  className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors disabled:opacity-40"
                  style={{
                    background: 'var(--rb-surface-2)',
                    border: '1px solid var(--rb-border-2)',
                    color: 'var(--rb-text-2)',
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
