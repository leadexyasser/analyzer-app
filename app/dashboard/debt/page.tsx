import type { Metadata } from 'next'
import { Suspense } from 'react'
import { many, one } from '@/lib/db'
import { UploadCsvButton } from '@/components/debt/UploadCsvButton'
import { DebtCallsTable } from '@/components/debt/DebtCallsTable'
import { DateRangeControl } from '@/components/DateRangeControl'
import { AutoRefresh } from '@/components/AutoRefresh'
import { etTodayStr, etMidnight, etEndOfDay, shiftDateStr } from '@/lib/time'

export const revalidate = 30
export const metadata: Metadata = { title: 'Debt Spanish' }

function resolveRange(preset: string, from: string, to: string): { start: Date; end: Date; label: string } {
  const todayStr = etTodayStr()

  if (preset === 'custom' && (from || to)) {
    const start = from ? etMidnight(from) : new Date(0)
    const end   = to   ? etEndOfDay(to)   : etEndOfDay(todayStr)
    return { start, end, label: `${from || '…'} → ${to || '…'}` }
  }
  if (preset === 'Today') {
    return { start: etMidnight(todayStr), end: etEndOfDay(todayStr), label: 'Today' }
  }
  if (preset === 'Yesterday') {
    const yStr = shiftDateStr(todayStr, -1)
    return { start: etMidnight(yStr), end: etEndOfDay(yStr), label: 'Yesterday' }
  }
  const days = preset === '30d' ? 30 : preset === '90d' ? 90 : 7
  const start = etMidnight(shiftDateStr(todayStr, -days))
  const end   = etEndOfDay(todayStr)
  return { start, end, label: `Last ${days} days` }
}

async function getDebtStats(start: Date, end: Date) {
  const rangeParams = [start.toISOString(), end.toISOString()]
  const [totalRow, completedRow, avgQualityRow, avgComplianceRow, byStatusRes] = await Promise.all([
    one<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM debt_calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz`,
      rangeParams
    ),
    one<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM debt_calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz
         AND status = 'complete'`,
      rangeParams
    ),
    one<{ avg: string | null }>(
      `SELECT AVG(quality_score)::text AS avg FROM debt_calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz
         AND quality_score IS NOT NULL`,
      rangeParams
    ),
    one<{ avg: string | null }>(
      `SELECT AVG(compliance_score)::text AS avg FROM debt_calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz
         AND compliance_score IS NOT NULL`,
      rangeParams
    ),
    many<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM debt_calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz
       GROUP BY status`,
      rangeParams
    ),
  ])

  const byStatus = Object.fromEntries(byStatusRes.map(r => [r.status, Number(r.count)]))
  return {
    total: totalRow ? Number(totalRow.count) : 0,
    completed: completedRow ? Number(completedRow.count) : 0,
    avgQuality: avgQualityRow?.avg ? Math.round(Number(avgQualityRow.avg)) : null,
    avgCompliance: avgComplianceRow?.avg ? Math.round(Number(avgComplianceRow.avg)) : null,
    byStatus,
  }
}

function StatCard({ label, value, sub, accent = false, warn = false }: {
  label: string; value: string; sub?: string; accent?: boolean; warn?: boolean
}) {
  return (
    <div className="rounded-xl px-5 py-4 space-y-1" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{
        color: accent ? 'var(--rb-accent)' : warn ? 'var(--rb-amber)' : 'var(--rb-text)'
      }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>{sub}</p>}
    </div>
  )
}

async function DebtStats({ start, end, label }: { start: Date; end: Date; label: string }) {
  const stats = await getDebtStats(start, end)
  const pending = stats.byStatus['pending'] ?? 0
  const inFlight = (stats.byStatus['downloading'] ?? 0) + (stats.byStatus['transcribing'] ?? 0) + (stats.byStatus['analyzing'] ?? 0)
  const failed = stats.byStatus['failed'] ?? 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard label={`Calls (${label})`} value={String(stats.total)} sub={stats.completed > 0 ? `${stats.completed} analyzed` : undefined} />
      <StatCard label="Avg Quality" value={stats.avgQuality != null ? `${stats.avgQuality}` : '—'} sub="0-100" accent={stats.avgQuality != null && stats.avgQuality >= 60} />
      <StatCard label="Avg Compliance" value={stats.avgCompliance != null ? `${stats.avgCompliance}` : '—'} sub="0-100" accent={stats.avgCompliance != null && stats.avgCompliance >= 90} warn={stats.avgCompliance != null && stats.avgCompliance < 80} />
      <StatCard
        label="Pipeline"
        value={`${pending + inFlight}`}
        sub={failed > 0 ? `${failed} failed · ${pending} queued · ${inFlight} running` : `${pending} queued · ${inFlight} running`}
        warn={failed > 0}
      />
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-xl px-5 py-4 h-20" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }} />
      ))}
    </div>
  )
}

export default async function DebtDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const preset = sp.preset ?? '7d'
  const { start, end, label } = resolveRange(preset, sp.from ?? '', sp.to ?? '')

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--rb-text)' }}>Debt Spanish</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>Upload a Ringba CSV → each call is transcribed and analyzed · {label}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <UploadCsvButton />
          <Suspense>
            <DateRangeControl />
          </Suspense>
          <AutoRefresh />
        </div>
      </div>

      <Suspense fallback={<StatsSkeleton />}>
        <DebtStats start={start} end={end} label={label} />
      </Suspense>

      <DebtCallsTable dateFrom={start.toISOString()} dateTo={end.toISOString()} />
    </div>
  )
}
