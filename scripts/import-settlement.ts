/**
 * Imports a settled Everflow export into network_settlement_daily.
 *
 *   npx tsx scripts/import-settlement.ts <file> [--dry]
 *
 * Accepts JSON (an array, or one object per line as Everflow's "EntityExport" emits)
 * and CSV. Field names are matched loosely because the export's column set changes with
 * the grouping chosen in Reporting — a date-grouped report and an offer-grouped one do
 * not share header names.
 *
 * A row without a date is skipped rather than guessed at: a settlement figure filed
 * against the wrong day is worse than one that is missing, because it silently moves
 * revenue between days instead of leaving an obvious gap.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pool } from '../lib/db'

type Row = Record<string, unknown>

const DATE_KEYS = ['date', 'stat_date', 'day', 'date_str', 'conversion_date', 'entry_date']
const OFFER_ID_KEYS = ['network_offer_id', 'offer_id', 'offer']
const OFFER_NAME_KEYS = ['offer_name', 'offer', 'name']
const CONV_KEYS = ['cv', 'conversions', 'total_cv', 'conversion_count', 'num_conversions']
const REVENUE_KEYS = ['revenue', 'total_revenue', 'payout', 'total_payout', 'earnings']

function findKey(row: Row, candidates: string[]): string | null {
  const lower = new Map(Object.keys(row).map(k => [k.toLowerCase().replace(/[\s_-]/g, ''), k]))
  for (const c of candidates) {
    const hit = lower.get(c.toLowerCase().replace(/[\s_-]/g, ''))
    if (hit) return hit
  }
  return null
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? '').replace(/[$,%\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Normalises to YYYY-MM-DD, or null when the value isn't a date. */
function toDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return []
  // Handles quoted fields containing commas.
  const split = (line: string): string[] => {
    const out: string[] = []
    let cur = '', inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) { out.push(cur); cur = '' } else cur += ch
    }
    out.push(cur)
    return out.map(s => s.trim())
  }
  const header = split(lines[0])
  return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [header[i] ?? `col${i}`, v])))
}

function parseFile(path: string): Row[] {
  const text = readFileSync(path, 'utf8').trim()
  if (path.toLowerCase().endsWith('.csv')) return parseCsv(text)
  if (text.startsWith('[')) return JSON.parse(text) as Row[]
  // Everflow's EntityExport is newline-delimited JSON objects.
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l) as Row)
}

async function main() {
  const [path, ...flags] = process.argv.slice(2)
  if (!path) throw new Error('usage: npx tsx scripts/import-settlement.ts <file> [--dry]')
  const dry = flags.includes('--dry')

  const rows = parseFile(path)
  if (rows.length === 0) throw new Error(`No rows parsed from ${path}`)

  console.log(`Parsed ${rows.length} row(s) from ${basename(path)}`)
  console.log(`Columns: ${Object.keys(rows[0]).join(', ')}\n`)

  const dateKey = findKey(rows[0], DATE_KEYS)
  if (!dateKey) {
    console.error('NO DATE COLUMN FOUND — this export has no date dimension.')
    console.error('Re-export from Reporting with Date added as a grouping, otherwise')
    console.error('the figures cannot be attributed to a day.')
    process.exit(2)
  }

  const offerIdKey = findKey(rows[0], OFFER_ID_KEYS)
  const offerNameKey = findKey(rows[0], OFFER_NAME_KEYS)
  const convKey = findKey(rows[0], CONV_KEYS)
  const revKey = findKey(rows[0], REVENUE_KEYS)
  if (!revKey) throw new Error(`No revenue column found. Columns: ${Object.keys(rows[0]).join(', ')}`)
  console.log(`Mapped: date=${dateKey} offer=${offerIdKey ?? '-'} conv=${convKey ?? '-'} revenue=${revKey}\n`)

  // An export is a snapshot. Taken at 11am it holds a few hours of the current day, and
  // importing that as settled would pin today's revenue to a partial figure while the
  // real number keeps climbing — exactly what happened on 2026-10-29 ($112 settled
  // against $364 actual). A day can only be settled once it is over.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const partial: string[] = []

  const parsed = rows.flatMap(r => {
    const stat_date = toDate(r[dateKey])
    if (!stat_date) return []
    if (stat_date >= today) { partial.push(stat_date); return [] }
    return [{
      stat_date,
      offer_id: offerIdKey ? String(r[offerIdKey] ?? 'all') : 'all',
      offer_name: offerNameKey ? String(r[offerNameKey] ?? '') : null,
      conversions: convKey ? Math.round(num(r[convKey])) : 0,
      revenue: num(r[revKey]),
    }]
  })

  const skipped = rows.length - parsed.length - partial.length
  const total = parsed.reduce((a, r) => a + r.revenue, 0)
  const conv = parsed.reduce((a, r) => a + r.conversions, 0)
  const dates = parsed.map(r => r.stat_date).sort()
  if (partial.length > 0) {
    console.log(`Skipped ${partial.length} row(s) dated today or later (${[...new Set(partial)].join(', ')}) — a day in progress cannot be settled.`)
  }
  if (parsed.length === 0) {
    console.log('Nothing to import.')
    await pool.end()
    return
  }
  console.log(`${parsed.length} row(s) ready${skipped > 0 ? `, ${skipped} skipped (no date)` : ''}`)
  console.log(`Range ${dates[0]} → ${dates[dates.length - 1]}`)
  console.log(`Conversions ${conv.toLocaleString()}  Revenue $${total.toFixed(2)}\n`)

  if (dry) { console.log('--dry: nothing written'); await pool.end(); return }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const r of parsed) {
      await client.query(
        `INSERT INTO network_settlement_daily
           (stat_date, offer_id, offer_name, conversions, revenue, source_file)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (stat_date, offer_id) DO UPDATE SET
           offer_name  = excluded.offer_name,
           conversions = excluded.conversions,
           revenue     = excluded.revenue,
           source_file = excluded.source_file,
           imported_at = now()`,
        [r.stat_date, r.offer_id, r.offer_name, r.conversions, r.revenue, basename(path)]
      )
    }
    await client.query('COMMIT')
    console.log(`Imported ${parsed.length} row(s).`)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e: unknown) => {
  console.error('FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
