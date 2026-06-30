import { NextRequest, NextResponse } from 'next/server'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
// 90s: runWorker uses a 75s deadline internally, leaving 15s headroom for the response.
export const maxDuration = 90

function isAuthorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

// Vercel Cron triggers via GET. Internal triggers and manual pings use POST.
// Both share the same handler. No HTTP self-chaining — runWorker loops in-process.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runWorker())
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runWorker())
}
