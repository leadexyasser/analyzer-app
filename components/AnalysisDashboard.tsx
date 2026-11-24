import {
  availableMonths, ECOMFY_SHARE, fetchCreatives, fetchDaily, fetchHooks, fetchTikTokAds,
  monthWindow, spendAgeMinutes, STALE_AFTER_MINUTES, tiktokSpendAgeMinutes, YASSER_SHARE,
} from '@/lib/analysis'
import { syncMetaSpend } from '@/lib/meta-sync'
import { tiktokConfigured } from '@/lib/tiktok'
import { syncTikTokSpend } from '@/lib/tiktok-sync'

// The buyer's daily commitment, shown as a target against today's conversions.
const DAILY_CAP = 125

type Props = {
  campaignScope: string
  searchParams: Record<string, string>
}

/** Accounting style: negatives in parentheses, as the spreadsheet renders them. */
function money(n: number, decimals = 2): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return n < 0 ? `(${abs})` : abs
}

function pct(n: number | null): string {
  if (n === null) return '—'
  const v = `${Math.abs(n).toFixed(1)}%`
  return n < 0 ? `(${v})` : v
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null
}

function perUnit(total: number, units: number): string {
  return units > 0 ? `$${money(total / units)}` : '—'
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

const NEG = '#e5484d'

/**
 * Re-syncs a source only when its stored spend has gone stale, or on ?refresh=1. An API
 * outage must not blank the page, so failures surface as a banner over the last stored
 * figures. Each source syncs independently: a TikTok failure never blocks Meta.
 */
async function refreshSource(
  name: string,
  ageMinutes: () => Promise<number | null>,
  sync: () => Promise<unknown>,
  force: boolean
): Promise<string | null> {
  try {
    const age = await ageMinutes()
    if (force || age === null || age > STALE_AFTER_MINUTES) await sync()
    return null
  } catch (error: unknown) {
    return `${name}: ${error instanceof Error ? error.message : 'spend sync failed'}`
  }
}

function syncedLabel(source: string, age: number | null): string {
  if (age === null) return `${source} never synced`
  return `${source} ${age < 1 ? 'just now' : `${Math.round(age)}m ago`}`
}

export async function AnalysisDashboard({ campaignScope, searchParams }: Props) {
  const win = monthWindow(searchParams.month)
  const force = searchParams.refresh === '1'
  const hasTikTok = tiktokConfigured()
  const syncErrors = (await Promise.all([
    refreshSource('Facebook', spendAgeMinutes, () => syncMetaSpend(), force),
    hasTikTok ? refreshSource('TikTok', tiktokSpendAgeMinutes, () => syncTikTokSpend(), force) : Promise.resolve(null),
  ])).filter((e): e is string => e !== null)

  const [daily, creatives, hooks, tiktokAds, ageMinutes, tiktokAge, months] = await Promise.all([
    fetchDaily(campaignScope, win.since, win.until),
    fetchCreatives(campaignScope, win.since, win.until),
    fetchHooks(win.since, win.until),
    fetchTikTokAds(campaignScope, win.since, win.until),
    spendAgeMinutes(),
    tiktokSpendAgeMinutes(),
    availableMonths(),
  ])

  const t = daily.reduce(
    (a, d) => ({
      spend: a.spend + d.spend,
      meta: a.meta + d.meta_spend,
      tiktok: a.tiktok + d.tiktok_spend,
      paid: a.paid + d.paid_calls,
      policies: a.policies + d.policies,
      revenue: a.revenue + d.revenue_effective,
    }),
    { spend: 0, meta: 0, tiktok: 0, paid: 0, policies: 0, revenue: 0 }
  )
  const netPool = t.revenue - t.spend
  const activeDays = daily.filter(d => d.spend > 0).length
  const settled = daily.every(d => d.spend === 0 || d.revenue_source === 'settled')

  // `daily` is newest-first; today is the most recent row inside the window.
  const today = daily[0]
  const todayProfit = today ? today.revenue_effective - today.spend : 0

  return (
    <main className="px-5 py-4 space-y-4">
      <header className="rounded-lg px-5 py-4 flex flex-wrap items-center justify-between gap-3"
        style={{ background: '#11151c', borderBottom: '2px solid var(--rb-accent)' }}>
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--rb-accent)' }}>
            {win.label.toUpperCase()}
          </h1>
          <p className="text-[11px] mt-1" style={{ color: '#8b94a3' }}>
            {activeDays} active days · 80 / 20 split · {settled ? 'settled from Everflow' : 'provisional'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span style={{ color: '#8b94a3' }}>
            synced · {syncedLabel('FB', ageMinutes)} · {hasTikTok || tiktokAge !== null ? syncedLabel('TikTok', tiktokAge) : 'TikTok not connected'}
          </span>
          {months.slice(0, 4).map(m => (
            <a key={m} href={`?month=${m}`} className="px-2 py-1 rounded"
              style={{ background: m === win.month ? 'var(--rb-accent)22' : '#1b212b', color: m === win.month ? 'var(--rb-accent)' : '#8b94a3' }}>
              {m}
            </a>
          ))}
          <a href={`?month=${win.month}&refresh=1`} className="px-2 py-1 rounded" style={{ background: '#1b212b', color: '#8b94a3' }}>
            Refresh
          </a>
        </div>
      </header>

      {syncErrors.map(err => (
        <p key={err} className="text-xs px-3 py-2 rounded" style={{ background: '#ff000014', color: NEG }}>
          Spend sync failed — showing the last successful pull. {err}
        </p>
      ))}

      {today && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label={`Spend · ${dayLabel(today.stat_date)}`} value={`$${money(today.spend, 0)}`}
            sub={`FB $${money(today.meta_spend, 0)} · TikTok $${money(today.tiktok_spend, 0)}`} />
          <Stat label="Revenue today" value={`$${money(today.revenue_effective, 0)}`} />
          <Stat label="Net profit today" value={`$${money(todayProfit, 0)}`} tone={todayProfit < 0 ? 'neg' : 'pos'} />
          <Stat label="ROI today" value={pct(ratio(todayProfit, today.spend))} tone={todayProfit < 0 ? 'neg' : 'pos'} />
          <Stat label="Conversions" value={`${today.paid_calls} / ${DAILY_CAP}`} tone={today.paid_calls >= DAILY_CAP ? 'pos' : undefined} />
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4 items-start">
        <section className="rounded-lg overflow-hidden" style={{ background: 'var(--rb-surface-2)' }}>
          <h2 className="px-4 py-2.5 text-[11px] font-bold tracking-widest" style={{ background: '#11151c', color: '#e8edf5' }}>
            DAILY PERFORMANCE LOG
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ background: '#161b23' }}>
                  {['DATE', 'FACEBOOK', 'TIKTOK', 'SPEND', 'CALLS', 'REVENUE', 'NET PROFIT', 'ROI', `YASSER ${YASSER_SHARE * 100}%`, `ECOMFY ${ECOMFY_SHARE * 100}%`]
                    .map((h, i) => (
                      <th key={h} className={`px-3 py-2 text-[10px] font-semibold tracking-wider whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}
                        style={{ color: '#8b94a3' }}>{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {daily.map(d => {
                  const profit = d.revenue_effective - d.spend
                  const idle = d.spend === 0 && d.paid_calls === 0
                  const neg = profit < 0
                  return (
                    <tr key={d.stat_date} style={{ borderTop: '1px solid #ffffff0d', opacity: idle ? 0.45 : 1 }}>
                      <Cell first>{dayLabel(d.stat_date)}</Cell>
                      <Cell muted>{idle ? '—' : `$${money(d.meta_spend)}`}</Cell>
                      <Cell muted>{idle ? '—' : `$${money(d.tiktok_spend)}`}</Cell>
                      <Cell>{idle ? '—' : `$${money(d.spend)}`}</Cell>
                      <Cell>{idle ? '—' : String(d.paid_calls)}</Cell>
                      <Cell>{idle ? '—' : `$${money(d.revenue_effective)}`}</Cell>
                      <Cell tone={neg ? 'neg' : undefined}>{idle ? '—' : `$${money(profit)}`}</Cell>
                      <Cell tone={neg ? 'neg' : undefined}>{idle ? '—' : pct(ratio(profit, d.spend))}</Cell>
                      <Cell tone={neg ? 'neg' : undefined}>{idle ? '—' : `$${money(profit * YASSER_SHARE)}`}</Cell>
                      <Cell tone={neg ? 'neg' : 'accent'}>{idle ? '—' : `$${money(profit * ECOMFY_SHARE)}`}</Cell>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#11151c' }}>
                  <Cell first bold>TOTAL · {win.label.split(' ')[0].toUpperCase()}</Cell>
                  <Cell bold>${money(t.meta)}</Cell>
                  <Cell bold>${money(t.tiktok)}</Cell>
                  <Cell bold>${money(t.spend)}</Cell>
                  <Cell bold>{t.paid}</Cell>
                  <Cell bold>${money(t.revenue)}</Cell>
                  <Cell bold tone={netPool < 0 ? 'neg' : undefined}>${money(netPool)}</Cell>
                  <Cell bold tone={netPool < 0 ? 'neg' : undefined}>{pct(ratio(netPool, t.spend))}</Cell>
                  <Cell bold>${money(netPool * YASSER_SHARE)}</Cell>
                  <Cell bold tone="accent">${money(netPool * ECOMFY_SHARE)}</Cell>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <aside className="space-y-3">
          <SummaryPanel title={`DUE · YASSER · ${win.label.split(' ')[0].toUpperCase()}`}>
            <div className="px-4 py-4 text-center" style={{ background: netPool < 0 ? '#2a1618' : '#132a1d' }}>
              <p className="text-2xl font-bold" style={{ color: netPool < 0 ? NEG : '#4ade80' }}>
                ${money(netPool * YASSER_SHARE)}
              </p>
              <p className="text-[10px] mt-1" style={{ color: '#8b94a3' }}>
                {YASSER_SHARE * 100}% of ${money(netPool)} net pool
              </p>
            </div>
          </SummaryPanel>

          <SummaryPanel title="MONTH TO DATE">
            <Line label="Facebook spend" value={`$${money(t.meta)}`} />
            <Line label="TikTok spend" value={`$${money(t.tiktok)}`} />
            <Line label="Ad spend" value={`$${money(t.spend)}`} />
            <Line label="Revenue" value={`$${money(t.revenue)}`} />
            <Line label="Net profit pool" value={`$${money(netPool)}`} strong tone={netPool < 0 ? 'neg' : undefined} />
            <Line label="ROI" value={pct(ratio(netPool, t.spend))} strong tone={netPool < 0 ? 'neg' : undefined} />
          </SummaryPanel>

          <SummaryPanel title={`PROFIT SPLIT · ${YASSER_SHARE * 100} / ${ECOMFY_SHARE * 100}`}>
            <Line label={`Yasser · ${YASSER_SHARE * 100}%`} value={`$${money(netPool * YASSER_SHARE)}`} />
            <Line label={`eComfy · ${ECOMFY_SHARE * 100}%`} value={`$${money(netPool * ECOMFY_SHARE)}`} tone="accent" />
          </SummaryPanel>

          <SummaryPanel title="CALL ECONOMICS">
            <Line label="Paid calls" value={t.paid.toLocaleString()} />
            <Line label="Cost per call" value={perUnit(t.spend, t.paid)} />
            <Line label="Revenue per call" value={perUnit(t.revenue, t.paid)} />
            <Line label="Calls per active day" value={activeDays ? (t.paid / activeDays).toFixed(1) : '—'} />
          </SummaryPanel>
        </aside>
      </div>

      <Panel title="By creative">
        <Table
          head={['Creative', 'Spend', 'Clicks', 'Paid calls', 'Policies', 'Cost/call', 'Cost/policy', 'Compliance risk']}
          rows={creatives.map(c => [
            c.creative ?? '(unattributed)',
            `$${money(c.spend, 0)}`,
            c.link_clicks.toLocaleString(),
            String(c.paid_calls),
            String(c.policies),
            perUnit(c.spend, c.paid_calls),
            perUnit(c.spend, c.policies),
            pct(ratio(c.compliance_risk, c.analyzed)),
          ])}
        />
      </Panel>

      <Panel title="By hook">
        <Table
          head={['Ad', 'Campaign', 'Spend', 'Clicks', 'Raw calls', 'Conversions', 'Cost/conv', 'Conv/click']}
          rows={hooks.map(h => [
            h.ad_name,
            h.campaign_name ?? '—',
            `$${money(h.spend, 0)}`,
            h.link_clicks.toLocaleString(),
            String(h.pixel_raw_calls),
            String(h.pixel_conversions),
            perUnit(h.spend, h.pixel_conversions),
            pct(ratio(h.pixel_conversions, h.link_clicks)),
          ])}
        />
      </Panel>

      <Panel title="TikTok by ad">
        <Table
          head={['Ad', 'Campaign', 'Spend', 'TikTok conv', 'Calls', 'Paid calls', 'Revenue', 'Cost/paid', 'ROI']}
          rows={tiktokAds.map(a => [
            a.ad_name ?? '(untagged)',
            a.campaign_name ?? '—',
            `$${money(a.spend, 0)}`,
            String(a.tiktok_conversions),
            String(a.calls),
            String(a.paid_calls),
            `$${money(a.revenue_at_28, 0)}`,
            perUnit(a.spend, a.paid_calls),
            a.spend > 0 ? pct(ratio(a.revenue_at_28 - a.spend, a.spend)) : '—',
          ])}
        />
      </Panel>
    </main>
  )
}

function toneColor(tone?: 'neg' | 'pos' | 'accent'): string {
  if (tone === 'neg') return NEG
  if (tone === 'pos') return '#4ade80'
  if (tone === 'accent') return 'var(--rb-accent)'
  return 'var(--rb-text-1)'
}

function Cell({ children, first, bold, muted, tone }: {
  children: React.ReactNode; first?: boolean; bold?: boolean; muted?: boolean; tone?: 'neg' | 'pos' | 'accent'
}) {
  const color = tone ? toneColor(tone) : first || muted ? 'var(--rb-text-2)' : 'var(--rb-text-1)'
  return (
    <td
      className={`px-3 py-1.5 whitespace-nowrap ${first ? 'text-left' : 'text-right tabular-nums'} ${bold ? 'font-bold' : ''}`}
      style={{ color }}
    >{children}</td>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'neg' | 'pos' }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--rb-surface-2)' }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--rb-text-3)' }}>{label}</p>
      <p className="text-lg font-bold mt-0.5" style={{ color: toneColor(tone) }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5 tabular-nums" style={{ color: 'var(--rb-text-3)' }}>{sub}</p>}
    </div>
  )
}

function SummaryPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg overflow-hidden" style={{ background: 'var(--rb-surface-2)' }}>
      <h3 className="px-4 py-2 text-[10px] font-bold tracking-widest" style={{ background: '#11151c', color: '#e8edf5' }}>
        {title}
      </h3>
      <div>{children}</div>
    </section>
  )
}

function Line({ label, value, strong, tone }: {
  label: string; value: string; strong?: boolean; tone?: 'neg' | 'accent'
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: '1px solid #ffffff0d' }}>
      <span className="text-[11px]" style={{ color: 'var(--rb-text-2)' }}>{label}</span>
      <span className={`text-xs tabular-nums ${strong ? 'font-bold' : ''}`} style={{ color: toneColor(tone) }}>{value}</span>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--rb-text-1)' }}>{title}</h2>
      <div className="overflow-x-auto rounded-lg" style={{ background: 'var(--rb-surface-2)' }}>{children}</div>
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) {
    return <p className="px-3 py-4 text-xs" style={{ color: 'var(--rb-text-3)' }}>No data in this window.</p>
  }
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}
              style={{ color: 'var(--rb-text-3)' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} style={{ borderTop: '1px solid #ffffff0d' }}>
            {r.map((cell, ci) => (
              <td key={ci} className={`px-3 py-2 whitespace-nowrap ${ci === 0 ? 'text-left' : 'text-right tabular-nums'}`}
                style={{ color: ci === 0 ? 'var(--rb-text-2)' : 'var(--rb-text-1)' }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
