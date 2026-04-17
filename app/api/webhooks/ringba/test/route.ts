import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Dev-only test endpoint — simulates a Ringba webhook with a sample payload
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))

  // Forward to the real webhook handler
  const webhookUrl = new URL('/api/webhooks/ringba', request.url)
  const res = await fetch(webhookUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
