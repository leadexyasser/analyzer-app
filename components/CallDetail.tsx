'use client'

import { useState, useCallback } from 'react'
import { Call } from '@/types/database'
import { Analysis } from '@/types/analysis'
import { AudioPlayer } from '@/components/AudioPlayer'
import { TranscriptViewer } from '@/components/TranscriptViewer'
import { FinalExpenseCard } from '@/components/FinalExpenseCard'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { ReanalyzeButton } from '@/components/ReanalyzeButton'

interface Props { call: Call; audioUrl: string | null }

function dur(s: number | null) {
  if (!s) return '—'
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function money(v: number | null) {
  return v == null ? '—' : `$${Number(v).toFixed(2)}`
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

// ── atoms ─────────────────────────────────────────────────────────────────────

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
      {title && (
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--rb-border)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>{title}</p>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

function MetaItem({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>{label}</p>
      <p className="text-sm font-medium mt-0.5 truncate" style={{ color: accent ? 'var(--rb-accent)' : 'var(--rb-text)' }}>{value}</p>
    </div>
  )
}

function Ring({ score }: { score: number }) {
  const size = 72, r = (size - 10) / 2
  const circ = 2 * Math.PI * r, fill = (score / 100) * circ
  const color = score >= 70 ? '#12b76a' : score >= 40 ? '#f79009' : '#f04438'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e2d40" strokeWidth="8" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2+5} textAnchor="middle" fontSize="15" fontWeight="700" fill={color}>{score}</text>
    </svg>
  )
}

const OUTCOME_COLORS: Record<string, [string, string]> = {
  transferred:          ['var(--rb-qualified-bg)', '#12b76a'],
  qualified_no_transfer:['var(--rb-qualified-bg)', '#4ade80'],
  not_qualified:        ['var(--rb-disqualified-bg)', '#f04438'],
  hung_up_early:        ['var(--rb-borderline-bg)', '#f79009'],
  voicemail:            ['#141e2d', '#7a8fa6'],
  wrong_number:         ['#141e2d', '#7a8fa6'],
  callback_scheduled:   ['#0d142e', '#818cf8'],
  sale_closed:          ['var(--rb-qualified-bg)', '#12b76a'],
  unclear:              ['#141e2d', '#4d6078'],
}

const FLAG_COLORS: Record<string, [string, string]> = {
  agent_unprofessional:  ['var(--rb-disqualified-bg)', '#f04438'],
  compliance_concern:    ['var(--rb-compliance-bg)', '#f04438'],
  caller_hostile:        ['var(--rb-borderline-bg)', '#f79009'],
  premature_hangup:      ['var(--rb-borderline-bg)', '#f79009'],
  agent_script_deviation:['var(--rb-borderline-bg)', '#fbbf24'],
  dead_air_excessive:    ['var(--rb-borderline-bg)', '#fbbf24'],
  caller_confused:       ['var(--rb-borderline-bg)', '#fbbf24'],
  audio_quality_poor:    ['#141e2d', '#7a8fa6'],
  insufficient_audio:    ['#141e2d', '#7a8fa6'],
  language_mismatch:     ['#0d142e', '#818cf8'],
  duplicate_caller_suspected: ['#1a0d2e', '#c084fc'],
}

export function CallDetail({ call, audioUrl }: Props) {
  const [retrying, setRetrying] = useState(false)
  const [tab, setTab] = useState<'transcript' | 'raw'>('transcript')
  const [seekTo, setSeekTo] = useState<number | undefined>()
  const [currentTime, setCurrentTime] = useState(0)
  const router = useRouter()
  const analysis = call.analysis as Analysis | null

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const res = await fetch(`/api/calls/${call.id}`, { method: 'POST' })
      if (res.ok) { toast.success('Call queued for reprocessing'); router.refresh() }
      else toast.error((await res.json()).error ?? 'Retry failed')
    } catch { toast.error('Network error') }
    finally { setRetrying(false) }
  }

  const handleSeek = useCallback((t: number) => setSeekTo(t), [])

  const outcomeColor = analysis ? (OUTCOME_COLORS[analysis.call_outcome] ?? ['#141e2d', '#7a8fa6']) : null

  const qBreakColor = (v: number) => v >= 7 ? '#12b76a' : v >= 4 ? '#f79009' : '#f04438'

  const STATUS_COLORS: Record<string, [string, string]> = {
    complete:    ['var(--rb-qualified-bg)', '#12b76a'],
    failed:      ['var(--rb-disqualified-bg)', '#f04438'],
    pending:     ['#1e2d40', '#7a8fa6'],
    downloading: ['#0d1e2e', '#38bdf8'],
    transcribing:['#1a0d2e', '#a78bfa'],
    analyzing:   ['#0d142e', '#6366f1'],
  }
  const [sBg, sColor] = STATUS_COLORS[call.status] ?? ['#1e2d40', '#7a8fa6']

  return (
    <div className="space-y-5 pb-16">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-bold truncate" style={{ color: 'var(--rb-text)' }}>
              {call.campaign_name ?? 'Unknown Campaign'}
            </h1>
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md"
              style={{ background: sBg, color: sColor }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: sColor }} />
              {call.status}
            </span>
            {(call as any).is_duplicate && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-md" style={{ background: 'var(--rb-borderline-bg)', color: '#f79009' }}>
                DUPLICATE
              </span>
            )}
          </div>
          <p className="text-xs mt-1 font-mono" style={{ color: 'var(--rb-text-3)' }}>{call.ringba_call_id}</p>
        </div>
        {(call.status === 'failed' || call.status === 'pending') && (
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="shrink-0 text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: 'var(--rb-surface-2)', border: '1px solid var(--rb-border-2)', color: 'var(--rb-text-2)' }}
          >
            {retrying ? 'Queuing…' : 'Retry'}
          </button>
        )}
      </div>

      {call.error_message && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--rb-disqualified-bg)', border: '1px solid #3d1212', color: '#f87171' }}>
          <strong>Error:</strong> {call.error_message}
        </div>
      )}

      {/* Hero stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Revenue', value: money(call.revenue), color: '#12b76a', sub: `Payout ${money(call.payout)}` },
          { label: 'Duration', value: dur(call.duration_seconds), color: 'var(--rb-text)', sub: `${call.duration_seconds ?? 0}s` },
          {
            label: 'Quality Score', value: analysis ? String(analysis.quality_score) : '—',
            color: analysis ? (analysis.quality_score >= 70 ? '#12b76a' : analysis.quality_score >= 40 ? '#f79009' : '#f04438') : 'var(--rb-text-3)',
            sub: 'out of 100',
          },
          {
            label: 'Lead Intent', value: analysis?.lead_intent ? String(analysis.lead_intent.score) : '—',
            color: analysis?.lead_intent ? (analysis.lead_intent.score >= 70 ? '#12b76a' : analysis.lead_intent.score >= 40 ? '#f79009' : '#f04438') : 'var(--rb-text-3)',
            sub: analysis?.lead_intent?.verdict ?? 'not analyzed',
          },
        ].map(item => (
          <div key={item.label} className="rounded-xl px-5 py-4" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>{item.label}</p>
            <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: item.color }}>{item.value}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--rb-text-3)' }}>{item.sub}</p>
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Left: Audio + Transcript */}
        <div className="lg:col-span-3 space-y-4">
          {audioUrl
            ? <AudioPlayer src={audioUrl} seekTo={seekTo} onTimeUpdate={setCurrentTime} />
            : (
              <div className="rounded-xl px-5 py-4 text-sm text-center" style={{ background: 'var(--rb-surface)', border: '1px solid var(--rb-border)', color: 'var(--rb-text-3)' }}>
                No audio recording available
              </div>
            )
          }

          <Panel>
            <div className="flex items-center justify-between mb-5">
              <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--rb-sidebar)' }}>
                {(['transcript', 'raw'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
                    style={{
                      background: tab === t ? 'var(--rb-surface-2)' : 'transparent',
                      color: tab === t ? 'var(--rb-text)' : 'var(--rb-text-3)',
                    }}
                  >
                    {t === 'transcript' ? 'Transcript' : 'Raw JSON'}
                  </button>
                ))}
              </div>
              {analysis && (
                <span className="text-xs" style={{ color: 'var(--rb-text-3)' }}>
                  Agent: <strong style={{ color: 'var(--rb-text-2)' }}>{analysis.agent_speaker}</strong>
                  &nbsp;·&nbsp;
                  Lang: <strong style={{ color: 'var(--rb-text-2)' }}>{analysis.language.toUpperCase()}</strong>
                </span>
              )}
            </div>

            {tab === 'transcript'
              ? call.transcript_text
                ? <TranscriptViewer
                    transcriptText={call.transcript_text}
                    segments={(call.transcript as any)?.segments ?? []}
                    agentSpeaker={(analysis?.agent_speaker as 'Speaker A' | 'Speaker B' | 'unclear' | undefined) ?? undefined}
                    currentTime={currentTime}
                    onSeek={audioUrl ? handleSeek : undefined}
                  />
                : <p className="text-sm italic" style={{ color: 'var(--rb-text-3)' }}>
                    {call.status !== 'complete' ? `Processing… (${call.status})` : 'No transcript.'}
                  </p>
              : <pre
                  className="text-xs overflow-auto max-h-[520px] p-4 rounded-xl"
                  style={{ background: 'var(--rb-sidebar)', color: 'var(--rb-text-2)', border: '1px solid var(--rb-border)' }}
                >
                  {JSON.stringify({ call, analysis }, null, 2)}
                </pre>
            }
          </Panel>
        </div>

        {/* Right sidebar */}
        <div className="lg:col-span-2 space-y-4">

          {/* Final Expense */}
          {analysis?.final_expense ? (
            <Panel title="Final Expense Qualifier">
              <FinalExpenseCard data={analysis.final_expense} />
            </Panel>
          ) : analysis && (
            <div
              className="rounded-xl px-5 py-4 flex items-start justify-between gap-4"
              style={{ background: 'var(--rb-borderline-bg)', border: '1px solid #3d2a08' }}
            >
              <div>
                <p className="text-sm font-bold" style={{ color: '#f79009' }}>Final Expense Qualifier not available</p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: '#7a5c2e' }}>
                  This call was analyzed before the FE qualifier was added. Re-analyze to extract age, insurance interest, bank account, affordability, and compliance flags.
                </p>
              </div>
              <ReanalyzeButton callId={call.id} onSuccess={() => setTimeout(() => router.refresh(), 5000)} />
            </div>
          )}

          {analysis ? (
            <>
              {/* Summary */}
              <Panel title="Call Summary">
                <p className="text-sm leading-relaxed" style={{ color: 'var(--rb-text-2)' }}>{analysis.summary}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  {outcomeColor && (
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-md"
                      style={{ background: outcomeColor[0], color: outcomeColor[1] }}
                    >
                      {analysis.call_outcome.replace(/_/g, ' ')}
                    </span>
                  )}
                  <span
                    className="text-xs px-2.5 py-1 rounded-md"
                    style={{ background: 'var(--rb-surface-2)', color: 'var(--rb-text-2)' }}
                  >
                    Confidence: <strong style={{ color: 'var(--rb-text)' }}>{analysis.outcome_confidence}</strong>
                  </span>
                </div>
              </Panel>

              {/* Quality */}
              <Panel title="Quality Score">
                <div className="flex items-center gap-5">
                  <Ring score={analysis.quality_score} />
                  <div className="flex-1 space-y-2">
                    {Object.entries(analysis.quality_breakdown).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="text-[11px] w-36 shrink-0 capitalize" style={{ color: 'var(--rb-text-3)' }}>{k.replace(/_/g, ' ')}</span>
                        <div className="flex-1 rounded-full h-1.5" style={{ background: 'var(--rb-border)' }}>
                          <div
                            className="h-1.5 rounded-full"
                            style={{ width: `${(v as number / 10) * 100}%`, background: qBreakColor(v as number) }}
                          />
                        </div>
                        <span className="text-xs font-semibold w-7 text-right" style={{ color: 'var(--rb-text-2)' }}>{v as number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>

              {/* Lead Intent */}
              {analysis.lead_intent && (
                <Panel title="Lead Intent">
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <Ring score={analysis.lead_intent.score} />
                      <div className="space-y-2">
                        <span
                          className="inline-block text-xs font-bold px-2.5 py-1 rounded-md"
                          style={{
                            background: analysis.lead_intent.verdict === 'qualified' ? 'var(--rb-qualified-bg)' : analysis.lead_intent.verdict === 'borderline' ? 'var(--rb-borderline-bg)' : 'var(--rb-disqualified-bg)',
                            color: analysis.lead_intent.verdict === 'qualified' ? '#12b76a' : analysis.lead_intent.verdict === 'borderline' ? '#f79009' : '#f04438',
                          }}
                        >
                          {analysis.lead_intent.verdict}
                        </span>
                        <p className="text-xs font-medium" style={{ color: analysis.lead_intent.is_genuine_inquiry ? '#12b76a' : '#f04438' }}>
                          {analysis.lead_intent.is_genuine_inquiry ? '✓ Genuine inquiry' : '✗ Not genuine'}
                        </p>
                      </div>
                    </div>
                    {analysis.lead_intent.misalignment_reason && (
                      <div className="rounded-lg px-3.5 py-2.5" style={{ background: 'var(--rb-borderline-bg)', border: '1px solid #3d2a08' }}>
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#f79009' }}>Misalignment</p>
                        <p className="text-xs leading-relaxed" style={{ color: '#d4a055' }}>{analysis.lead_intent.misalignment_reason}</p>
                      </div>
                    )}
                    {analysis.lead_intent.intent_signals.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Intent Signals</p>
                        <ul className="space-y-1">
                          {analysis.lead_intent.intent_signals.map((s, i) => (
                            <li key={i} className="flex gap-2 text-xs">
                              <span style={{ color: '#12b76a' }}>+</span>
                              <span className="italic" style={{ color: '#4ade80' }}>"{s}"</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.lead_intent.red_flags.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>Red Flags</p>
                        <ul className="space-y-1">
                          {analysis.lead_intent.red_flags.map((r, i) => (
                            <li key={i} className="flex gap-2 text-xs">
                              <span style={{ color: '#f04438' }}>!</span>
                              <span className="italic" style={{ color: '#f87171' }}>"{r}"</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Panel>
              )}

              {/* Flags */}
              {analysis.flags.length > 0 && (
                <Panel title="Flags">
                  <div className="flex flex-wrap gap-2">
                    {analysis.flags.map(flag => {
                      const [bg, color] = FLAG_COLORS[flag] ?? ['#141e2d', '#7a8fa6']
                      return (
                        <span
                          key={flag}
                          className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold cursor-default"
                          style={{ background: bg, color }}
                          title={analysis.flag_details[flag] ?? undefined}
                        >
                          {flag.replace(/_/g, ' ')}
                        </span>
                      )
                    })}
                  </div>
                </Panel>
              )}

              {/* Extracted */}
              <Panel title="Extracted Info">
                <dl className="space-y-3">
                  {[
                    { label: 'Caller name', value: analysis.extracted_data.caller_stated_name },
                    { label: 'State / Location', value: analysis.extracted_data.caller_location_state },
                    { label: 'Intent / Need', value: analysis.extracted_data.intent_or_need },
                  ].filter(x => x.value).map(({ label, value }) => (
                    <div key={label}>
                      <dt className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>{label}</dt>
                      <dd className="text-sm mt-0.5" style={{ color: 'var(--rb-text)' }}>{value}</dd>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>Payment</dt>
                      <dd className="text-sm font-semibold mt-0.5" style={{ color: analysis.extracted_data.payment_info_collected ? '#12b76a' : 'var(--rb-text-3)' }}>
                        {analysis.extracted_data.payment_info_collected ? 'Collected' : 'No'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--rb-text-3)' }}>Callback</dt>
                      <dd className="text-sm font-semibold mt-0.5" style={{ color: analysis.extracted_data.callback_requested ? '#818cf8' : 'var(--rb-text-3)' }}>
                        {analysis.extracted_data.callback_requested ? 'Requested' : 'No'}
                      </dd>
                    </div>
                  </div>
                  {analysis.extracted_data.objections_raised.length > 0 && (
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--rb-text-3)' }}>Objections</dt>
                      <ul className="space-y-0.5">
                        {analysis.extracted_data.objections_raised.map((o, i) => (
                          <li key={i} className="text-xs flex gap-2" style={{ color: 'var(--rb-text-2)' }}>
                            <span style={{ color: 'var(--rb-text-3)' }}>·</span>{o}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysis.extracted_data.commitments_made.length > 0 && (
                    <div>
                      <dt className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--rb-text-3)' }}>Commitments</dt>
                      <ul className="space-y-0.5">
                        {analysis.extracted_data.commitments_made.map((c, i) => (
                          <li key={i} className="text-xs flex gap-2" style={{ color: '#4ade80' }}>
                            <span>✓</span>{c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </dl>
              </Panel>

              {/* Coaching */}
              {analysis.coaching_notes && (
                <div className="rounded-xl p-5" style={{ background: '#0d1e30', border: '1px solid #1a3352' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#38bdf8' }}>Coaching Note</p>
                  <p className="text-sm leading-relaxed" style={{ color: '#7cc8f0' }}>{analysis.coaching_notes}</p>
                </div>
              )}
            </>
          ) : (
            <Panel title="Analysis">
              <p className="text-sm italic" style={{ color: 'var(--rb-text-3)' }}>
                {call.status === 'complete' ? 'No analysis data.' : `Processing… (${call.status})`}
              </p>
            </Panel>
          )}

          {/* Metadata */}
          <Panel title="Call Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <MetaItem label="Campaign" value={call.campaign_name ?? '—'} />
              <MetaItem label="Publisher" value={call.publisher_name ?? '—'} />
              <MetaItem label="Target" value={(call as any).target_name ?? '—'} />
              <MetaItem label="Buyer" value={call.buyer_name ?? '—'} />
              <MetaItem label="Caller ID" value={call.caller_id ?? '—'} />
              <MetaItem label="Dialed #" value={(call as any).target_number ?? '—'} />
              <MetaItem label="Received" value={fmtDate(call.received_at)} />
              <MetaItem label="Duration" value={dur(call.duration_seconds)} />
              <MetaItem label="End source" value={(call as any).end_call_source ?? '—'} />
              <MetaItem label="Duplicate" value={(call as any).is_duplicate == null ? '—' : (call as any).is_duplicate ? 'Yes' : 'No'} />
              <MetaItem label="Revenue" value={money(call.revenue)} accent />
              <MetaItem label="Payout" value={money(call.payout)} />
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  )
}
