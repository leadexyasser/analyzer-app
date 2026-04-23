import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'

export const revalidate = 30
export const metadata: Metadata = { title: 'Dashboard' }
import { CallsTable } from '@/components/CallsTable'
import { RetryStuckButton } from '@/components/RetryStuckButton'
import { Timeline } from '@/components/Timeline'
import { SummaryTable } from '@/components/SummaryTable'
import { DateRangeControl } from '@/components/DateRangeControl'
import { AutoRefresh } from '@/components/AutoRefresh'
import { ReanalyzeAllButton } from '@/components/ReanalyzeAllButton'
import { computeFELeadQuality, hasComplianceIssue, COMPLIANCE_FLAG_LABELS } from '@/lib/fe-scoring'
import { etTodayStr, etMidnight, etEndOfDay, shiftDateStr, etHourOf } from '@/lib/time'
import { Suspense } from 'react'

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

async function getStats(start: Date, end: Date) {
  const supabase = createServiceClient()
  const todayStart = etMidnight(etTodayStr())

  const [todayRes, revenueRes, analysisRes, todayCallsRes, allRes] = await Promise.all([
    supabase.from('calls').select('id', { count: 'exact', head: true }).gte('call_started_at', todayStart.toISOString()),
    supabase.from('calls').select('revenue').gte('call_started_at', start.toISOString()).lte('call_started_at', end.toISOString()).eq('status', 'complete').not('revenue', 'is', null),
    // JSON path extraction: avoids pulling the full 5-10KB analysis blob per row
    supabase.from('calls').select('target_name, revenue, analysis->call_outcome, analysis->final_expense').gte('call_started_at', start.toISOString()).lte('call_started_at', end.toISOString()).eq('status', 'complete').not('analysis', 'is', null).limit(2000),
    supabase.from('calls').select('call_started_at').gte('call_started_at', todayStart.toISOString()),
    supabase.from('calls').select('campaign_name,publisher_name,status,revenue,payout,is_duplicate,quality_score').gte('call_started_at', start.toISOString()).lte('call_started_at', end.toISOString()).limit(2000),
  ])

  const callsToday = todayRes.count ?? 0
  const revenue = (revenueRes.data ?? []).reduce((s: number, r: any) => s + Number(r.revenue ?? 0), 0)

  const feScores: number[] = []
  let complianceTotal = 0, complianceClean = 0
  const complianceFlagCounts: Record<string, number> = {}
  let closedCount = 0
  const totalAnalyzed = (analysisRes.data ?? []).length

  type TRow = { name: string; incoming: number; closed: number; revenue: number }
  const targetMap = new Map<string, TRow>()

  for (const row of analysisRes.data ?? []) {
    const r = row as any
    // JSON path extraction returns call_outcome and final_expense as top-level fields
    const fe = r.final_expense
    const isClosed = r.call_outcome === 'sale_closed'
    const target = r.target_name ?? '—'
    const rev = r.revenue != null ? Number(r.revenue) : 0

    if (fe) {
      const score = computeFELeadQuality(fe)
      if (score !== null) feScores.push(score)
      complianceTotal++
      if (hasComplianceIssue(fe)) {
        for (const key of Object.keys(COMPLIANCE_FLAG_LABELS)) {
          if (fe[key]) complianceFlagCounts[key] = (complianceFlagCounts[key] ?? 0) + 1
        }
      } else {
        complianceClean++
      }
    }

    if (isClosed) closedCount++

    if (!targetMap.has(target)) targetMap.set(target, { name: target, incoming: 0, closed: 0, revenue: 0 })
    const t = targetMap.get(target)!
    t.incoming++
    t.revenue += rev
    if (isClosed) t.closed++
  }

  const avgFEQuality = feScores.length ? Math.round(feScores.reduce((a, b) => a + b, 0) / feScores.length) : null
  const complianceScore = complianceTotal > 0 ? Math.round((complianceClean / complianceTotal) * 100) : null
  const closedRate = totalAnalyzed > 0 ? Math.round((closedCount / totalAnalyzed) * 100) : null
  const overallCPA = closedCount > 0 ? revenue / closedCount : null

  const topFlags = Object.entries(complianceFlagCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([key, count]) => [COMPLIANCE_FLAG_LABELS[key] ?? key, count] as [string, number])

  const byTarget = [...targetMap.values()]
    .map(t => ({ ...t, cpa: t.closed > 0 ? t.revenue / t.closed : null }))
    .sort((a, b) => b.incoming - a.incoming)

  const hourly = Array(24).fill(0)
  for (const row of todayCallsRes.data ?? []) {
    const h = etHourOf(row.call_started_at)
    hourly[h] = (hourly[h] ?? 0) + 1
  }

  type SRow = { name: string; incoming: number; completed: number; revenue: number; payout: number; duplicates: number; avgQuality: number | null }
  const campaignMap = new Map<string, SRow>()
  const publisherMap = new Map<string, SRow>()

  for (const r of allRes.data ?? []) {
    const camp = r.campaign_name ?? '—'
    const pub  = r.publisher_name ?? '—'
    const rev  = r.revenue != null ? Number(r.revenue) : 0
    const pay  = r.payout  != null ? Number(r.payout)  : 0
    const qs   = r.quality_score as number | null
    for (const [map, key] of [[campaignMap, camp], [publisherMap, pub]] as const) {
      if (!map.has(key)) map.set(key, { name: key, incoming: 0, completed: 0, revenue: 0, payout: 0, duplicates: 0, avgQuality: null })
      const row = map.get(key)!
      row.incoming++
      if (r.status === 'complete') { row.completed++; row.revenue += rev; row.payout += pay }
      if (r.is_duplicate === true) row.duplicates++
      if (qs != null) row.avgQuality = row.avgQuality == null ? qs : Math.round((row.avgQuality + qs) / 2)
    }
  }

  return {
    callsToday, revenue, avgFEQuality, complianceScore, complianceTotal,
    closedRate, closedCount, overallCPA, topFlags,
    hourly, byTarget,
    byCampaign:  [...campaignMap.values()].sort((a, b) => b.incoming - a.incoming),
    byPublisher: [...publisherMap.values()].sort((a, b) => b.incoming - a.incoming),
  }
}

function StatCard({ label, value, sub, accent = false, warn = false, green = false }: {
  label: string; value: string; sub?: string; accent?: boolean; warn?: boolean; green?: boolean
}) {
  return (
    <div className="rounded-xl px-5 py-4 space-y-1" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{
        color: accent ? 'var(--rb-accent)' : green ? 'var(--rb-green)' : warn ? 'var(--rb-amber)' : 'var(--rb-text)'
      }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>{sub}</p>}
    </div>
  )
}

async function DashboardStats({ start, end, label }: { start: Date; end: Date; label: string }) {
  const stats = await getStats(start, end)
  return (
    <>
      {/* Stats — Row 1: Business KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Calls Today" value={String(stats.callsToday)} />
        <StatCard label={`Revenue (${label})`} value={`$${stats.revenue.toFixed(0)}`} accent />
        <StatCard
          label="Closed Rate"
          value={stats.closedRate != null ? `${stats.closedRate}%` : '—'}
          sub={stats.closedCount > 0 ? `${stats.closedCount} sale${stats.closedCount !== 1 ? 's' : ''} closed` : 'no sales yet'}
          green={stats.closedRate != null && stats.closedRate > 0}
        />
        <StatCard
          label="Overall CPA"
          value={stats.overallCPA != null ? `$${stats.overallCPA.toFixed(0)}` : '—'}
          sub="revenue ÷ closed sales"
          accent={stats.overallCPA != null}
        />
      </div>

      {stats.revenue === 0 && stats.closedRate === null && stats.avgFEQuality === null && (
        <div className="rounded-xl py-8 text-center" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--rb-text-2)' }}>No calls found for this date range</p>
          <p className="text-xs mt-1" style={{ color: 'var(--rb-text-3)' }}>Try selecting a different period, or check that Ringba webhooks are configured.</p>
        </div>
      )}

      {/* Stats — Row 2: Quality indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="FE Lead Quality" value={stats.avgFEQuality != null ? `${stats.avgFEQuality}%` : '—'} sub="avg weighted qualifier score" />
        <StatCard
          label="Compliance Score"
          value={stats.complianceScore != null ? `${stats.complianceScore}%` : '—'}
          sub={stats.complianceTotal > 0 ? `${stats.complianceTotal} calls analyzed` : undefined}
          accent={stats.complianceScore != null && stats.complianceScore >= 90}
          warn={stats.complianceScore != null && stats.complianceScore < 80}
        />
        <div className="rounded-xl px-5 py-4" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Compliance Flags</p>
          {stats.topFlags.length === 0
            ? <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>None detected</p>
            : <ul className="space-y-1">
                {stats.topFlags.map(([lbl, count]) => (
                  <li key={lbl} className="flex justify-between items-center text-xs">
                    <span className="truncate" style={{ color: 'var(--rb-text-2)' }}>{lbl}</span>
                    <span className="font-bold ml-2 tabular-nums" style={{ color: 'var(--rb-red)' }}>{count}</span>
                  </li>
                ))}
              </ul>
          }
        </div>
      </div>

      <Timeline hourly={stats.hourly} />
      <SummaryTable byCampaign={stats.byCampaign} byPublisher={stats.byPublisher} byTarget={stats.byTarget} />
    </>
  )
}

function Statsskeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl px-5 py-4 h-20" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }} />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl px-5 py-4 h-20" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }} />
        ))}
      </div>
    </div>
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const preset = sp.preset ?? '7d'
  const { start, end, label } = resolveRange(preset, sp.from ?? '', sp.to ?? '')

  return (
    <div className="space-y-5">

      {/* Header — renders instantly */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--rb-text)' }}>Call Logs</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>Final Expense · {label}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Suspense>
            <DateRangeControl />
          </Suspense>
          <AutoRefresh />
          <ReanalyzeAllButton dateFrom={start.toISOString()} dateTo={end.toISOString()} />
          <RetryStuckButton />
        </div>
      </div>

      {/* Stats + Timeline + Summary — streamed in, shows skeleton while loading */}
      <Suspense fallback={<Statsskeleton />}>
        <DashboardStats start={start} end={end} label={label} />
      </Suspense>

      {/* Call log */}
      <CallsTable dateFrom={start.toISOString()} dateTo={end.toISOString()} />
    </div>
  )
}
