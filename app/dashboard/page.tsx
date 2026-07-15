import type { Metadata } from 'next'
import { many, one } from '@/lib/db'

export const revalidate = 30
export const metadata: Metadata = { title: 'Dashboard' }
import { CallsTable } from '@/components/CallsTable'
import { RetryStuckButton } from '@/components/RetryStuckButton'
import { Timeline } from '@/components/Timeline'
import { SummaryTable } from '@/components/SummaryTable'
import { UtmBreakdown } from '@/components/UtmBreakdown'
import { DateRangeControl } from '@/components/DateRangeControl'
import { AutoRefresh } from '@/components/AutoRefresh'
import { ReanalyzeAllButton } from '@/components/ReanalyzeAllButton'
import { computeFELeadQuality, hasComplianceIssue, COMPLIANCE_FLAG_LABELS } from '@/lib/fe-scoring'
import { etTodayStr, etMidnight, etEndOfDay, shiftDateStr, etHourOf } from '@/lib/time'
import { Suspense } from 'react'
import { PublisherSwitcher } from '@/components/PublisherSwitcher'

type UtmTag = 'utm_content' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_id'

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

async function getStats(start: Date, end: Date, publisherScope: string) {
  const todayStart = etMidnight(etTodayStr())

  // Each query gets its own params array — pg's extended-protocol requires the sent param count
  // to match the highest placeholder referenced in each SQL, so we can't share one array across
  // queries that use different subsets.
  const startIso = start.toISOString()
  const endIso = end.toISOString()
  const todayIso = todayStart.toISOString()

  // Range-based queries: $1=start, $2=end, [$3=scope]
  const rangeScopeSql = publisherScope ? ` AND publisher_name = $3` : ''
  const rangeParams: unknown[] = publisherScope ? [startIso, endIso, publisherScope] : [startIso, endIso]

  // Today-only queries: $1=todayStart, [$2=scope]
  const todayScopeSql = publisherScope ? ` AND publisher_name = $2` : ''
  const todayParams: unknown[] = publisherScope ? [todayIso, publisherScope] : [todayIso]

  const [todayRes, revenueRes, analysisRes, todayCallsRes, allRes] = await Promise.all([
    one<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM calls
       WHERE call_started_at >= $1::timestamptz${todayScopeSql}`,
      todayParams
    ),
    many<{ revenue: string | null }>(
      `SELECT revenue FROM calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz
         AND status = 'complete' AND revenue IS NOT NULL${rangeScopeSql}`,
      rangeParams
    ),
    many<{ target_name: string | null; revenue: string | null; call_outcome: string | null; final_expense: Record<string, unknown> | null }>(
      `SELECT target_name, revenue,
              analysis->>'call_outcome' AS call_outcome,
              analysis->'final_expense' AS final_expense
       FROM calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz
         AND status = 'complete' AND analysis IS NOT NULL${rangeScopeSql}
       LIMIT 2000`,
      rangeParams
    ),
    many<{ call_started_at: string }>(
      `SELECT call_started_at::text AS call_started_at FROM calls
       WHERE call_started_at >= $1::timestamptz${todayScopeSql}`,
      todayParams
    ),
    many<{
      campaign_name: string | null; publisher_name: string | null; status: string;
      revenue: string | null; payout: string | null; is_duplicate: boolean | null;
      quality_score: number | null; utm_content: string | null; utm_source: string | null;
      utm_medium: string | null; utm_campaign: string | null; utm_id: string | null;
      call_outcome: string | null;
    }>(
      `SELECT campaign_name, publisher_name, status, revenue, payout, is_duplicate, quality_score,
              metadata->>'utm_content'  AS utm_content,
              metadata->>'utm_source'   AS utm_source,
              metadata->>'utm_medium'   AS utm_medium,
              metadata->>'utm_campaign' AS utm_campaign,
              metadata->>'utm_id'       AS utm_id,
              analysis->>'call_outcome' AS call_outcome
       FROM calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz${rangeScopeSql}
       LIMIT 2000`,
      rangeParams
    ),
  ])

  const callsToday = todayRes ? Number(todayRes.count) : 0
  const revenue = revenueRes.reduce((s, r) => s + Number(r.revenue ?? 0), 0)

  const feScores: number[] = []
  let complianceTotal = 0, complianceClean = 0
  const complianceFlagCounts: Record<string, number> = {}
  let closedCount = 0
  const totalAnalyzed = analysisRes.length

  type TRow = {
    name: string; incoming: number; closed: number; revenue: number;
    feScoreSum: number; feScoreCount: number;
    complianceTotal: number; complianceClean: number;
  }
  const targetMap = new Map<string, TRow>()

  for (const r of analysisRes) {
    const fe = r.final_expense as Record<string, unknown> | null
    const isClosed = r.call_outcome === 'sale_closed'
    const target = r.target_name ?? '—'
    const rev = r.revenue != null ? Number(r.revenue) : 0

    if (fe) {
      const feAny = fe as any
      const score = computeFELeadQuality(feAny)
      if (score !== null) feScores.push(score)
      complianceTotal++
      if (hasComplianceIssue(feAny)) {
        for (const key of Object.keys(COMPLIANCE_FLAG_LABELS)) {
          if (feAny[key]) complianceFlagCounts[key] = (complianceFlagCounts[key] ?? 0) + 1
        }
      } else {
        complianceClean++
      }
    }

    if (isClosed) closedCount++

    if (!targetMap.has(target)) {
      targetMap.set(target, {
        name: target, incoming: 0, closed: 0, revenue: 0,
        feScoreSum: 0, feScoreCount: 0,
        complianceTotal: 0, complianceClean: 0,
      })
    }
    const t = targetMap.get(target)!
    t.incoming++
    t.revenue += rev
    if (isClosed) t.closed++
    if (fe) {
      const feAny = fe as any
      const tScore = computeFELeadQuality(feAny)
      if (tScore !== null) { t.feScoreSum += tScore; t.feScoreCount++ }
      t.complianceTotal++
      if (!hasComplianceIssue(feAny)) t.complianceClean++
    }
  }

  const avgFEQuality = feScores.length ? Math.round(feScores.reduce((a, b) => a + b, 0) / feScores.length) : null
  const complianceScore = complianceTotal > 0 ? Math.round((complianceClean / complianceTotal) * 100) : null
  const closedRate = totalAnalyzed > 0 ? Math.round((closedCount / totalAnalyzed) * 100) : null
  const overallCPA = closedCount > 0 ? revenue / closedCount : null

  const topFlags = Object.entries(complianceFlagCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([key, count]) => [COMPLIANCE_FLAG_LABELS[key] ?? key, count] as [string, number])

  const byTarget = [...targetMap.values()]
    .map(t => ({
      name: t.name, incoming: t.incoming, closed: t.closed, revenue: t.revenue,
      cpa: t.closed > 0 ? t.revenue / t.closed : null,
      feScore: t.feScoreCount > 0 ? Math.round(t.feScoreSum / t.feScoreCount) : null,
      complianceScore: t.complianceTotal > 0 ? Math.round((t.complianceClean / t.complianceTotal) * 100) : null,
      complianceTotal: t.complianceTotal,
    }))
    .sort((a, b) => b.incoming - a.incoming)

  const hourly = Array(24).fill(0)
  for (const row of todayCallsRes) {
    const h = etHourOf(row.call_started_at)
    hourly[h] = (hourly[h] ?? 0) + 1
  }

  type SRow = { name: string; incoming: number; completed: number; revenue: number; payout: number; duplicates: number; avgQuality: number | null }
  type UtmRow = SRow & { closed: number }
  const campaignMap = new Map<string, SRow>()
  const publisherMap = new Map<string, SRow>()
  const utmMaps: Record<UtmTag, Map<string, UtmRow>> = {
    utm_content: new Map(), utm_source: new Map(), utm_medium: new Map(),
    utm_campaign: new Map(), utm_id: new Map(),
  }
  const UTM_TAGS: UtmTag[] = ['utm_content', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_id']

  for (const r of allRes) {
    const camp = r.campaign_name ?? '—'
    const pub  = r.publisher_name ?? '—'
    const rev  = r.revenue != null ? Number(r.revenue) : 0
    const pay  = r.payout  != null ? Number(r.payout)  : 0
    const qs   = r.quality_score

    for (const [map, key] of [[campaignMap, camp], [publisherMap, pub]] as const) {
      if (!map.has(key)) map.set(key, { name: key, incoming: 0, completed: 0, revenue: 0, payout: 0, duplicates: 0, avgQuality: null })
      const row = map.get(key)!
      row.incoming++
      if (r.status === 'complete') { row.completed++; row.revenue += rev; row.payout += pay }
      if (r.is_duplicate === true) row.duplicates++
      if (qs != null) row.avgQuality = row.avgQuality == null ? qs : Math.round((row.avgQuality + qs) / 2)
    }

    const utmValues: Record<UtmTag, string> = {
      utm_content:  String(r.utm_content  ?? '').trim() || '(none)',
      utm_source:   String(r.utm_source   ?? '').trim() || '(none)',
      utm_medium:   String(r.utm_medium   ?? '').trim() || '(none)',
      utm_campaign: String(r.utm_campaign ?? '').trim() || '(none)',
      utm_id:       String(r.utm_id       ?? '').trim() || '(none)',
    }
    const isClosed = r.call_outcome === 'sale_closed'
    for (const tag of UTM_TAGS) {
      const key = utmValues[tag]
      const map = utmMaps[tag]
      if (!map.has(key)) map.set(key, { name: key, incoming: 0, completed: 0, revenue: 0, payout: 0, duplicates: 0, avgQuality: null, closed: 0 })
      const row = map.get(key)!
      row.incoming++
      if (r.status === 'complete') { row.completed++; row.revenue += rev; row.payout += pay }
      if (r.is_duplicate === true) row.duplicates++
      if (qs != null) row.avgQuality = row.avgQuality == null ? qs : Math.round((row.avgQuality + qs) / 2)
      if (isClosed) row.closed++
    }
  }

  const sortRows = (m: Map<string, UtmRow>) => [...m.values()].sort((a, b) => b.incoming - a.incoming)

  return {
    callsToday, revenue, avgFEQuality, complianceScore, complianceTotal,
    closedRate, closedCount, overallCPA, topFlags,
    hourly, byTarget,
    byCampaign:  [...campaignMap.values()].sort((a, b) => b.incoming - a.incoming),
    byPublisher: [...publisherMap.values()].sort((a, b) => b.incoming - a.incoming),
    byUtm: {
      utm_content:  sortRows(utmMaps.utm_content),
      utm_source:   sortRows(utmMaps.utm_source),
      utm_medium:   sortRows(utmMaps.utm_medium),
      utm_campaign: sortRows(utmMaps.utm_campaign),
      utm_id:       sortRows(utmMaps.utm_id),
    },
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

async function DashboardStats({ start, end, label, publisherScope }: { start: Date; end: Date; label: string; publisherScope: string }) {
  const stats = await getStats(start, end, publisherScope)
  return (
    <>
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
      <UtmBreakdown byUtm={stats.byUtm} />
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
  const publisherScope = sp.publisher_scope ?? ''
  const { start, end, label } = resolveRange(preset, sp.from ?? '', sp.to ?? '')

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--rb-text)' }}>Call Logs</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>Final Expense · {label}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Suspense>
            <PublisherSwitcher />
          </Suspense>
          <Suspense>
            <DateRangeControl />
          </Suspense>
          <AutoRefresh />
          <ReanalyzeAllButton dateFrom={start.toISOString()} dateTo={end.toISOString()} />
          <RetryStuckButton />
        </div>
      </div>

      <Suspense fallback={<Statsskeleton />}>
        <DashboardStats start={start} end={end} label={label} publisherScope={publisherScope} />
      </Suspense>

      <CallsTable dateFrom={start.toISOString()} dateTo={end.toISOString()} publisherScope={publisherScope} />
    </div>
  )
}
