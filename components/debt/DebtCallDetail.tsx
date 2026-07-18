'use client'

import { useState } from 'react'
import type { DebtAnalysis } from '@/types/debt'
import { DebtChatTranscript } from './DebtChatTranscript'

type Call = {
  id: string
  recording_url_original: string | null
  call_started_at: string | null
  campaign: string | null
  caller_id: string | null
  target_number: string | null
  number_pool: string | null
  is_duplicate: boolean | null
  time_to_call_seconds: number | null
  time_to_connect_seconds: number | null
  connected_length_seconds: number | null
  duration_seconds: number | null
  revenue: number | string | null
  quality_score: number | null
  compliance_score: number | null
  flags: string[] | null
  status: string
  error_message: string | null
  source_filename: string | null
  transcript: Record<string, unknown> | null
  transcript_text: string | null
  analysis: DebtAnalysis | null
}

function fmtSecs(s: number | null): string {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}m ${String(r).padStart(2, '0')}s`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short',
  })
}

function ScorePill({ label, score, threshold = 70 }: { label: string; score: number | null; threshold?: number }) {
  const color =
    score == null ? 'var(--rb-text-3)' :
    score >= threshold ? 'var(--rb-green)' :
    score >= threshold - 20 ? 'var(--rb-amber)' :
    'var(--rb-red)'
  return (
    <div className="rounded-xl px-5 py-4 space-y-1" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>{label}</p>
      <p className="text-3xl font-bold tabular-nums" style={{ color }}>
        {score == null ? '—' : score}
        {score != null && <span className="text-sm ml-1" style={{ color: 'var(--rb-text-3)' }}>/100</span>}
      </p>
    </div>
  )
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs py-1.5" style={{ borderBottom: '1px solid var(--rb-border)' }}>
      <span style={{ color: 'var(--rb-text-3)' }}>{k}</span>
      <span className="text-right tabular-nums" style={{ color: 'var(--rb-text-2)' }}>{v ?? '—'}</span>
    </div>
  )
}

export function DebtCallDetail({ call, audioUrl }: { call: Call; audioUrl: string | null }) {
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null)

  const analysis = call.analysis
  const compliance = analysis?.compliance_breakdown
  const complianceFlag =
    (compliance?.government_program_mentioned ? 'government_program' : null) ??
    (compliance?.free_money_mentioned ? 'free_money' : null) ??
    (compliance?.loan_mentioned ? 'loan' : null)

  const handleReanalyze = async () => {
    setReanalyzing(true)
    setReanalyzeError(null)
    try {
      const res = await fetch(`/api/debt/calls/${call.id}/reanalyze`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setReanalyzeError(body.error ?? `Reanalyze failed (${res.status})`)
      } else {
        // Nudge the browser to refetch this page's server-rendered content.
        window.location.reload()
      }
    } catch (err: unknown) {
      setReanalyzeError(err instanceof Error ? err.message : 'Reanalyze failed')
    } finally {
      setReanalyzing(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header row: audio + scores */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ScorePill label="Quality Score" score={call.quality_score} threshold={60} />
        <ScorePill label="Compliance Score" score={call.compliance_score} threshold={90} />
        <div className="rounded-xl px-5 py-4 space-y-2" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>Audio</p>
          {audioUrl ? (
            <audio controls preload="metadata" className="w-full" style={{ height: 34 }}>
              <source src={audioUrl} type="audio/mpeg" />
              Your browser doesn't support audio playback.
            </audio>
          ) : (
            <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>Recording not yet downloaded.</p>
          )}
          <p className="text-[10px]" style={{ color: 'var(--rb-text-3)' }}>Status: <span style={{ color: 'var(--rb-text-2)' }}>{call.status}</span></p>
        </div>
      </div>

      {/* Summary + Hangup */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl px-5 py-4 space-y-2" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>Summary</p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--rb-text)' }}>
            {analysis?.summary ?? <span style={{ color: 'var(--rb-text-3)' }}>Not analyzed yet.</span>}
          </p>
        </div>
        <div className="rounded-xl px-5 py-4 space-y-2" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>Hangup Reason</p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--rb-text)' }}>
            {analysis?.hangup_reason ?? <span style={{ color: 'var(--rb-text-3)' }}>—</span>}
          </p>
          {analysis?.hangup_party && (
            <p className="text-xs" style={{ color: 'var(--rb-text-3)' }}>
              Ended by: <span className="capitalize" style={{ color: 'var(--rb-text-2)' }}>{analysis.hangup_party}</span>
            </p>
          )}
        </div>
      </div>

      {/* Compliance detail */}
      {compliance && complianceFlag && (
        <div className="rounded-xl px-5 py-4 space-y-2" style={{ background: 'var(--rb-red)' + '11', border: '1px solid var(--rb-red)' + '44' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-red)' }}>Compliance Concern</p>
          <ul className="space-y-1 text-xs">
            {compliance.government_program_mentioned && (
              <li>
                <strong style={{ color: 'var(--rb-red)' }}>Government program mentioned</strong>
                {compliance.government_program_quote && (
                  <span style={{ color: 'var(--rb-text-2)' }}> — “{compliance.government_program_quote}”</span>
                )}
              </li>
            )}
            {compliance.free_money_mentioned && (
              <li>
                <strong style={{ color: 'var(--rb-red)' }}>Free money mentioned</strong>
                {compliance.free_money_quote && (
                  <span style={{ color: 'var(--rb-text-2)' }}> — “{compliance.free_money_quote}”</span>
                )}
              </li>
            )}
            {compliance.loan_mentioned && (
              <li>
                <strong style={{ color: 'var(--rb-red)' }}>Loan mentioned</strong>
                {compliance.loan_quote && (
                  <span style={{ color: 'var(--rb-text-2)' }}> — “{compliance.loan_quote}”</span>
                )}
              </li>
            )}
            <li style={{ color: 'var(--rb-text-3)' }}>
              Mentioned by: <span className="capitalize" style={{ color: 'var(--rb-text-2)' }}>{compliance.mentioned_by}</span>
            </li>
          </ul>
        </div>
      )}

      {/* Transcript + right-column detail card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--rb-text)' }}>Transcript</h2>
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={reanalyzing || !call.recording_url_original}
              className="text-xs px-2.5 py-1 rounded-md transition-opacity disabled:opacity-50"
              style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)', border: '1px solid var(--rb-border-2)' }}
            >
              {reanalyzing ? 'Requeuing…' : 'Re-analyze'}
            </button>
          </div>
          {reanalyzeError && <p className="text-xs" style={{ color: 'var(--rb-red)' }}>{reanalyzeError}</p>}
          {call.error_message && (
            <p className="text-xs px-3 py-2 rounded-md" style={{ background: 'var(--rb-red)' + '11', color: 'var(--rb-red)' }}>
              Pipeline error: {call.error_message}
            </p>
          )}
          <DebtChatTranscript
            transcript={call.transcript as Parameters<typeof DebtChatTranscript>[0]['transcript']}
            transcriptText={call.transcript_text}
          />
        </div>

        <aside className="space-y-3">
          {/* Call metadata (mirrors the Ringba CSV columns) */}
          <div className="rounded-xl px-5 py-4" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Call Details</p>
            <KV k="Call date" v={fmtDate(call.call_started_at)} />
            <KV k="Campaign" v={call.campaign} />
            <KV k="Caller ID" v={call.caller_id} />
            <KV k="Number" v={call.target_number} />
            <KV k="Number pool" v={call.number_pool} />
            <KV k="Duplicate?" v={call.is_duplicate == null ? '—' : call.is_duplicate ? 'Yes' : 'No'} />
            <KV k="Time to call" v={fmtSecs(call.time_to_call_seconds)} />
            <KV k="Time to connect" v={fmtSecs(call.time_to_connect_seconds)} />
            <KV k="Connected length" v={fmtSecs(call.connected_length_seconds)} />
            <KV k="Duration" v={fmtSecs(call.duration_seconds)} />
            <KV k="Revenue" v={call.revenue != null ? `$${Number(call.revenue).toFixed(2)}` : '—'} />
            <KV k="Source file" v={<span className="text-[10px]">{call.source_filename ?? '—'}</span>} />
          </div>

          {/* Debt info from analysis */}
          {analysis?.debt_info && (
            <div className="rounded-xl px-5 py-4" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Debt Info</p>
              <KV k="Stated amount"
                  v={analysis.debt_info.stated_debt_amount_usd != null
                     ? `$${analysis.debt_info.stated_debt_amount_usd.toLocaleString()}`
                     : '—'} />
              <KV k="Meets threshold" v={<span className="capitalize">{analysis.debt_info.debt_meets_threshold}</span>} />
              <KV k="Debt types"
                  v={analysis.debt_info.debt_types.length ? analysis.debt_info.debt_types.join(', ') : '—'} />
              <KV k="Interest verdict" v={<span className="capitalize">{analysis.debt_info.interest_verdict.replace(/_/g, ' ')}</span>} />
              {analysis.debt_info.debt_amount_verbatim && (
                <p className="text-xs mt-2 italic" style={{ color: 'var(--rb-text-3)' }}>
                  &ldquo;{analysis.debt_info.debt_amount_verbatim}&rdquo;
                </p>
              )}
            </div>
          )}

          {/* Caller info */}
          {analysis?.caller_info && (
            <div className="rounded-xl px-5 py-4" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Caller Info</p>
              <KV k="Name" v={analysis.caller_info.stated_name} />
              <KV k="State" v={analysis.caller_info.location_state} />
              <KV k="Speaks English" v={<span className="capitalize">{analysis.caller_info.speaks_english}</span>} />
              <KV k="Can afford" v={<span className="capitalize">{analysis.caller_info.can_afford_payments}</span>} />
            </div>
          )}

          {/* Flags */}
          {(call.flags?.length ?? 0) > 0 && (
            <div className="rounded-xl px-5 py-4" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Flags</p>
              <div className="flex flex-wrap gap-1.5">
                {call.flags?.map(f => (
                  <span key={f} className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)', border: '1px solid var(--rb-border-2)' }}>
                    {f}
                  </span>
                ))}
              </div>
              {analysis?.flag_details && Object.keys(analysis.flag_details).length > 0 && (
                <ul className="mt-3 space-y-1.5 text-[11px]">
                  {Object.entries(analysis.flag_details).map(([k, v]) => (
                    <li key={k} style={{ color: 'var(--rb-text-2)' }}>
                      <strong style={{ color: 'var(--rb-accent)' }}>{k}:</strong> {v}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Coaching */}
          {analysis?.coaching_notes && (
            <div className="rounded-xl px-5 py-4" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Coaching</p>
              <p className="text-xs" style={{ color: 'var(--rb-text-2)' }}>{analysis.coaching_notes}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
