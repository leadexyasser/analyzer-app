'use client'

import { useMemo } from 'react'

type Utterance = { channel: '1' | '2'; start: number; end: number; text: string; confidence?: number }
type Transcript = {
  utterances?: Utterance[]
  agent_channel?: '1' | '2'
  audio_duration?: number | null
}

type Message = { key: string; role: 'agent' | 'caller'; text: string; t: string }

function fmtSecFromMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/**
 * Parse the LLM's English `translated_transcript` string, which uses the
 * same "[time] AGENT: text" / "[time] CALLER: text" format as the source.
 * We accept either seconds ("12.3s") or MM:SS in the time bracket.
 */
function parseTranslatedTranscript(text: string): Message[] {
  const out: Message[] = []
  const lineRe = /^\s*\[([^\]]+)\]\s*(AGENT|CALLER)\s*:\s*(.*)$/i
  const lines = text.split(/\r?\n/)
  let i = 0
  for (const raw of lines) {
    if (!raw.trim()) continue
    const m = lineRe.exec(raw)
    if (!m) continue
    const [, tRaw, roleRaw, textRaw] = m
    out.push({
      key: `en-${i++}`,
      role: roleRaw.toLowerCase() as 'agent' | 'caller',
      text: textRaw.trim(),
      t: tRaw.trim().replace(/s$/i, ''),
    })
  }
  return out
}

export function DebtChatTranscript({
  transcript,
  transcriptText,
  translatedTranscript,
}: {
  transcript: Transcript | null
  transcriptText: string | null
  translatedTranscript: string | null
}) {
  const messages = useMemo<Message[] | null>(() => {
    // Prefer the LLM's English translation.
    if (translatedTranscript?.trim()) {
      const parsed = parseTranslatedTranscript(translatedTranscript)
      if (parsed.length > 0) return parsed
    }
    // Fallback: raw utterances (still in Spanish) — only if English translation missing.
    if (transcript?.utterances?.length) {
      const agentChannel = transcript.agent_channel
      return [...transcript.utterances]
        .sort((a, b) => a.start - b.start)
        .map((u, i) => ({
          key: `orig-${u.start}-${i}`,
          role: u.channel === agentChannel ? ('agent' as const) : ('caller' as const),
          text: u.text.trim(),
          t: fmtSecFromMs(u.start),
        }))
    }
    return null
  }, [transcript, translatedTranscript])

  if (!messages || messages.length === 0) {
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
