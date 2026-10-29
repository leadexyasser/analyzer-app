import { NextRequest, NextResponse } from 'next/server'
import { syncMetaSpend } from '@/lib/meta-sync'

export const runtime = 'nodejs'
// One account over a trailing week is two Graph calls; 60s is ample. Raise this only if
// META_AD_ACCOUNT_IDS grows, since accounts are fetched sequentially per account.
export const maxDuration = 60

function isAuthorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

/** Optional ?days=N to widen the trailing window for a one-off backfill. */
function daysBack(request: NextRequest): number | undefined {
  const raw = request.nextUrl.searchParams.get('days')
  if (raw === null) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n)) return undefined
  return n
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const days = daysBack(request)
    const summary = days === undefined ? await syncMetaSpend() : await syncMetaSpend(days)
    return NextResponse.json({ ok: true, ...summary })
  } catch (error: unknown) {
    // Surface the reason: a silent failure here leaves the dashboard showing stale
    // spend that still looks plausible, which is worse than an obvious error.
    const message = error instanceof Error ? error.message : 'Unknown sync error'
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}

// Cron schedulers trigger via GET; manual pings use POST. Same handler for both.
export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
