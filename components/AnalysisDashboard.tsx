import {
  availableMonths, ECOMFY_SHARE, fetchCreatives, fetchDaily, fetchHooks, fetchMonthTotals,
  monthWindow, previousMonth, spendAgeMinutes, STALE_AFTER_MINUTES, YASSER_SHARE,
} from '@/lib/analysis'
import { syncMetaSpend } from '@/lib/meta-sync'

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

// Where each day's revenue came from, worst to best authority.
const SOURCE_LABEL: Record<string, string> = {
  settled: 'settled',
  webhook: 'Everflow live',
  calls: 'call records',
}

/**
 * Re-syncs only when stored spend has gone stale, or on ?refresh=1. A Meta outage must
 * not blank the page, so failures surface as a banner over the last stored figures.
 */
async function refreshIfStale(force: boolean): Promise<string | null> {
  try {
    const age = await spendAgeMinutes()
    if (force || age === null || age > STALE_AFTER_MINUTES) await syncMetaSpend()
    return null
  } catch (error: unknown) {
    return error instanceof Error ? error.message : 'Spend sync failed'
  }
}

export async function AnalysisDashboard({ campaignScope, searchParams }: Props) {
  const win = monthWindow(searchParams.month)
  const syncError = await refreshIfStale(searchParams.refresh === '1')

  const [daily, creatives, hooks, ageMinutes, months, prevTotals] = await Promise.all([
    fetchDaily(campaignScope, win.since, win.until),
    fetchCreatives(campaignScope, win.since, win.until),
    fetchHooks(win.since, win.until),
    spendAgeMinutes(),
    availableMonths(),
    fetchMonthTotals(campaignScope, previousMonth(win.month)),
  ])

  const t = daily.reduce(
    (a, d) => ({
      spend: a.spend + d.spend,
      clicks: a.clicks + d.link_clicks,
      raw: a.raw + d.pixel_raw_calls,
      paid: a.paid + d.paid_calls,
      policies: a.policies + d.policies,
      revEff: a.revEff + d.revenue_effective,
      rev28: a.rev28 + d.revenue_at_28,
      revActual: a.revActual + d.revenue_actual,
      revWebhook: a.revWebhook + (d.revenue_webhook ?? 0),
      revSettled: a.revSettled + (d.revenue_settled ?? 0),
    }),
    { spend: 0, clicks: 0, raw: 0, paid: 0, policies: 0, revEff: 0, rev28: 0, revActual: 0, revWebhook: 0, revSettled: 0 }
  )
  const netPool = t.revEff - t.spend
  const activeDays = daily.filter(d => d.spend > 0).length
  const settledDays = daily.filter(d => d.revenue_source === 'settled').length
  const webhookDays = daily.filter(d => d.revenue_source === 'webhook').length

  // `daily` is newest-first; today is the most recent row inside the window.
  const today = daily[0]
  const todayProfit = today ? today.revenue_effective - today.spend : 0
  const prevPool = prevTotals.revenue_effective - prevTotals.spend

  return (
    <main className="px-5 py-4 space-y-4">
      <header className="rounded-lg px-5 py-4 flex flex-wrap items-center justify-between gap-3"
        style={{ background: '#11151c', borderBottom: '2px solid var(--rb-accent)' }}>
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--rb-accent)' }}>
            {win.label.toUpperCase()}
          </h1>
          <p className="text-[11px] mt-1" style={{ color: '#8b94a3' }}>
            eComfy × Yessmedia · Daily Performance Log · {activeDays} active days · 80 / 20 Split
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span style={{ color: '#8b94a3' }}>
            {ageMinutes === null ? 'never synced' : `synced ${ageMinutes < 1 ? 'just now' : `${Math.round(ageMinutes)}m ago`}`}
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

      {syncError && (
        <p className="text-xs px-3 py-2 rounded" style={{ background: '#ff000014', color: NEG }}>
          Spend sync failed — showing the last successful pull. {syncError}
        </p>
      )}

      {today && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label={`Spend · ${dayLabel(today.stat_date)}`} value={`$${money(today.spend, 0)}`} />
          <Stat label={`Revenue today · ${SOURCE_LABEL[today.revenue_source]}`} value={`$${money(today.revenue_effective, 0)}`} />
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
                  {['DATE', 'SPEND', 'CLICKS', 'RAW', 'PAID', 'REVENUE', 'SOURCE', 'CRM @ $28', 'Δ', 'NET PROFIT', 'ROI', `YASSER ${YASSER_SHARE * 100}%`, `ECOMFY ${ECOMFY_SHARE * 100}%`]
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
                  // Gap between what the network credits and what the call log claims.
                  // A negative number is revenue Ringba counted that Everflow did not.
                  const variance = d.revenue_source === 'calls' ? null : d.revenue_effective - d.revenue_at_28
                  return (
                    <tr key={d.stat_date} style={{ borderTop: '1px solid #ffffff0d', opacity: idle ? 0.45 : 1 }}>
                      <Cell first>{dayLabel(d.stat_date)}</Cell>
                      <Cell>{idle ? '—' : `$${money(d.spend)}`}</Cell>
                      <Cell>{idle ? '—' : d.link_clicks.toLocaleString()}</Cell>
                      <Cell>{idle ? '—' : d.pixel_raw_calls.toLocaleString()}</Cell>
                      <Cell>{idle ? '—' : String(d.paid_calls)}</Cell>
                      <Cell>{idle ? '—' : `$${money(d.revenue_effective)}`}</Cell>
                      <Cell tone={d.revenue_source === 'settled' ? 'pos' : d.revenue_source === 'webhook' ? 'accent' : undefined}>
                        {idle ? '—' : SOURCE_LABEL[d.revenue_source]}
                      </Cell>
                      <Cell>{idle ? '—' : `$${money(d.revenue_at_28)}`}</Cell>
                      <Cell tone={variance !== null && variance < 0 ? 'neg' : undefined}>
                        {idle || variance === null ? '—' : `$${money(variance)}`}
                      </Cell>
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
                  <Cell bold>${money(t.spend)}</Cell>
                  <Cell bold>{t.clicks.toLocaleString()}</Cell>
                  <Cell bold>{t.raw.toLocaleString()}</Cell>
                  <Cell bold>{t.paid}</Cell>
                  <Cell bold>${money(t.revEff)}</Cell>
                  <Cell bold>{settledDays > 0 || webhookDays > 0 ? `${settledDays}s / ${webhookDays}w` : '—'}</Cell>
                  <Cell bold>${money(t.rev28)}</Cell>
                  <Cell bold tone={t.revEff - t.rev28 < 0 ? 'neg' : undefined}>${money(t.revEff - t.rev28)}</Cell>
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

          <SummaryPanel title={`${win.label.split(' ')[0].toUpperCase()} MONTH TO DATE`}>
            <Line label="Total ad spend" value={`$${money(t.spend)}`} />
            <Line label="Revenue · booked" value={`$${money(t.revEff)}`} strong />
            <Line label="Net profit pool" value={`$${money(netPool)}`} strong tone={netPool < 0 ? 'neg' : undefined} />
            <Line label="ROI" value={pct(ratio(netPool, t.spend))} strong tone={netPool < 0 ? 'neg' : undefined} />
          </SummaryPanel>

          <SummaryPanel title="REVENUE SOURCES">
            <Line label={`Settled export · ${settledDays} day${settledDays === 1 ? '' : 's'}`} value={t.revSettled > 0 ? `$${money(t.revSettled)}` : '—'} tone={t.revSettled > 0 ? 'accent' : undefined} />
            <Line label={`Everflow live · ${webhookDays} day${webhookDays === 1 ? '' : 's'}`} value={t.revWebhook > 0 ? `$${money(t.revWebhook)}` : '—'} />
            <Line label="Call records · ISI @ $28" value={`$${money(t.rev28)}`} muted />
            <Line label="Call records · as billed" value={`$${money(t.revActual)}`} muted />
            <Line label="Booked vs call records" value={`$${money(t.revEff - t.rev28)}`} tone={t.revEff - t.rev28 < 0 ? 'neg' : undefined} />
          </SummaryPanel>

          <SummaryPanel title={`PROFIT SPLIT · ${YASSER_SHARE * 100} / ${ECOMFY_SHARE * 100}`}>
            <Line label="Net profit pool" value={`$${money(netPool)}`} strong />
            <Line label={`Yasser · ${YASSER_SHARE * 100}%`} value={`$${money(netPool * YASSER_SHARE)}`} />
            <Line label={`eComfy · ${ECOMFY_SHARE * 100}%`} value={`$${money(netPool * ECOMFY_SHARE)}`} tone="accent" />
          </SummaryPanel>

          <SummaryPanel title="CALL ECONOMICS">
            <Line label="Paid calls" value={t.paid.toLocaleString()} />
            <Line label="Cost per paid call" value={perUnit(t.spend, t.paid)} />
            <Line label="Revenue per paid call" value={perUnit(t.rev28, t.paid)} />
            <Line label="Policies written" value={t.policies.toLocaleString()} />
            <Line label="Cost per policy" value={perUnit(t.spend, t.policies)} />
            <Line label="Avg conversions / active day" value={activeDays ? (t.paid / activeDays).toFixed(1) : '—'} />
          </SummaryPanel>

          <SummaryPanel title="PREVIOUS MONTH">
            <Line label={previousMonth(win.month)} value={`$${money(prevPool)}`} tone={prevPool < 0 ? 'neg' : undefined} />
            <Line label="Carried forward" value={prevPool < 0 ? `$${money(prevPool)}` : '—'} tone={prevPool < 0 ? 'neg' : undefined} muted />
          </SummaryPanel>

          <p className="text-[10px] leading-relaxed px-1" style={{ color: '#6b7280' }}>
            Spend is Meta ad account FP 7 only. Revenue values Insurance Supermarket at $28 a
            call and every other buyer at its billed rate. Figures come straight from Meta and
            your call records, so they will not match a hand-entered sheet exactly.
          </p>
        </aside>
      </div>

      <Panel title="By creative" note="Revenue and policies come from call records, so these are authoritative.">
        <Table
          head={['Creative', 'Spend', 'Clicks', 'Paid', 'Policies', 'Cost/paid', 'Cost/policy', 'Compliance risk', 'Revenue', 'ROI']}
          rows={creatives.map(c => [
            c.creative ?? '(unattributed)',
            `$${money(c.spend, 0)}`,
            c.link_clicks.toLocaleString(),
            String(c.paid_calls),
            String(c.policies),
            perUnit(c.spend, c.paid_calls),
            perUnit(c.spend, c.policies),
            pct(ratio(c.compliance_risk, c.analyzed)),
            `$${money(c.revenue_at_28, 0)}`,
            pct(ratio(c.revenue_at_28 - c.spend, c.spend)),
          ])}
        />
      </Panel>

      <Panel
        title="By hook"
        note="Meta-attributed per ad. No revenue column on purpose: the UTMs carry the campaign name, so two ads inside one campaign cannot be told apart in call records. Benchmarks +4% on raw calls and -6% on conversions against Ringba — biased alike across ads, so it ranks hooks fairly."
      >
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
    </main>
  )
}

function toneColor(tone?: 'neg' | 'pos' | 'accent'): string {
  if (tone === 'neg') return NEG
  if (tone === 'pos') return '#4ade80'
  if (tone === 'accent') return 'var(--rb-accent)'
  return 'var(--rb-text-1)'
}

function Cell({ children, first, bold, tone }: {
  children: React.ReactNode; first?: boolean; bold?: boolean; tone?: 'neg' | 'pos' | 'accent'
}) {
  return (
    <td
      className={`px-3 py-1.5 whitespace-nowrap ${first ? 'text-left' : 'text-right tabular-nums'} ${bold ? 'font-bold' : ''}`}
      style={{ color: tone ? toneColor(tone) : first ? 'var(--rb-text-2)' : 'var(--rb-text-1)' }}
    >{children}</td>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'neg' | 'pos' }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--rb-surface-2)' }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--rb-text-3)' }}>{label}</p>
      <p className="text-lg font-bold mt-0.5" style={{ color: toneColor(tone) }}>{value}</p>
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

function Line({ label, value, strong, muted, tone }: {
  label: string; value: string; strong?: boolean; muted?: boolean; tone?: 'neg' | 'accent'
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: '1px solid #ffffff0d' }}>
      <span className="text-[11px]" style={{ color: muted ? '#6b7280' : 'var(--rb-text-2)' }}>{label}</span>
      <span className={`text-xs tabular-nums ${strong ? 'font-bold' : ''}`} style={{ color: toneColor(tone) }}>{value}</span>
    </div>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--rb-text-1)' }}>{title}</h2>
      {note && <p className="text-[11px] max-w-4xl" style={{ color: 'var(--rb-text-3)' }}>{note}</p>}
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
