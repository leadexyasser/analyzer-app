'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Result = {
  inserted: number
  skipped_duplicates: number
  total_rows_in_csv: number
  filename: string
}

export function UploadCsvButton() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<'idle' | 'uploading'>('idle')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = () => fileInput.current?.click()

  const handleFile = async (file: File) => {
    setState('uploading')
    setError(null)
    setResult(null)
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await fetch('/api/debt/upload', { method: 'POST', body })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? `Upload failed (${res.status})`)
      } else {
        const data = (await res.json()) as Result
        setResult(data)
        // Refresh the list without a full reload.
        router.refresh()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setState('idle')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          if (fileInput.current) fileInput.current.value = ''
        }}
      />
      <button
        type="button"
        onClick={pick}
        disabled={state === 'uploading'}
        className="px-3 py-1.5 rounded-md text-xs font-semibold transition-opacity disabled:opacity-60"
        style={{ background: 'var(--rb-accent)', color: '#0d1117' }}
      >
        {state === 'uploading' ? 'Uploading…' : 'Upload CSV'}
      </button>

      {result && (
        <p className="text-xs" style={{ color: 'var(--rb-text-2)' }}>
          <strong style={{ color: 'var(--rb-accent)' }}>{result.filename}</strong> · added{' '}
          <strong style={{ color: 'var(--rb-green)' }}>{result.inserted}</strong>
          {result.skipped_duplicates > 0 && (
            <>
              {' '}· skipped <strong style={{ color: 'var(--rb-text-3)' }}>{result.skipped_duplicates}</strong> duplicate{result.skipped_duplicates !== 1 ? 's' : ''}
            </>
          )}
        </p>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--rb-red)' }}>{error}</p>
      )}
    </div>
  )
}
