'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

export function BackButton() {
  const router = useRouter()

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <button
      onClick={handleBack}
      className="inline-flex items-center gap-0.5 text-xs transition-colors hover:text-[var(--rb-text)] focus-visible:text-[var(--rb-text)]"
      style={{ color: 'var(--rb-text-3)' }}
    >
      <ChevronLeft size={14} />
      Back
    </button>
  )
}
