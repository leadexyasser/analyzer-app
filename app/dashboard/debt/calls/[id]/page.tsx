import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { one } from '@/lib/db'
import { DebtCallDetail } from '@/components/debt/DebtCallDetail'
import { BackButton } from '@/components/BackButton'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const data = await one<{ caller_id: string | null; call_started_at: string | null }>(
    `SELECT caller_id, call_started_at FROM debt_calls WHERE id = $1`,
    [id]
  )
  return { title: data?.caller_id ?? 'Debt Call' }
}

export default async function DebtCallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const call = await one<Record<string, unknown>>(`SELECT * FROM debt_calls WHERE id = $1`, [id])
  if (!call) notFound()

  const storagePath = call.recording_storage_path as string | null
  const audioUrl = storagePath
    ? `/api/audio/${storagePath.split('/').map(encodeURIComponent).join('/')}`
    : null

  const startedAt = call.call_started_at as string | Date | null
  const dateLabel = startedAt
    ? new Date(startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="space-y-6">
      <BackButton />
      <nav className="flex items-center gap-2 text-xs" aria-label="Breadcrumb">
        <Link href="/dashboard/debt" className="transition-colors hover:text-[var(--rb-text)]" style={{ color: 'var(--rb-text-3)' }}>
          Debt Spanish
        </Link>
        <span style={{ color: 'var(--rb-text-3)' }}>/</span>
        <span style={{ color: 'var(--rb-text-2)' }}>
          {(call.caller_id as string | null) ?? 'Call'}
          {dateLabel && <span style={{ color: 'var(--rb-text-3)' }}> · {dateLabel}</span>}
        </span>
      </nav>

      <DebtCallDetail
        call={call as unknown as Parameters<typeof DebtCallDetail>[0]['call']}
        audioUrl={audioUrl}
      />
    </div>
  )
}
