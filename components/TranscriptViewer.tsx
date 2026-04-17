'use client'

import { useMemo } from 'react'

interface Segment {
  start: number
  end: number
  text: string
}

interface LabeledSegment extends Segment {
  speaker: 'A' | 'B'
}

interface Props {
  transcriptText: string
  segments: Segment[]
  agentSpeaker?: 'Speaker A' | 'Speaker B' | 'unclear'
  currentTime?: number
  onSeek?: (t: number) => void
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

export function TranscriptViewer({ transcriptText, segments, agentSpeaker = 'unclear', currentTime = 0, onSeek }: Props) {
  const labeled = useMemo<LabeledSegment[]>(() => {
    if (!segments.length) return []
    const PAUSE_THRESHOLD = 1.5
    let currentSpeaker: 'A' | 'B' = 'A'
    let lastEnd = segments[0].end
    return segments.map((seg, i) => {
      if (i > 0 && seg.start - lastEnd > PAUSE_THRESHOLD) {
        currentSpeaker = currentSpeaker === 'A' ? 'B' : 'A'
      }
      lastEnd = seg.end
      return { ...seg, speaker: currentSpeaker }
    })
  }, [segments])

  if (!labeled.length) {
    return (
      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6">
        <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-slate-700">
          {transcriptText || 'No transcript available.'}
        </pre>
      </div>
    )
  }

  const agentIsA = agentSpeaker === 'Speaker A'
  const agentIsB = agentSpeaker === 'Speaker B'

  const labelFor = (speaker: 'A' | 'B') => {
    if (agentIsA && speaker === 'A') return 'Agent'
    if (agentIsA && speaker === 'B') return 'Caller'
    if (agentIsB && speaker === 'B') return 'Agent'
    if (agentIsB && speaker === 'A') return 'Caller'
    return `Speaker ${speaker}`
  }

  const isAgent = (speaker: 'A' | 'B') => {
    return (agentIsA && speaker === 'A') || (agentIsB && speaker === 'B')
  }

  const isActive = (seg: LabeledSegment) =>
    currentTime >= seg.start && currentTime < seg.end

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-slate-500 px-1">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" />
          Agent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-slate-400 inline-block" />
          Caller
        </span>
        {onSeek && <span className="ml-auto text-slate-400">Click timestamp to jump</span>}
      </div>

      <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
        {labeled.map((seg, i) => {
          const agent = isAgent(seg.speaker)
          const active = isActive(seg)
          const label = labelFor(seg.speaker)

          // Group consecutive same-speaker segments into visual bubbles
          const prevSame = i > 0 && labeled[i - 1].speaker === seg.speaker
          const nextSame = i < labeled.length - 1 && labeled[i + 1].speaker === seg.speaker

          return (
            <div
              key={i}
              className={`flex gap-3 ${agent ? 'flex-row-reverse' : 'flex-row'} ${prevSame ? 'mt-0.5' : 'mt-3'}`}
            >
              {/* Avatar — only show on first segment of a run */}
              <div className="w-7 shrink-0 flex flex-col items-center">
                {!prevSame && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${agent ? 'bg-indigo-500' : 'bg-slate-400'}`}>
                    {label.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Bubble */}
              <div className={`flex flex-col max-w-[72%] ${agent ? 'items-end' : 'items-start'}`}>
                {!prevSame && (
                  <span className={`text-[11px] font-semibold mb-0.5 ${agent ? 'text-indigo-600 text-right' : 'text-slate-500'}`}>
                    {label}
                  </span>
                )}
                <div
                  className={`relative px-4 py-2.5 rounded-2xl text-sm leading-relaxed transition-all ${
                    agent
                      ? `bg-indigo-600 text-white ${!prevSame ? 'rounded-tr-sm' : ''} ${!nextSame ? '' : ''}`
                      : `bg-white border border-slate-200 text-slate-800 ${!prevSame ? 'rounded-tl-sm' : ''}`
                  } ${active ? 'ring-2 ring-amber-400 ring-offset-1 scale-[1.01]' : ''}`}
                >
                  {seg.text.trim()}
                </div>
                {onSeek && (
                  <button
                    onClick={() => onSeek(seg.start)}
                    className={`text-[10px] mt-0.5 tabular-nums transition-colors ${agent ? 'text-indigo-300 hover:text-white' : 'text-slate-400 hover:text-indigo-500'}`}
                  >
                    {fmt(seg.start)}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
