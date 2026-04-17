import { createServiceClient } from '@/lib/supabase/server'
import { CallsTable } from '@/components/CallsTable'
import { RetryStuckButton } from '@/components/RetryStuckButton'

async function getStats() {
  const supabase = createServiceClient()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [todayRes, weekRevenueRes, weekQualityRes, weekFlagsRes, outcomesRes, duplicatesRes] = await Promise.all([
    supabase.from('calls').select('id', { count: 'exact', head: true }).gte('received_at', todayStart.toISOString()),
    supabase.from('calls').select('revenue').gte('received_at', weekStart.toISOString()).eq('status', 'complete').not('revenue', 'is', null),
    supabase.from('calls').select('quality_score').gte('received_at', weekStart.toISOString()).eq('status', 'complete').not('quality_score', 'is', null),
    supabase.from('calls').select('flags').gte('received_at', weekStart.toISOString()).eq('status', 'complete'),
    supabase.from('calls').select('analysis').gte('received_at', weekStart.toISOString()).eq('status', 'complete').not('analysis', 'is', null),
    supabase.from('calls').select('id', { count: 'exact', head: true }).gte('received_at', weekStart.toISOString()).eq('is_duplicate', true),
  ])

  const callsToday = todayRes.count ?? 0
  const weekRevenue = (weekRevenueRes.data ?? []).reduce((s: number, r: any) => s + Number(r.revenue ?? 0), 0)
  const scores = (weekQualityRes.data ?? []).map((r: any) => r.quality_score as number)
  const avgQuality = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  const duplicates = duplicatesRes.count ?? 0

  const flagCounts: Record<string, number> = {}
  for (const row of weekFlagsRes.data ?? []) {
    for (const flag of (row.flags as string[] | null) ?? []) {
      flagCounts[flag] = (flagCounts[flag] ?? 0) + 1
    }
  }
  const topFlags = Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)

  const outcomeCounts: Record<string, number> = {}
  for (const row of outcomesRes.data ?? []) {
    const outcome = (row.analysis as any)?.call_outcome
    if (outcome) outcomeCounts[outcome] = (outcomeCounts[outcome] ?? 0) + 1
  }

  return { callsToday, weekRevenue, avgQuality, duplicates, topFlags, outcomeCounts, totalWeekCalls: scores.length }
}

function StatCard({
  label, value, sub, accent = false, warn = false,
}: {
  label: string; value: string; sub?: string; accent?: boolean; warn?: boolean
}) {
  const valColor = accent ? 'var(--rb-accent)' : warn ? 'var(--rb-amber)' : 'var(--rb-text)'
  return (
    <div
      className="rounded-xl px-5 py-4 space-y-1"
      style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: valColor }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>{sub}</p>}
    </div>
  )
}

export default async function DashboardPage() {
  const stats = await getStats()

  const qColor = stats.avgQuality == null ? 'var(--rb-text-3)'
    : stats.avgQuality >= 70 ? 'var(--rb-green)'
    : stats.avgQuality >= 40 ? 'var(--rb-amber)'
    : 'var(--rb-red)'

  return (
    <div className="space-y-5">

      {/* Page title + actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--rb-text)' }}>Call Logs</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>Final Expense · All campaigns</p>
        </div>
        <RetryStuckButton />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Calls Today" value={String(stats.callsToday)} />
        <StatCard label="Revenue (7d)" value={`$${stats.weekRevenue.toFixed(0)}`} accent />
        <StatCard
          label="Avg Quality (7d)"
          value={stats.avgQuality != null ? String(stats.avgQuality) : '—'}
          sub="out of 100"
        />
        <StatCard
          label="Duplicates (7d)"
          value={String(stats.duplicates)}
          sub={stats.totalWeekCalls > 0 ? `${((stats.duplicates / stats.totalWeekCalls) * 100).toFixed(1)}% rate` : undefined}
          warn={stats.duplicates > 0}
        />
        <div
          className="rounded-xl px-5 py-4"
          style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>
            Top Flags (7d)
          </p>
          {stats.topFlags.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>None</p>
          ) : (
            <ul className="space-y-1">
              {stats.topFlags.map(([flag, count]) => (
                <li key={flag} className="flex justify-between items-center text-xs">
                  <span className="truncate" style={{ color: 'var(--rb-text-2)' }}>{flag.replace(/_/g, ' ')}</span>
                  <span className="font-bold ml-2 tabular-nums" style={{ color: 'var(--rb-text)' }}>{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Table */}
      <CallsTable />
    </div>
  )
}
