import { createServiceClient } from '@/lib/supabase/server'
import { CallsTable } from '@/components/CallsTable'

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

export default async function DashboardPage() {
  const stats = await getStats()

  const qualityColor = stats.avgQuality == null ? 'text-slate-400' :
    stats.avgQuality >= 70 ? 'text-emerald-600' :
    stats.avgQuality >= 40 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Calls Today</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{stats.callsToday}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Revenue (7d)</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">${stats.weekRevenue.toFixed(0)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Avg Quality (7d)</p>
          <p className={`text-3xl font-bold mt-1 ${qualityColor}`}>{stats.avgQuality ?? '—'}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Duplicates (7d)</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{stats.duplicates}</p>
          {stats.totalWeekCalls > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">{((stats.duplicates / stats.totalWeekCalls) * 100).toFixed(1)}% rate</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Top Flags (7d)</p>
          {stats.topFlags.length === 0 ? <p className="text-sm text-slate-400 mt-1">None</p> : (
            <ul className="mt-1 space-y-0.5">
              {stats.topFlags.map(([flag, count]) => (
                <li key={flag} className="flex justify-between text-xs">
                  <span className="text-slate-600 truncate">{flag.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-slate-900 ml-2">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CallsTable />
    </div>
  )
}
