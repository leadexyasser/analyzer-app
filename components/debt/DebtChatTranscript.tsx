'use client'

import { useMemo } from 'react'

type Utterance = { channel: '1' | '2'; start: number; end: number; text: string; confidence?: number }
type Transcript = {
  utterances?: Utterance[]
  agent_channel?: '1' | '2'
  audio_duration?: number | null
}

function fmtSec(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function DebtChatTranscript({ transcript, transcriptText }: { transcript: Transcript | null; transcriptText: string | null }) {
  const messages = useMemo(() => {
    if (!transcript?.utterances?.length) return null
    const agentChannel = transcript.agent_channel
    return [...transcript.utterances]
      .sort((a, b) => a.start - b.start)
      .map((u, i) => ({
        key: `${u.start}-${i}`,
        role: u.channel === agentChannel ? ('agent' as const) : ('caller' as const),
        text: u.text.trim(),
        t: fmtSec(u.start),
      }))
  }, [transcript])

  if (!messages || messages.length === 0) {
    // Fallback: show the labeled plaintext if we have it, or nothing yet.
    if (transcriptText) {
      return (
        <pre className="text-xs whitespace-pre-wrap font-mono px-4 py-3 rounded-md" style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}>
          {transcriptText}
        </pre>
      )
    }
    return (
      <p className="text-xs px-4 py-3 rounded-md" style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-3)' }}>
        Transcript not available yet. It will appear here after the analysis pipeline completes.
      </p>
    )
  }

  return (
    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
      {messages.map(m => {
        const isAgent = m.role === 'agent'
        return (
          <div key={m.key} className={`flex ${isAgent ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2`}
                 style={{
                   background: isAgent ? 'var(--rb-surface-2)' : 'var(--rb-accent)' + '22',
                   border: `1px solid ${isAgent ? 'var(--rb-border-2)' : 'var(--rb-accent)44'}`,
                 }}>
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wide"
                      style={{ color: isAgent ? 'var(--rb-text-3)' : 'var(--rb-accent)' }}>
                  {isAgent ? 'Agent' : 'Caller'}
                </span>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--rb-text-3)' }}>{m.t}</span>
              </div>
              <p className="text-sm leading-snug" style={{ color: 'var(--rb-text)' }}>{m.text}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
