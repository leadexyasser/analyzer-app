import { NextRequest, NextResponse } from 'next/server'
import { consumeMagicLink, setSessionCookie, signSession, isEmailAllowed } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token = searchParams.get('token')
  const nextParam = searchParams.get('next') ?? '/dashboard'
  // Guard against open-redirect: only accept same-origin paths.
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'

  if (!token) return NextResponse.redirect(`${origin}/login?error=missing_token`)

  const result = await consumeMagicLink(token)
  if (!result) return NextResponse.redirect(`${origin}/login?error=invalid_or_expired`)
  if (!isEmailAllowed(result.email)) return NextResponse.redirect(`${origin}/login?error=not_allowed`)

  const jwt = await signSession({ sub: result.email, email: result.email })
  const res = NextResponse.redirect(`${origin}${next}`)
  setSessionCookie(res, jwt)
  return res
}
