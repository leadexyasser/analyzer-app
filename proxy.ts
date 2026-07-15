import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

// Proxy runs on the Edge runtime, so we can't use `pg` or Node built-ins here.
// JWT verification only — the session cookie is self-contained.

const SESSION_COOKIE = 'session'

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return false
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) return false
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    })
    return typeof payload.sub === 'string'
  } catch {
    return false
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const authed = await isAuthenticated(request)

  if (pathname.startsWith('/dashboard') && !authed) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (pathname === '/login' && authed) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
}
