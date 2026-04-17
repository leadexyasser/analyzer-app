'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Call } from '@/types/database'
import { Analysis } from '@/types/analysis'
import { ChevronDown, ChevronRight, SlidersHorizontal, X } from 'lucide-react'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(date: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function dur(sec: number | null) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function money(v: number | null) {
  if (v == null) return '—'
  return `$${Number(v).toFixed(2)}`
}

// ── small UI atoms ────────────────────────────────────────────────────────────

function QBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-slate-400 text-xs">—</span>
  const cls = score >= 70
    ? 'bg-emerald-100 text-emerald-800'
    : score >= 40
    ? 'bg-amber-100 text-amber-800'
    : 'bg-red-100 text-red-800'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{score}</span>
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: 'bg-emerald-500',
    failed: 'bg-red-500',
    pending: 'bg-slate-400',
    downloading: 'bg-sky-500',
    transcribing: 'bg-violet-500',
    analyzing: 'bg-indigo-500',
  }
  const label: Record<string, string> = {
    complete: 'Complete',
    failed: 'Failed',
    pending: 'Pending',
    downloading: 'Downloading',
    transcribing: 'Transcribing',
    analyzing: 'Analyzing',
  }
  const dot = map[status] ?? 'bg-slate-400'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      {label[status] ?? status}
    </span>
  )
}

function IntentBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null
  const map: Record<string, string> = {
    qualified: 'bg-emerald-100 text-emerald-800',
    borderline: 'bg-amber-100 text-amber-800',
    unqualified: 'bg-red-100 text-red-800',
    invalid: 'bg-slate-100 text-slate-600',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[verdict] ?? 'bg-slate-100 text-slate-600'}`}>
      {verdict}
    </span>
  )
}

// ── inline expanded row ───────────────────────────────────────────────────────

function ExpandedRow({ call }: { call: Partial<Call> }) {
  const analysis = call.analysis as Analysis | null

  const intentColor = (score: number) =>
    score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <tr>
      <td colSpan={13} className="px-0 py-0 bg-slate-50 border-b border-slate-200">
        <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Summary */}
          <div className="lg:col-span-2 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Call Summary</p>
              {analysis?.summary
                ? <p className="text-sm text-slate-700 leading-relaxed">{analysis.summary}</p>
                : <p className="text-sm text-slate-400 italic">{call.status !== 'complete' ? `Processing… (${call.status})` : 'No analysis'}</p>
              }
            </div>

            {analysis && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                  Outcome: <strong className="text-slate-800">{analysis.call_outcome.replace(/_/g, ' ')}</strong>
                </span>
                <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                  Language: <strong className="text-slate-800">{analysis.language}</strong>
                </span>
                <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                  Confidence: <strong className="text-slate-800">{analysis.outcome_confidence}</strong>
                </span>
              </div>
            )}

            {/* Flags */}
            {(call.flags?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(call.flags ?? []).map(flag => (
                  <span key={flag} className="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded text-xs">
                    {flag.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}

            {/* Coaching */}
            {analysis?.coaching_notes && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <p className="text-xs font-semibold text-blue-600 mb-1">Coaching Note</p>
                <p className="text-sm text-blue-800">{analysis.coaching_notes}</p>
              </div>
            )}
          </div>

          {/* Scores sidebar */}
          <div className="space-y-4">
            {/* Quality */}
            {analysis && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Quality Score</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-slate-100 rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full ${analysis.quality_score >= 70 ? 'bg-emerald-500' : analysis.quality_score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${analysis.quality_score}%` }}
                    />
                  </div>
                  <span className="text-lg font-bold text-slate-900 w-10 text-right">{analysis.quality_score}</span>
                </div>
                <div className="space-y-1.5 pt-1">
                  {Object.entries(analysis.quality_breakdown).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500 w-40 shrink-0">{k.replace(/_/g, ' ')}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${(v / 10) >= 0.7 ? 'bg-emerald-400' : (v / 10) >= 0.4 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${(v as number / 10) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right font-medium text-slate-700">{v as number}/10</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lead Intent */}
            {analysis?.lead_intent && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Lead Intent</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-slate-100 rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full ${intentColor(analysis.lead_intent.score)}`}
                      style={{ width: `${analysis.lead_intent.score}%` }}
                    />
                  </div>
                  <span className="text-lg font-bold text-slate-900 w-10 text-right">{analysis.lead_intent.score}</span>
                </div>
                <div className="flex items-center justify-between">
                  <IntentBadge verdict={analysis.lead_intent.verdict} />
                  <span className="text-xs text-slate-500">
                    {analysis.lead_intent.is_genuine_inquiry ? '✓ Genuine inquiry' : '✗ Not genuine'}
                  </span>
                </div>
                {analysis.lead_intent.misalignment_reason && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2.5 py-2 border border-amber-200">
                    {analysis.lead_intent.misalignment_reason}
                  </p>
                )}
                {analysis.lead_intent.red_flags.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Red flags</p>
                    <ul className="space-y-0.5">
                      {analysis.lead_intent.red_flags.map((r, i) => (
                        <li key={i} className="text-xs text-red-700 flex gap-1.5">
                          <span>·</span><span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
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
  status: string
  campaign: string
  publisher: string
  target_name: string
  caller_id: string
  end_call_source: string
  is_duplicate: string
  min_score: string
  max_score: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = {
  status: '', campaign: '', publisher: '', target_name: '',
  caller_id: '', end_call_source: '', is_duplicate: '',
  min_score: '', max_score: '', from: '', to: '',
}

function FiltersPanel({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters
  onChange: (k: keyof Filters, v: string) => void
  onReset: () => void
}) {
  const hasActive = Object.values(filters).some(Boolean)
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
        <Input placeholder="Campaign" value={filters.campaign}
          onChange={e => onChange('campaign', e.target.value)} className="text-xs h-8" />
        <Input placeholder="Publisher / Source" value={filters.publisher}
          onChange={e => onChange('publisher', e.target.value)} className="text-xs h-8" />
        <Input placeholder="Target name" value={filters.target_name}
          onChange={e => onChange('target_name', e.target.value)} className="text-xs h-8" />
        <Input placeholder="Caller ID" value={filters.caller_id}
          onChange={e => onChange('caller_id', e.target.value)} className="text-xs h-8" />
        <Input placeholder="End call source" value={filters.end_call_source}
          onChange={e => onChange('end_call_source', e.target.value)} className="text-xs h-8" />

        <Select value={filters.status || 'all'}
          onValueChange={(v: string | null) => onChange('status', (!v || v === 'all') ? '' : v)}>
          <SelectTrigger className="text-xs h-8"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="downloading">Downloading</SelectItem>
            <SelectItem value="transcribing">Transcribing</SelectItem>
            <SelectItem value="analyzing">Analyzing</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.is_duplicate || 'all'}
          onValueChange={(v: string | null) => onChange('is_duplicate', (!v || v === 'all') ? '' : v)}>
          <SelectTrigger className="text-xs h-8"><SelectValue placeholder="Duplicate" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Duplicates only</SelectItem>
            <SelectItem value="false">Unique only</SelectItem>
          </SelectContent>
        </Select>

        <Input placeholder="Min score" type="number" value={filters.min_score}
          onChange={e => onChange('min_score', e.target.value)} className="text-xs h-8" />
        <Input placeholder="Max score" type="number" value={filters.max_score}
          onChange={e => onChange('max_score', e.target.value)} className="text-xs h-8" />

        <Input type="date" value={filters.from}
          onChange={e => onChange('from', e.target.value)} className="text-xs h-8" />
        <Input type="date" value={filters.to}
          onChange={e => onChange('to', e.target.value)} className="text-xs h-8" />
      </div>

      {hasActive && (
        <button onClick={onReset}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-500 transition-colors">
          <X size={12} /> Clear filters
        </button>
      )}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export function CallsTable() {
  const [calls, setCalls] = useState<Partial<Call>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
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
    if (f.to) {
      const d = new Date(f.to); d.setHours(23, 59, 59, 999)
      params.set('to', d.toISOString())
    }
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

  const setFilter = (k: keyof Filters, v: string) => {
    setFilters(f => ({ ...f, [k]: v }))
    setPage(1)
  }
  const resetFilters = () => { setFilters(EMPTY_FILTERS); setPage(1) }
  const totalPages = Math.ceil(total / 50)

  const cols = [
    'Date', 'Source', 'Campaign', 'Caller ID', 'Dialed #',
    'Dup', 'End Source', 'Target', 'Revenue', 'Payout', 'Duration', 'Quality', 'Status',
  ]

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-900">{total.toLocaleString()}</span> calls
        </p>
        <Button
          variant="outline"
          size="sm"
          className={`gap-2 text-xs ${showFilters ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : ''}`}
          onClick={() => setShowFilters(s => !s)}
        >
          <SlidersHorizontal size={13} />
          Filters
          {Object.values(filters).some(Boolean) && (
            <span className="bg-indigo-600 text-white text-[10px] font-bold w-4 h-4 rounded-full inline-flex items-center justify-center">
              {Object.values(filters).filter(Boolean).length}
            </span>
          )}
        </Button>
      </div>

      {showFilters && (
        <FiltersPanel filters={filters} onChange={setFilter} onReset={resetFilters} />
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="w-8" />
                {cols.map(c => (
                  <th key={c} className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td />{cols.map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <Skeleton className="h-4 w-full rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 1} className="px-4 py-12 text-center text-slate-400 text-sm">
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
                      className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                      onClick={() => setExpandedId(isExpanded ? null : (call.id ?? null))}
                    >
                      <td className="pl-3 py-3 text-slate-400">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      {/* Date */}
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-600">
                        {fmt(call.received_at ?? null)}
                      </td>
                      {/* Source (publisher) */}
                      <td className="px-3 py-3 max-w-[100px]">
                        <span className="text-xs text-slate-700 truncate block">{call.publisher_name ?? '—'}</span>
                      </td>
                      {/* Campaign */}
                      <td className="px-3 py-3 max-w-[140px]">
                        <span className="text-xs text-slate-700 truncate block">{call.campaign_name ?? '—'}</span>
                      </td>
                      {/* Caller ID */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs font-mono text-slate-700">{call.caller_id ?? '—'}</span>
                      </td>
                      {/* Dialed number */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs font-mono text-slate-600">{call.target_number ?? '—'}</span>
                      </td>
                      {/* Is duplicate */}
                      <td className="px-3 py-3">
                        {call.is_duplicate == null ? (
                          <span className="text-slate-400 text-xs">—</span>
                        ) : call.is_duplicate ? (
                          <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded">DUP</span>
                        ) : (
                          <span className="text-slate-400 text-xs">No</span>
                        )}
                      </td>
                      {/* End call source */}
                      <td className="px-3 py-3 max-w-[100px]">
                        <span className="text-xs text-slate-600 truncate block">{call.end_call_source ?? '—'}</span>
                      </td>
                      {/* Target name */}
                      <td className="px-3 py-3 max-w-[120px]">
                        <span className="text-xs text-slate-700 truncate block">{call.target_name ?? '—'}</span>
                      </td>
                      {/* Revenue */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs font-semibold text-emerald-700">{money(call.revenue ?? null)}</span>
                      </td>
                      {/* Payout */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs text-slate-600">{money(call.payout ?? null)}</span>
                      </td>
                      {/* Duration */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-xs text-slate-600 tabular-nums">{dur(call.duration_seconds ?? null)}</span>
                      </td>
                      {/* Quality + lead intent */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <QBadge score={call.quality_score ?? null} />
                          {leadVerdict && <IntentBadge verdict={leadVerdict} />}
                        </div>
                      </td>
                      {/* Status */}
                      <td className="px-3 py-3">
                        <StatusDot status={call.status ?? 'pending'} />
                      </td>
                    </tr>
                  )

                  return isExpanded
                    ? [row, <ExpandedRow key={`${call.id}-exp`} call={call} />]
                    : [row]
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1}
                onClick={() => setPage(p => p - 1)} className="text-xs h-7">
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)} className="text-xs h-7">
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
