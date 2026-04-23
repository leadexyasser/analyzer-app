// Fixed UTC-5 (EST) — no daylight saving flip
export const ET = 'Etc/GMT+5'

/** Today's date in ET as "YYYY-MM-DD" */
export function etTodayStr(base = new Date()): string {
  return base.toLocaleDateString('en-CA', { timeZone: ET })
}

/** Current hour (0-23) in ET */
export function etHourNow(): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: '2-digit', hour12: false }).format(new Date())
  )
}

/**
 * Returns the UTC Date that equals midnight (00:00:00.000) Eastern Time
 * on the given "YYYY-MM-DD" date string.
 */
export function etMidnight(dateStr: string): Date {
  // Probe noon UTC on that date, read back the ET hour via formatToParts
  // (more reliable than parsing a formatted string)
  const probe = new Date(`${dateStr}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(probe)
  const etHour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '8')
  // EDT (UTC-4): noon UTC = 8 AM ET  → offset = 4
  // EST (UTC-5): noon UTC = 7 AM ET  → offset = 5
  const offsetHours = 12 - etHour
  return new Date(`${dateStr}T${String(offsetHours).padStart(2, '0')}:00:00.000Z`)
}

/** Returns the UTC Date that equals 23:59:59.999 Eastern Time on the given date string */
export function etEndOfDay(dateStr: string): Date {
  return new Date(etMidnight(dateStr).getTime() + 24 * 60 * 60 * 1000 - 1)
}

/** Adds `days` to a "YYYY-MM-DD" string and returns the new string */
export function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Format a UTC ISO string for display in Eastern Time */
export function fmtET(isoStr: string | null): string {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleString('en-US', {
    timeZone: ET,
    month: 'short', day: 'numeric', year: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

/** Get the ET hour (0-23) from a UTC ISO string */
export function etHourOf(isoStr: string): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: '2-digit', hour12: false }).format(new Date(isoStr))
  )
}
