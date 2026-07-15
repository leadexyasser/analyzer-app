import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createMagicLink, isEmailAllowed } from '@/lib/auth'
import { sendMagicLinkEmail } from '@/lib/email'

export const runtime = 'nodejs'

const BodySchema = z.object({ email: z.string().email() })

function baseUrl(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL
  if (envUrl) return envUrl.replace(/\/+$/, '')
  const { origin } = new URL(request.url)
  return origin
}

export async function POST(request: NextRequest) {
  let parsed: { email: string }
  try {
    parsed = BodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const email = parsed.email.trim().toLowerCase()

  // Don't leak whether the email is allowed — always return 200 so an attacker
  // can't enumerate allowed accounts. Silently drop if not allowed.
  if (!isEmailAllowed(email)) {
    return NextResponse.json({ ok: true })
  }

  const token = await createMagicLink(email)
  const link = `${baseUrl(request)}/auth/callback?token=${encodeURIComponent(token)}`

  try {
    await sendMagicLinkEmail(email, link)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
