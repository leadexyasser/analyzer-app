import { createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CallList } from '@/components/CallList'

async function getStats() {
  const supabase = createServiceClient()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - 7)

  const [callsTodayRes, avgQualityRes, topFlagsRes, groqUsageRes] = await Promise.all([
    supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .gte('received_at', todayStart.toISOString()),

    supabase
      .from('calls')
      .select('quality_score')
      .eq('status', 'complete')
      .gte('received_at', weekStart.toISOString())
      .not('quality_score', 'is', null),

    supabase
      .from('calls')
      .select('flags')
      .eq('status', 'complete')
      .gte('received_at', weekStart.toISOString())
      .not('flags', 'is', null),

    supabase
      .from('api_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString()),
  ])

  const callsToday = callsTodayRes.count ?? 0
  const groqRequests = groqUsageRes.count ?? 0

  const scores = (avgQualityRes.data?.map((r) => r.quality_score).filter((s): s is number => s != null)) ?? []
  const avgQuality = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null

  // Count flag frequency this week
  const flagCounts: Record<string, number> = {}
  for (const row of topFlagsRes.data ?? []) {
    for (const flag of row.flags ?? []) {
      flagCounts[flag] = (flagCounts[flag] ?? 0) + 1
    }
  }
  const topFlags = Object.entries(flagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([flag, count]) => ({ flag, count }))

  return { callsToday, avgQuality, topFlags, groqRequests }
}

export default async function DashboardPage() {
  const stats = await getStats()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Real-time call analysis overview</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Calls Today</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.callsToday}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Quality (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {stats.avgQuality != null ? (
                <span className={stats.avgQuality >= 70 ? 'text-green-600' : stats.avgQuality >= 40 ? 'text-yellow-600' : 'text-red-600'}>
                  {stats.avgQuality}
                </span>
              ) : '—'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top Flags (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topFlags.length === 0 ? (
              <p className="text-sm text-muted-foreground">None</p>
            ) : (
              <ul className="space-y-1">
                {stats.topFlags.map(({ flag, count }) => (
                  <li key={flag} className="text-xs flex justify-between">
                    <span className="truncate">{flag.replace(/_/g, ' ')}</span>
                    <span className="font-medium ml-2">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Groq Requests Today</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.groqRequests}</p>
          </CardContent>
        </Card>
      </div>

      <CallList />
    </div>
  )
}
