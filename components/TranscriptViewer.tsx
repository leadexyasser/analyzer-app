'use client'

import { useMemo } from 'react'

interface Segment { start: number; end: number; text: string }
interface LabeledSegment extends Segment { speaker: 'A' | 'B' }

interface Props {
  transcriptText: string
  segments: Segment[]
  agentSpeaker?: 'Speaker A' | 'Speaker B' | 'unclear'
  currentTime?: number
  onSeek?: (t: number) => void
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export function TranscriptViewer({ transcriptText, segments, agentSpeaker = 'unclear', currentTime = 0, onSeek }: Props) {
  const labeled = useMemo<LabeledSegment[]>(() => {
    if (!segments.length) return []
    let sp: 'A' | 'B' = 'A', lastEnd = segments[0].end
    return segments.map((seg, i) => {
      if (i > 0 && seg.start - lastEnd > 1.5) sp = sp === 'A' ? 'B' : 'A'
      lastEnd = seg.end
      return { ...seg, speaker: sp }
    })
  }, [segments])

  if (!labeled.length) {
    return (
      <pre
        className="text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-[520px] overflow-y-auto p-4 rounded-xl"
        style={{ background: 'var(--rb-sidebar)', color: 'var(--rb-text-2)', border: '1px solid var(--rb-border)' }}
      >
        {transcriptText || 'No transcript available.'}
      </pre>
    )
  }

  const agentIsA = agentSpeaker === 'Speaker A'
  const agentIsB = agentSpeaker === 'Speaker B'
  const isAgent = (sp: 'A' | 'B') => (agentIsA && sp === 'A') || (agentIsB && sp === 'B')
  const labelFor = (sp: 'A' | 'B') => {
    if (agentIsA) return sp === 'A' ? 'Agent' : 'Caller'
    if (agentIsB) return sp === 'B' ? 'Agent' : 'Caller'
    return `Speaker ${sp}`
  }
  const isActive = (seg: LabeledSegment) => currentTime >= seg.start && currentTime < seg.end

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 px-1">
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--rb-text-3)' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--rb-accent)' }} />
          Agent
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--rb-text-3)' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#374761' }} />
          Caller
        </span>
        {onSeek && (
          <span className="ml-auto text-xs" style={{ color: 'var(--rb-text-3)' }}>
            Tap timestamp to jump
          </span>
        )}
      </div>

      <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
        {labeled.map((seg, i) => {
          const agent = isAgent(seg.speaker)
          const active = isActive(seg)
          const label = labelFor(seg.speaker)
          const prevSame = i > 0 && labeled[i - 1].speaker === seg.speaker

          return (
            <div key={i} className={`flex gap-3 ${agent ? 'flex-row-reverse' : 'flex-row'} ${prevSame ? 'mt-0.5' : 'mt-4'}`}>
              {/* Avatar */}
              <div className="w-7 shrink-0 flex flex-col items-center">
                {!prevSame && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                    style={{
                      background: agent ? 'var(--rb-accent)' + '33' : '#1e2d40',
                      color: agent ? 'var(--rb-accent)' : '#7a8fa6',
                      border: `1px solid ${agent ? 'var(--rb-accent)' + '44' : '#283347'}`,
                    }}
                  >
                    {label.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Bubble */}
              <div className={`flex flex-col max-w-[72%] ${agent ? 'items-end' : 'items-start'}`}>
                {!prevSame && (
                  <span
                    className="text-[11px] font-semibold mb-1"
                    style={{ color: agent ? 'var(--rb-accent)' : 'var(--rb-text-3)' }}
                  >
                    {label}
                  </span>
                )}
                <div
                  className="px-4 py-2.5 rounded-2xl text-sm leading-relaxed transition-all"
                  style={{
                    background: agent ? '#00c9a722' : 'var(--rb-surface-2)',
                    border: `1px solid ${agent ? '#00c9a733' : 'var(--rb-border-2)'}`,
                    color: agent ? '#a7f3e8' : 'var(--rb-text-2)',
                    ...(active ? { outline: '2px solid #f79009', outlineOffset: '2px', transform: 'scale(1.01)' } : {}),
                  }}
                >
                  {seg.text.trim()}
                </div>
                {onSeek && (
                  <button
                    onClick={() => onSeek(seg.start)}
                    className="text-[10px] mt-1 tabular-nums transition-colors"
                    style={{ color: 'var(--rb-text-3)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--rb-accent)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--rb-text-3)')}
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
