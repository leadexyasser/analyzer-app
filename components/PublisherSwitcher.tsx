'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

export function PublisherSwitcher() {
  const router   = useRouter()
  const pathname = usePathname()
  const sp       = useSearchParams()
  const current  = sp.get('publisher_scope') ?? ''

  const [publishers, setPublishers] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/publishers')
      .then(r => r.json())
      .then(d => setPublishers(d.publishers ?? []))
      .catch(() => {})
  }, [])

  function switchTo(pub: string) {
    const params = new URLSearchParams(sp.toString())
    if (pub) params.set('publisher_scope', pub)
    else params.delete('publisher_scope')
    router.push(`${pathname}?${params}`)
  }

  // Don't render anything until we know there are multiple publishers
  if (publishers.length < 2) return null

  const all = ['', ...publishers]

  return (
    <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--rb-border-2)' }}>
      {all.map((pub, i) => {
        const active = current === pub
        return (
          <button
            key={pub || '__all__'}
            onClick={() => switchTo(pub)}
            className="text-xs font-medium px-3 py-1.5 transition-colors whitespace-nowrap"
            style={{
              background: active ? 'var(--rb-accent)' : 'var(--rb-surface)',
              color:      active ? '#0d1117' : 'var(--rb-text-2)',
              borderRight: i < all.length - 1 ? '1px solid var(--rb-border-2)' : 'none',
            }}
          >
            {pub || 'All Sources'}
          </button>
        )
      })}
    </div>
  )
}
