import { NextRequest, NextResponse } from 'next/server'
import { syncTikTokSpend } from '@/lib/tiktok-sync'

export const runtime = 'nodejs'
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
  return Number.isInteger(n) ? n : undefined
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const days = daysBack(request)
    const summary = days === undefined ? await syncTikTokSpend() : await syncTikTokSpend(days)
    return NextResponse.json({ ok: true, ...summary })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown sync error'
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
