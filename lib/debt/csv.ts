/**
 * Ringba CSV parser for the Debt Spanish app.
 * Ringba's export uses these 12 columns (in this order):
 *   Call Date · Recording · Campaign · Caller ID · Number · Number Pool ·
 *   Is Duplicate · Time To Call · Time To Connect · Connected Call Length ·
 *   Revenue · Duration
 */

export type DebtCsvRow = {
  recording_url_original: string
  call_started_at: Date | null
  campaign: string | null
  caller_id: string | null
  target_number: string | null
  number_pool: string | null
  is_duplicate: boolean | null
  time_to_call_seconds: number | null
  time_to_connect_seconds: number | null
  connected_length_seconds: number | null
  duration_seconds: number | null
  revenue: number | null
}

/** Parse a Ringba HH:MM:SS or MM:SS string into total seconds. */
function parseHms(s: string | undefined): number | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  const parts = trimmed.split(':').map(p => Number(p))
  if (parts.some(p => Number.isNaN(p))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}

/**
 * Parse Ringba's `MM/DD/YYYY hh:mm:ss AM/PM` date. Interpret as UTC —
 * Ringba exports in the account's timezone, but for our purposes an
 * ordered timestamp is enough; the dashboard renders in ET anyway.
 */
function parseRingbaDate(s: string | undefined): Date | null {
  if (!s) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i.exec(s.trim())
  if (!m) return null
  const [, mo, d, y, h, mi, se, ampm] = m
  let hour = Number(h)
  if (ampm) {
    const isPm = ampm.toUpperCase() === 'PM'
    if (isPm && hour < 12) hour += 12
    if (!isPm && hour === 12) hour = 0
  }
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${mi}:${se}Z`
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? null : t
}

function parseBool(s: string | undefined): boolean | null {
  if (!s) return null
  const t = s.trim().toLowerCase()
  if (t === 'true' || t === '1' || t === 'yes') return true
  if (t === 'false' || t === '0' || t === 'no') return false
  return null
}

function parseNumOrNull(s: string | undefined): number | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * RFC 4180-ish CSV line parser. Handles quoted fields with embedded
 * commas and doubled quotes. Ringba exports don't use embedded newlines
 * inside fields, so we split by \n at the top level.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') { inQuotes = false }
      else { cur += c }
    } else {
      if (c === ',') { out.push(cur); cur = '' }
      else if (c === '"') { inQuotes = true }
      else { cur += c }
    }
  }
  out.push(cur)
  return out
}

/** Normalize a column name: strip BOM, quotes, trim, lowercase. */
function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, '').replace(/^"|"$/g, '').trim().toLowerCase()
}

/**
 * Parse a full Ringba CSV export. Returns rows with the Recording column
 * populated — rows without a recording URL are silently dropped (they
 * can't be analyzed).
 */
export function parseRingbaCsv(csvText: string): DebtCsvRow[] {
  const lines = csvText.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0]).map(normalizeHeader)

  const idx = (name: string) => headers.indexOf(name)
  const cCallDate    = idx('call date')
  const cRecording   = idx('recording')
  const cCampaign    = idx('campaign')
  const cCallerId    = idx('caller id')
  const cNumber      = idx('number')
  const cNumberPool  = idx('number pool')
  const cIsDup       = idx('is duplicate')
  const cTimeToCall  = idx('time to call')
  const cTimeToConn  = idx('time to connect')
  const cConnLen     = idx('connected call length')
  const cRevenue     = idx('revenue')
  const cDuration    = idx('duration')

  if (cRecording === -1) {
    throw new Error('CSV is missing the required "Recording" column')
  }

  const rows: DebtCsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const url = cols[cRecording]?.trim()
    if (!url) continue

    rows.push({
      recording_url_original: url,
      call_started_at:     parseRingbaDate(cols[cCallDate]),
      campaign:            cols[cCampaign]?.trim() || null,
      caller_id:           cols[cCallerId]?.trim() || null,
      target_number:       cols[cNumber]?.trim() || null,
      number_pool:         cols[cNumberPool]?.trim() || null,
      is_duplicate:        parseBool(cols[cIsDup]),
      time_to_call_seconds:    parseHms(cols[cTimeToCall]),
      time_to_connect_seconds: parseHms(cols[cTimeToConn]),
      connected_length_seconds: parseHms(cols[cConnLen]),
      duration_seconds:    parseHms(cols[cDuration]),
      revenue:             parseNumOrNull(cols[cRevenue]),
    })
  }

  return rows
}
