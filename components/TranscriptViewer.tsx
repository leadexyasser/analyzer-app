'use client'

import { useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'

interface Segment {
  start: number
  end: number
  text: string
}

interface Props {
  transcriptText: string
  segments: Segment[]
}

export function TranscriptViewer({ transcriptText, segments }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // If we have segments, render them with speaker labels and click-to-seek
  if (segments.length > 0) {
    const PAUSE_THRESHOLD = 1.5
    let currentSpeaker = 'A'
    let lastEnd = segments[0]?.end ?? 0

    const labeledSegments = segments.map((seg, i) => {
      if (i > 0) {
        const gap = seg.start - lastEnd
        if (gap > PAUSE_THRESHOLD) currentSpeaker = currentSpeaker === 'A' ? 'B' : 'A'
      }
      lastEnd = seg.end
      return { ...seg, speaker: currentSpeaker }
    })

    return (
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground mb-3">
            Speaker labels are estimated from pause detection — not true diarization.
          </p>
          <div className="space-y-2 max-h-96 overflow-y-auto font-mono text-sm">
            {labeledSegments.map((seg, i) => (
              <div key={i} className="flex gap-3 group">
                <span className="text-xs text-muted-foreground w-12 shrink-0 pt-0.5">
                  {formatTime(seg.start)}
                </span>
                <span className={`font-semibold w-20 shrink-0 text-xs pt-0.5 ${seg.speaker === 'A' ? 'text-blue-600' : 'text-green-600'}`}>
                  Speaker {seg.speaker}
                </span>
                <span className="text-foreground leading-relaxed">{seg.text}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Fallback: plain text
  return (
    <Card>
      <CardContent className="pt-4">
        <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
          {transcriptText}
        </pre>
      </CardContent>
    </Card>
  )
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
