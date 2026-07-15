'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Sign-in failed (${res.status})`)
      } else {
        setSent(true)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--background)' }}
    >
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-black mx-auto"
            style={{ background: 'var(--rb-accent)', color: '#0d1117' }}
          >
            CA
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--rb-text)' }}>Call Analyzer</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--rb-text-2)' }}>Final Expense Intelligence</p>
          </div>
        </div>

        <div
          className="rounded-xl p-6 space-y-5"
          style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}
        >
          {sent ? (
            <div className="text-center space-y-2 py-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center mx-auto text-xl"
                style={{ background: 'var(--rb-accent)' + '22' }}
              >
                <span aria-hidden="true">✉️</span>
                <span className="sr-only">Email sent</span>
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--rb-text)' }}>Check your inbox</p>
              <p className="text-xs" style={{ color: 'var(--rb-text-2)' }}>
                We sent a magic link to <strong style={{ color: 'var(--rb-accent)' }}>{email}</strong>
              </p>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-semibold" style={{ color: 'var(--rb-text-2)' }}>
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--rb-surface-2)',
                    border: '1px solid var(--rb-border-2)',
                    color: 'var(--rb-text)',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--rb-accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--rb-border-2)')}
                />
              </div>
              {error && (
                <p className="text-xs" style={{ color: 'var(--rb-red)' }}>{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-60"
                style={{ background: 'var(--rb-accent)', color: '#0d1117' }}
              >
                {loading ? 'Sending…' : 'Send Magic Link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
