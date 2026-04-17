'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Call } from '@/types/database'

function QualityBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground text-xs">—</span>
  const color = score >= 70 ? 'bg-green-100 text-green-800' : score >= 40 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>{score}</span>
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    complete: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    pending: 'bg-gray-100 text-gray-700',
    downloading: 'bg-blue-100 text-blue-800',
    transcribing: 'bg-purple-100 text-purple-800',
    analyzing: 'bg-indigo-100 text-indigo-800',
  }
  const cls = variants[status] ?? 'bg-gray-100 text-gray-700'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>
}

function formatDuration(seconds: number | null) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function CallList() {
  const [calls, setCalls] = useState<Partial<Call>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [filters, setFilters] = useState({
    status: '',
    campaign: '',
    buyer: '',
    minScore: '',
    maxScore: '',
  })

  const fetchCalls = useCallback(async (currentPage: number, currentFilters: typeof filters) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(currentPage) })
    if (currentFilters.status) params.set('status', currentFilters.status)
    if (currentFilters.campaign) params.set('campaign', currentFilters.campaign)
    if (currentFilters.buyer) params.set('buyer', currentFilters.buyer)
    if (currentFilters.minScore) params.set('min_score', currentFilters.minScore)
    if (currentFilters.maxScore) params.set('max_score', currentFilters.maxScore)

    const res = await fetch(`/api/calls?${params.toString()}`)
    const data = await res.json()
    setCalls(data.calls ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchCalls(page, filters)
  }, [page, filters, fetchCalls])

  const totalPages = Math.ceil(total / 50)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <Input
          placeholder="Campaign"
          className="w-40"
          value={filters.campaign}
          onChange={(e) => { setFilters(f => ({ ...f, campaign: e.target.value })); setPage(1) }}
        />
        <Input
          placeholder="Buyer"
          className="w-40"
          value={filters.buyer}
          onChange={(e) => { setFilters(f => ({ ...f, buyer: e.target.value })); setPage(1) }}
        />
        <Select value={filters.status || 'all'} onValueChange={(v: string | null) => { setFilters(f => ({ ...f, status: !v || v === 'all' ? '' : v })); setPage(1) }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="transcribing">Transcribing</SelectItem>
            <SelectItem value="analyzing">Analyzing</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Min score"
          type="number"
          className="w-24"
          value={filters.minScore}
          onChange={(e) => { setFilters(f => ({ ...f, minScore: e.target.value })); setPage(1) }}
        />
        <Input
          placeholder="Max score"
          type="number"
          className="w-24"
          value={filters.maxScore}
          onChange={(e) => { setFilters(f => ({ ...f, maxScore: e.target.value })); setPage(1) }}
        />
        <span className="text-xs text-muted-foreground ml-2">{total} calls</span>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Campaign</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Buyer</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Revenue</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Score</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Flags</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No calls found.
                </td>
              </tr>
            ) : (
              calls.map((call) => (
                <tr key={call.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link href={`/dashboard/calls/${call.id}`} className="text-blue-600 hover:underline">
                      {call.received_at ? new Date(call.received_at).toLocaleDateString() : '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDuration(call.duration_seconds ?? null)}
                  </td>
                  <td className="px-4 py-3 max-w-[160px] truncate">{call.campaign_name ?? '—'}</td>
                  <td className="px-4 py-3 max-w-[120px] truncate">{call.buyer_name ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {call.revenue != null ? `$${Number(call.revenue).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <QualityBadge score={call.quality_score ?? null} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(call.flags ?? []).slice(0, 3).map((flag) => (
                        <Badge key={flag} variant="secondary" className="text-xs py-0">
                          {flag.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                      {(call.flags?.length ?? 0) > 3 && (
                        <span className="text-xs text-muted-foreground">+{(call.flags?.length ?? 0) - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={call.status ?? 'pending'} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-end">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
