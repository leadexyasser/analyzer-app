'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Call } from '@/types/database'
import { Analysis } from '@/types/analysis'
import { TranscriptViewer } from '@/components/TranscriptViewer'
import { AudioPlayer } from '@/components/AudioPlayer'
import { AnalysisCard } from '@/components/AnalysisCard'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface Props {
  call: Call
  audioUrl: string | null
}

export function CallDetail({ call, audioUrl }: Props) {
  const [retrying, setRetrying] = useState(false)
  const router = useRouter()

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const res = await fetch(`/api/calls/${call.id}`, { method: 'POST' })
      if (res.ok) {
        toast.success('Call queued for reprocessing')
        router.refresh()
      } else {
        const data = await res.json()
        toast.error(data.error ?? 'Retry failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setRetrying(false)
    }
  }

  const analysis = call.analysis as Analysis | null

  const metaItems = [
    { label: 'Call ID', value: call.ringba_call_id },
    { label: 'Received', value: call.received_at ? new Date(call.received_at).toLocaleString() : '—' },
    { label: 'Started', value: call.call_started_at ? new Date(call.call_started_at).toLocaleString() : '—' },
    { label: 'Duration', value: call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}:${String(call.duration_seconds % 60).padStart(2, '0')}` : '—' },
    { label: 'Caller', value: call.caller_id ?? '—' },
    { label: 'Target', value: call.target_number ?? '—' },
    { label: 'Campaign', value: call.campaign_name ?? '—' },
    { label: 'Buyer', value: call.buyer_name ?? '—' },
    { label: 'Publisher', value: call.publisher_name ?? '—' },
    { label: 'Revenue', value: call.revenue != null ? `$${Number(call.revenue).toFixed(2)}` : '—' },
    { label: 'Payout', value: call.payout != null ? `$${Number(call.payout).toFixed(2)}` : '—' },
    { label: 'Status', value: call.status },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Call {call.ringba_call_id}</h1>
          <p className="text-sm text-muted-foreground mt-1">{call.campaign_name ?? 'Unknown campaign'}</p>
        </div>
        {call.status === 'failed' && (
          <Button onClick={handleRetry} disabled={retrying} variant="outline" size="sm">
            {retrying ? 'Retrying...' : 'Retry'}
          </Button>
        )}
      </div>

      {call.error_message && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          <strong>Error:</strong> {call.error_message}
        </div>
      )}

      {/* Metadata */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Call Metadata</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
            {metaItems.map(({ label, value }) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm font-medium mt-0.5 truncate">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* Audio */}
      {audioUrl && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Recording</CardTitle></CardHeader>
          <CardContent>
            <AudioPlayer src={audioUrl} />
          </CardContent>
        </Card>
      )}

      {/* Analysis + Transcript */}
      <Tabs defaultValue={analysis ? 'analysis' : 'transcript'}>
        <TabsList>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="raw">Raw JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="analysis">
          {call.status === 'complete' && analysis ? (
            <AnalysisCard analysis={analysis} />
          ) : call.status === 'analyzing' ? (
            <Card><CardContent className="pt-6"><Skeleton className="h-40 w-full" /></CardContent></Card>
          ) : (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">
              {call.status === 'failed' ? 'Analysis failed. Retry the call to reprocess.' : 'Analysis not yet available.'}
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="transcript">
          {call.transcript_text ? (
            <TranscriptViewer
              transcriptText={call.transcript_text}
              segments={(call.transcript as any)?.segments ?? []}
            />
          ) : (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">
              No transcript available yet.
            </CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="raw">
          <Card>
            <CardContent className="pt-6">
              <pre className="text-xs overflow-auto max-h-96 bg-muted p-4 rounded">
                {JSON.stringify({ call, analysis }, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
