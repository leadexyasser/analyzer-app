export const ET = 'America/New_York'

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
  // Probe noon UTC to determine the ET offset on that calendar day
  const probe = new Date(`${dateStr}T12:00:00Z`)
  const etNoonHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: '2-digit', hour12: false }).format(probe)
  )
  // EDT = UTC-4 → etNoonHour = 8  → offset = 4
  // EST = UTC-5 → etNoonHour = 7  → offset = 5
  const offsetHours = 12 - etNoonHour
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
