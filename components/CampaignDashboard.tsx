import { many, one } from '@/lib/db'
import { CallsTable } from '@/components/CallsTable'
import { RetryStuckButton } from '@/components/RetryStuckButton'
import { Timeline } from '@/components/Timeline'
import { SummaryTable } from '@/components/SummaryTable'
import { UtmBreakdown } from '@/components/UtmBreakdown'
import { DateRangeControl } from '@/components/DateRangeControl'
import { AutoRefresh } from '@/components/AutoRefresh'
import { ReanalyzeAllButton } from '@/components/ReanalyzeAllButton'
import { computeFELeadQuality, hasComplianceIssue, isPrematureHangup, COMPLIANCE_FLAG_LABELS } from '@/lib/fe-scoring'
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
  if (preset === '24h') {
    const now = new Date()
    return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now, label: 'Last 24h' }
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

// Builds a $N-numbered WHERE fragment and the matching param list, given a base parameter count.
// campaignScope is required so aggregations never bleed across campaigns; publisherScope is optional.
function scopeSql(baseCount: number, campaignScope: string, publisherScope: string) {
  let idx = baseCount
  const parts: string[] = []
  const params: unknown[] = []
  if (campaignScope) {
    idx++
    parts.push(` AND campaign_name = $${idx}`)
    params.push(campaignScope)
  }
  if (publisherScope) {
    idx++
    parts.push(` AND publisher_name = $${idx}`)
    params.push(publisherScope)
  }
  return { sql: parts.join(''), params }
}

async function getStats(start: Date, end: Date, campaignScope: string, publisherScope: string) {
  const todayStart = etMidnight(etTodayStr())
  const startIso = start.toISOString()
  const endIso = end.toISOString()
  const todayIso = todayStart.toISOString()

  const rangeScope = scopeSql(2, campaignScope, publisherScope)
  const rangeParams: unknown[] = [startIso, endIso, ...rangeScope.params]

  const todayScope = scopeSql(1, campaignScope, publisherScope)
  const todayParams: unknown[] = [todayIso, ...todayScope.params]

  const [todayRes, revenueRes, analysisRes, todayCallsRes, allRes] = await Promise.all([
    one<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM calls
       WHERE call_started_at >= $1::timestamptz${todayScope.sql}`,
      todayParams
    ),
    many<{ revenue: string | null }>(
      `SELECT revenue FROM calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz
         AND status = 'complete' AND revenue IS NOT NULL${rangeScope.sql}`,
      rangeParams
    ),
    many<{ target_name: string | null; revenue: string | null; call_outcome: string | null; flags: string[] | null; final_expense: Record<string, unknown> | null }>(
      `SELECT target_name, revenue,
              analysis->>'call_outcome' AS call_outcome,
              flags,
              analysis->'final_expense' AS final_expense
       FROM calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz
         AND status = 'complete' AND analysis IS NOT NULL${rangeScope.sql}
       LIMIT 2000`,
      rangeParams
    ),
    many<{ call_started_at: string }>(
      `SELECT call_started_at::text AS call_started_at FROM calls
       WHERE call_started_at >= $1::timestamptz${todayScope.sql}`,
      todayParams
    ),
    many<{
      campaign_name: string | null; publisher_name: string | null; status: string;
      revenue: string | null; payout: string | null; is_duplicate: boolean | null;
      quality_score: number | null; flags: string[] | null;
      utm_content: string | null; utm_source: string | null;
      utm_medium: string | null; utm_campaign: string | null; utm_id: string | null;
      call_outcome: string | null; final_expense: Record<string, unknown> | null;
    }>(
      `SELECT campaign_name, publisher_name, status, revenue, payout, is_duplicate, quality_score, flags,
              metadata->>'utm_content'  AS utm_content,
              metadata->>'utm_source'   AS utm_source,
              metadata->>'utm_medium'   AS utm_medium,
              metadata->>'utm_campaign' AS utm_campaign,
              metadata->>'utm_id'       AS utm_id,
              analysis->>'call_outcome' AS call_outcome,
              analysis->'final_expense' AS final_expense
       FROM calls
       WHERE call_started_at >= $1::timestamptz AND call_started_at <= $2::timestamptz${rangeScope.sql}
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
      const score = computeFELeadQuality(feAny, { call_outcome: r.call_outcome, flags: r.flags })
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
      const tScore = computeFELeadQuality(feAny, { call_outcome: r.call_outcome, flags: r.flags })
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

  // qualitySum/qualityCount accumulate a true mean. The previous implementation used
  // `Math.round((avg + score) / 2)` which is an exponential moving average — recent calls
  // dominated the score, and identity of the "average" wasn't invariant to ordering.
  type SRow = { name: string; incoming: number; completed: number; revenue: number; payout: number; duplicates: number; qualitySum: number; qualityCount: number; avgQuality: number | null }
  type UtmRow = SRow & { closed: number; complianceTotal: number; complianceClean: number }
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
    // Premature hangups have quality_score forced to a low value (typically 5-10) by the
    // analyzer's insufficient-audio branch — those aren't real quality signals. Exclude
    // them from the Summary/UTM avg-quality columns so an "AVG QUALITY" of 8 on a UTM
    // that got flooded with hangups doesn't misrepresent the actual creative performance.
    const skipQuality = isPrematureHangup({ call_outcome: r.call_outcome, flags: r.flags })
    const qs   = skipQuality ? null : r.quality_score

    for (const [map, key] of [[campaignMap, camp], [publisherMap, pub]] as const) {
      if (!map.has(key)) map.set(key, { name: key, incoming: 0, completed: 0, revenue: 0, payout: 0, duplicates: 0, qualitySum: 0, qualityCount: 0, avgQuality: null })
      const row = map.get(key)!
      row.incoming++
      if (r.status === 'complete') { row.completed++; row.revenue += rev; row.payout += pay }
      if (r.is_duplicate === true) row.duplicates++
      if (qs != null) { row.qualitySum += qs; row.qualityCount++ }
    }

    const utmValues: Record<UtmTag, string> = {
      utm_content:  String(r.utm_content  ?? '').trim() || '(none)',
      utm_source:   String(r.utm_source   ?? '').trim() || '(none)',
      utm_medium:   String(r.utm_medium   ?? '').trim() || '(none)',
      utm_campaign: String(r.utm_campaign ?? '').trim() || '(none)',
      utm_id:       String(r.utm_id       ?? '').trim() || '(none)',
    }
    const isClosed = r.call_outcome === 'sale_closed'
    const fe = r.final_expense
    const hasFE = fe != null
    const isClean = hasFE ? !hasComplianceIssue(fe as Parameters<typeof hasComplianceIssue>[0]) : false
    for (const tag of UTM_TAGS) {
      const key = utmValues[tag]
      const map = utmMaps[tag]
      if (!map.has(key)) map.set(key, { name: key, incoming: 0, completed: 0, revenue: 0, payout: 0, duplicates: 0, qualitySum: 0, qualityCount: 0, avgQuality: null, closed: 0, complianceTotal: 0, complianceClean: 0 })
      const row = map.get(key)!
      row.incoming++
      if (r.status === 'complete') { row.completed++; row.revenue += rev; row.payout += pay }
      if (r.is_duplicate === true) row.duplicates++
      if (qs != null) { row.qualitySum += qs; row.qualityCount++ }
      if (isClosed) row.closed++
      if (hasFE) { row.complianceTotal++; if (isClean) row.complianceClean++ }
    }
  }

  const sortRows = (m: Map<string, UtmRow>) => [...m.values()]
    .map(r => ({
      name: r.name,
      incoming: r.incoming,
      completed: r.completed,
      revenue: r.revenue,
      payout: r.payout,
      duplicates: r.duplicates,
      avgQuality: r.qualityCount > 0 ? Math.round(r.qualitySum / r.qualityCount) : null,
      closed: r.closed,
      complianceScore: r.complianceTotal > 0 ? Math.round((r.complianceClean / r.complianceTotal) * 100) : null,
      complianceTotal: r.complianceTotal,
    }))
    .sort((a, b) => b.incoming - a.incoming)

  // Same fix for the Campaign / Publisher summary rows — compute mean from sum/count.
  const finalizeSummary = (m: Map<string, SRow>) => [...m.values()]
    .map(r => ({
      ...r,
      avgQuality: r.qualityCount > 0 ? Math.round(r.qualitySum / r.qualityCount) : null,
    }))
    .sort((a, b) => b.incoming - a.incoming)

  return {
    callsToday, revenue, avgFEQuality, complianceScore, complianceTotal,
    closedRate, closedCount, overallCPA, topFlags,
    hourly, byTarget,
    byCampaign:  finalizeSummary(campaignMap),
    byPublisher: finalizeSummary(publisherMap),
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

async function DashboardStats({ start, end, label, campaignScope, publisherScope }: {
  start: Date; end: Date; label: string; campaignScope: string; publisherScope: string
}) {
  const stats = await getStats(start, end, campaignScope, publisherScope)
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

export async function CampaignDashboard({
  title, subtitle, campaignScope, searchParams,
}: {
  title: string
  subtitle: string
  campaignScope: string
  searchParams: Record<string, string>
}) {
  const preset = searchParams.preset ?? '24h'
  const publisherScope = searchParams.publisher_scope ?? ''
  const { start, end, label } = resolveRange(preset, searchParams.from ?? '', searchParams.to ?? '')

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--rb-text)' }}>{title}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>{subtitle} · {label}</p>
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
        <DashboardStats start={start} end={end} label={label} campaignScope={campaignScope} publisherScope={publisherScope} />
      </Suspense>

      <CallsTable
        dateFrom={start.toISOString()}
        dateTo={end.toISOString()}
        publisherScope={publisherScope}
        campaignScope={campaignScope}
      />
    </div>
  )
}
