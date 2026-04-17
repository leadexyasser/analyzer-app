import { createServiceClient } from '@/lib/supabase/server'
import { CallsTable } from '@/components/CallsTable'
import { RetryStuckButton } from '@/components/RetryStuckButton'
import { Timeline } from '@/components/Timeline'
import { SummaryTable } from '@/components/SummaryTable'
import { computeFELeadQuality, hasComplianceIssue, COMPLIANCE_FLAG_LABELS } from '@/lib/fe-scoring'

async function getStats() {
  const supabase = createServiceClient()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [todayRes, weekRevenueRes, weekAnalysisRes, todayCallsRes, weekAllRes] = await Promise.all([
    supabase.from('calls').select('id', { count: 'exact', head: true }).gte('received_at', todayStart.toISOString()),
    supabase.from('calls').select('revenue').gte('received_at', weekStart.toISOString()).eq('status', 'complete').not('revenue', 'is', null),
    supabase.from('calls').select('analysis').gte('received_at', weekStart.toISOString()).eq('status', 'complete').not('analysis', 'is', null),
    // For timeline: all today's calls with timestamps
    supabase.from('calls').select('received_at').gte('received_at', todayStart.toISOString()),
    // For summary: all week's calls with grouping fields
    supabase.from('calls').select('campaign_name,publisher_name,status,revenue,payout,is_duplicate,quality_score').gte('received_at', weekStart.toISOString()),
  ])

  const callsToday = todayRes.count ?? 0
  const weekRevenue = (weekRevenueRes.data ?? []).reduce((s: number, r: any) => s + Number(r.revenue ?? 0), 0)

  // FE Lead Quality: average computeFELeadQuality across calls that have FE data
  const feScores: number[] = []
  let complianceTotal = 0
  let complianceClean = 0
  const complianceFlagCounts: Record<string, number> = {}

  for (const row of weekAnalysisRes.data ?? []) {
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
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => [COMPLIANCE_FLAG_LABELS[key] ?? key, count] as [string, number])

  // Timeline: bucket by hour
  const hourly = Array(24).fill(0)
  for (const row of todayCallsRes.data ?? []) {
    const h = new Date(row.received_at).getHours()
    hourly[h] = (hourly[h] ?? 0) + 1
  }

  // Summary: group by campaign and publisher
  type SRow = { name: string; incoming: number; completed: number; revenue: number; payout: number; duplicates: number; avgQuality: number | null }
  const campaignMap = new Map<string, SRow>()
  const publisherMap = new Map<string, SRow>()

  for (const r of weekAllRes.data ?? []) {
    const camp = r.campaign_name ?? '—'
    const pub = r.publisher_name ?? '—'
    const rev = r.revenue != null ? Number(r.revenue) : 0
    const pay = r.payout != null ? Number(r.payout) : 0
    const isComplete = r.status === 'complete'
    const isDup = r.is_duplicate === true
    const qs = r.quality_score as number | null

    for (const [map, key] of [[campaignMap, camp], [publisherMap, pub]] as const) {
      if (!map.has(key)) map.set(key, { name: key, incoming: 0, completed: 0, revenue: 0, payout: 0, duplicates: 0, avgQuality: null })
      const row = map.get(key)!
      row.incoming++
      if (isComplete) { row.completed++; row.revenue += rev; row.payout += pay }
      if (isDup) row.duplicates++
      if (qs != null) row.avgQuality = row.avgQuality == null ? qs : Math.round((row.avgQuality + qs) / 2)
    }
  }

  const byCampaign = [...campaignMap.values()].sort((a, b) => b.incoming - a.incoming)
  const byPublisher = [...publisherMap.values()].sort((a, b) => b.incoming - a.incoming)

  return { callsToday, weekRevenue, avgFEQuality, complianceScore, complianceTotal, topFlags, hourly, byCampaign, byPublisher }
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

export default async function DashboardPage() {
  const stats = await getStats()

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--rb-text)' }}>Call Logs</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>Final Expense · 7-day window</p>
        </div>
        <RetryStuckButton />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Calls Today" value={String(stats.callsToday)} />
        <StatCard label="Revenue (7d)" value={`$${stats.weekRevenue.toFixed(0)}`} accent />
        <StatCard
          label="FE Lead Quality (7d)"
          value={stats.avgFEQuality != null ? `${stats.avgFEQuality}` : '—'}
          sub="avg weighted score / 100"
        />
        <StatCard
          label="Compliance Score (7d)"
          value={stats.complianceScore != null ? `${stats.complianceScore}%` : '—'}
          sub={stats.complianceTotal > 0 ? `${stats.complianceTotal} analyzed calls` : undefined}
          accent={stats.complianceScore != null && stats.complianceScore >= 90}
          warn={stats.complianceScore != null && stats.complianceScore < 80}
        />
        <div className="rounded-xl px-5 py-4" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Compliance Flags (7d)</p>
          {stats.topFlags.length === 0
            ? <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>None detected</p>
            : <ul className="space-y-1">
                {stats.topFlags.map(([label, count]) => (
                  <li key={label} className="flex justify-between items-center text-xs">
                    <span className="truncate" style={{ color: 'var(--rb-text-2)' }}>{label}</span>
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
