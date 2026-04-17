import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { getSignedUrl } from '@/lib/storage'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CallDetail } from '@/components/CallDetail'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = createServiceClient()
  const { data } = await supabase.from('calls').select('caller_id, received_at').eq('id', id).single()
  const label = data?.caller_id ?? 'Call Detail'
  return { title: label }
}

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: call, error } = await supabase
    .from('calls')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !call) notFound()

  let audioUrl: string | null = null
  if (call.recording_storage_path) {
    try {
      audioUrl = await getSignedUrl(call.recording_storage_path)
    } catch {
      // Audio may be deleted per retention policy
    }
  }

  const dateLabel = call.received_at
    ? new Date(call.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-xs" aria-label="Breadcrumb">
        <Link
          href="/dashboard"
          className="transition-colors"
          style={{ color: 'var(--rb-text-3)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--rb-text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--rb-text-3)')}
        >
          Dashboard
        </Link>
        <span style={{ color: 'var(--rb-text-3)' }}>/</span>
        <span style={{ color: 'var(--rb-text-2)' }}>
          {call.caller_id ?? call.ringba_call_id}
          {dateLabel && <span style={{ color: 'var(--rb-text-3)' }}> · {dateLabel}</span>}
        </span>
      </nav>
      <CallDetail call={call as any} audioUrl={audioUrl} />
    </div>
  )
}
