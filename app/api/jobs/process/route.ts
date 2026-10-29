import { NextRequest, NextResponse } from 'next/server'
import { runWorker } from '@/lib/worker'

export const runtime = 'nodejs'
// 300s: runWorker uses a 270s deadline internally, leaving 30s headroom for the response.
// Bumped from 90s because runWorker's Promise.all doesn't check the deadline mid-batch, so
// a full 3-job analyze batch on long transcripts can overshoot 90s before the loop exits.
export const maxDuration = 300

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
