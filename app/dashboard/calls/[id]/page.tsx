import type { Metadata } from 'next'
import { one } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CallDetail } from '@/components/CallDetail'
import { BackButton } from '@/components/BackButton'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const data = await one<{ caller_id: string | null; received_at: Date | null }>(
    `SELECT caller_id, received_at FROM calls WHERE id = $1`,
    [id]
  )
  const label = data?.caller_id ?? 'Call Detail'
  return { title: label }
}

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const call = await one<Record<string, unknown>>(`SELECT * FROM calls WHERE id = $1`, [id])
  if (!call) notFound()

  const storagePath = call.recording_storage_path as string | null
  const audioUrl = storagePath
    ? `/api/audio/${storagePath.split('/').map(encodeURIComponent).join('/')}`
    : null

  const receivedAt = call.received_at as Date | string | null
  const dateLabel = receivedAt
    ? new Date(receivedAt as string | Date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="space-y-6">
      <BackButton />
      <nav className="flex items-center gap-2 text-xs" aria-label="Breadcrumb">
        <Link
          href="/dashboard"
          className="transition-colors hover:text-[var(--rb-text)]"
          style={{ color: 'var(--rb-text-3)' }}
        >
          Dashboard
        </Link>
        <span style={{ color: 'var(--rb-text-3)' }}>/</span>
        <span style={{ color: 'var(--rb-text-2)' }}>
          {(call.caller_id as string | null) ?? (call.ringba_call_id as string)}
          {dateLabel && <span style={{ color: 'var(--rb-text-3)' }}> · {dateLabel}</span>}
        </span>
      </nav>
      <CallDetail call={call as any} audioUrl={audioUrl} />
    </div>
  )
}
