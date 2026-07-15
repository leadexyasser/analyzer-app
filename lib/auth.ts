import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextResponse, type NextResponse as NextResponseType } from 'next/server'
import { many, one, query } from '@/lib/db'

const SESSION_COOKIE = 'session'
const SESSION_TTL_DAYS = 7
const MAGIC_TTL_MINUTES = 10

type SessionPayload = { sub: string; email: string }

function getSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 32) {
    throw new Error('AUTH_SECRET must be set and at least 32 characters')
  }
  return new TextEncoder().encode(s)
}

function getAllowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS ?? ''
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export function isEmailAllowed(email: string): boolean {
  const allowed = getAllowedEmails()
  // If not configured, no one is allowed — fail closed.
  if (allowed.length === 0) return false
  return allowed.includes(email.trim().toLowerCase())
}

// ---------- Magic link tokens ----------

type MagicLinkRow = { token: string; email: string; expires_at: Date; used_at: Date | null }

export async function createMagicLink(email: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase()
  const expiresAt = new Date(Date.now() + MAGIC_TTL_MINUTES * 60_000)
  const row = await one<{ token: string }>(
    `INSERT INTO magic_links (email, expires_at) VALUES ($1, $2) RETURNING token`,
    [normalizedEmail, expiresAt]
  )
  if (!row) throw new Error('Failed to create magic link')
  return row.token
}

export async function consumeMagicLink(token: string): Promise<{ email: string } | null> {
  // Atomically mark used and return email — prevents replay.
  const row = await one<MagicLinkRow>(
    `UPDATE magic_links
     SET used_at = now()
     WHERE token = $1
       AND used_at IS NULL
       AND expires_at > now()
     RETURNING token, email, expires_at, used_at`,
    [token]
  )
  if (!row) return null
  return { email: row.email }
}

export async function cleanupExpiredMagicLinks(): Promise<number> {
  const r = await query(`DELETE FROM magic_links WHERE expires_at < now() - interval '1 day'`)
  return r.rowCount ?? 0
}

// ---------- Session JWT + cookie ----------

export async function signSession(payload: SessionPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(getSecret())
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
    return { sub: payload.sub, email: payload.email }
  } catch {
    return null
  }
}

export function setSessionCookie(res: NextResponseType, token: string): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

export function clearSessionCookie(res: NextResponseType): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE
}

/** Read + verify the session cookie in a Server Component / Route Handler. */
export async function getSessionFromRequest(): Promise<SessionPayload | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  return verifySession(token)
}
