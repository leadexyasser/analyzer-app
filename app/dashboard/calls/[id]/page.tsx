import { createServiceClient } from '@/lib/supabase/server'
import { getSignedUrl } from '@/lib/storage'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CallDetail } from '@/components/CallDetail'

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
        <span>/</span>
        <span>Call {call.ringba_call_id}</span>
      </div>
      <CallDetail call={call as any} audioUrl={audioUrl} />
    </div>
  )
}
