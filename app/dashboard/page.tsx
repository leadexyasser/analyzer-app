import { createServiceClient } from '@/lib/supabase/server'
import { CallsTable } from '@/components/CallsTable'
import { RetryStuckButton } from '@/components/RetryStuckButton'
import { Timeline } from '@/components/Timeline'
import { SummaryTable } from '@/components/SummaryTable'
import { DateRangeControl } from '@/components/DateRangeControl'
import { computeFELeadQuality, hasComplianceIssue, COMPLIANCE_FLAG_LABELS } from '@/lib/fe-scoring'
import { Suspense } from 'react'

function resolveRange(preset: string, from: string, to: string): { start: Date; end: Date; label: string } {
  const now = new Date()
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  if (preset === 'custom' && (from || to)) {
    const start = from ? new Date(from) : new Date(0)
    const customEnd = to ? (() => { const d = new Date(to); d.setHours(23,59,59,999); return d })() : end
    return { start, end: customEnd, label: `${from || '…'} → ${to || '…'}` }
  }
  if (preset === 'Today') {
    const start = new Date(now); start.setHours(0,0,0,0)
    return { start, end, label: 'Today' }
  }
  const days = preset === '30d' ? 30 : preset === '90d' ? 90 : 7
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return { start, end, label: `Last ${days} days` }
}

async function getStats(start: Date, end: Date) {
  const supabase = createServiceClient()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const [todayRes, revenueRes, analysisRes, todayCallsRes, allRes] = await Promise.all([
    supabase.from('calls').select('id', { count: 'exact', head: true }).gte('received_at', todayStart.toISOString()),
    supabase.from('calls').select('revenue').gte('received_at', start.toISOString()).lte('received_at', end.toISOString()).eq('status', 'complete').not('revenue', 'is', null),
    supabase.from('calls').select('analysis').gte('received_at', start.toISOString()).lte('received_at', end.toISOString()).eq('status', 'complete').not('analysis', 'is', null),
    supabase.from('calls').select('received_at').gte('received_at', todayStart.toISOString()),
    supabase.from('calls').select('campaign_name,publisher_name,status,revenue,payout,is_duplicate,quality_score').gte('received_at', start.toISOString()).lte('received_at', end.toISOString()),
  ])

  const callsToday = todayRes.count ?? 0
  const revenue = (revenueRes.data ?? []).reduce((s: number, r: any) => s + Number(r.revenue ?? 0), 0)

  const feScores: number[] = []
  let complianceTotal = 0, complianceClean = 0
  const complianceFlagCounts: Record<string, number> = {}

  for (const row of analysisRes.data ?? []) {
    const fe = (row.analysis as any)?.final_expense
    if (!fe) continue
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

  const avgFEQuality = feScores.length ? Math.round(feScores.reduce((a, b) => a + b, 0) / feScores.length) : null
  const complianceScore = complianceTotal > 0 ? Math.round((complianceClean / complianceTotal) * 100) : null
  const topFlags = Object.entries(complianceFlagCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([key, count]) => [COMPLIANCE_FLAG_LABELS[key] ?? key, count] as [string, number])

  const hourly = Array(24).fill(0)
  for (const row of todayCallsRes.data ?? []) {
    const h = new Date(row.received_at).getHours()
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
    callsToday, revenue, avgFEQuality, complianceScore, complianceTotal, topFlags,
    hourly,
    byCampaign:  [...campaignMap.values()].sort((a, b) => b.incoming - a.incoming),
    byPublisher: [...publisherMap.values()].sort((a, b) => b.incoming - a.incoming),
  }
}

function StatCard({ label, value, sub, accent = false, warn = false }: {
  label: string; value: string; sub?: string; accent?: boolean; warn?: boolean
}) {
  return (
    <div className="rounded-xl px-5 py-4 space-y-1" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: accent ? 'var(--rb-accent)' : warn ? 'var(--rb-amber)' : 'var(--rb-text)' }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>{sub}</p>}
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
  const stats = await getStats(start, end)

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--rb-text)' }}>Call Logs</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>Final Expense · {label}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Suspense>
            <DateRangeControl />
          </Suspense>
          <RetryStuckButton />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Calls Today" value={String(stats.callsToday)} />
        <StatCard label={`Revenue (${label})`} value={`$${stats.revenue.toFixed(0)}`} accent />
        <StatCard
          label={`FE Lead Quality (${label})`}
          value={stats.avgFEQuality != null ? `${stats.avgFEQuality}%` : '—'}
          sub="avg weighted score"
        />
        <StatCard
          label={`Compliance Score (${label})`}
          value={stats.complianceScore != null ? `${stats.complianceScore}%` : '—'}
          sub={stats.complianceTotal > 0 ? `${stats.complianceTotal} analyzed calls` : undefined}
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

      {/* Timeline */}
      <Timeline hourly={stats.hourly} />

      {/* Summary breakdown */}
      <SummaryTable byCampaign={stats.byCampaign} byPublisher={stats.byPublisher} />

      {/* Call log */}
      <CallsTable />
    </div>
  )
}
