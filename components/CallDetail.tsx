'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Call } from '@/types/database'
import { Analysis } from '@/types/analysis'
import { AudioPlayer } from '@/components/AudioPlayer'
import { TranscriptViewer } from '@/components/TranscriptViewer'
import { FinalExpenseCard } from '@/components/FinalExpenseCard'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

interface Props {
  call: Call
  audioUrl: string | null
}

// ── tiny helpers ──────────────────────────────────────────────────────────────

function dur(s: number | null) {
  if (!s) return '—'
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function money(v: number | null, prefix = '$') {
  if (v == null) return '—'
  return `${prefix}${Number(v).toFixed(2)}`
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

// ── small reusables ───────────────────────────────────────────────────────────

function Pill({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${accent ? 'text-indigo-600' : 'text-slate-800'}`}>{value}</p>
    </div>
  )
}

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const fill = (score / 100) * circ
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill={color}>
        {score}
      </text>
    </svg>
  )
}

function Bar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="flex-1 bg-slate-100 rounded-full h-1.5">
      <div
        className={`h-1.5 rounded-full transition-all ${color}`}
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  )
}

const FLAG_COLORS: Record<string, { bg: string; text: string }> = {
  agent_unprofessional: { bg: 'bg-red-100', text: 'text-red-700' },
  compliance_concern: { bg: 'bg-red-100', text: 'text-red-700' },
  caller_hostile: { bg: 'bg-orange-100', text: 'text-orange-700' },
  premature_hangup: { bg: 'bg-orange-100', text: 'text-orange-700' },
  agent_script_deviation: { bg: 'bg-amber-100', text: 'text-amber-700' },
  dead_air_excessive: { bg: 'bg-amber-100', text: 'text-amber-700' },
  caller_confused: { bg: 'bg-amber-100', text: 'text-amber-700' },
  audio_quality_poor: { bg: 'bg-slate-100', text: 'text-slate-600' },
  insufficient_audio: { bg: 'bg-slate-100', text: 'text-slate-600' },
  language_mismatch: { bg: 'bg-blue-100', text: 'text-blue-700' },
  duplicate_caller_suspected: { bg: 'bg-purple-100', text: 'text-purple-700' },
}

const OUTCOME_LABELS: Record<string, { label: string; cls: string }> = {
  transferred: { label: 'Transferred', cls: 'bg-emerald-100 text-emerald-800' },
  qualified_no_transfer: { label: 'Qualified — no transfer', cls: 'bg-teal-100 text-teal-800' },
  not_qualified: { label: 'Not qualified', cls: 'bg-red-100 text-red-800' },
  hung_up_early: { label: 'Hung up early', cls: 'bg-orange-100 text-orange-800' },
  voicemail: { label: 'Voicemail', cls: 'bg-slate-100 text-slate-600' },
  wrong_number: { label: 'Wrong number', cls: 'bg-slate-100 text-slate-600' },
  callback_scheduled: { label: 'Callback scheduled', cls: 'bg-indigo-100 text-indigo-800' },
  sale_closed: { label: 'Sale closed', cls: 'bg-emerald-200 text-emerald-900 font-bold' },
  unclear: { label: 'Unclear', cls: 'bg-slate-100 text-slate-500' },
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800',
    pending: 'bg-slate-100 text-slate-600',
    downloading: 'bg-sky-100 text-sky-700',
    transcribing: 'bg-violet-100 text-violet-700',
    analyzing: 'bg-indigo-100 text-indigo-700',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${map[status] ?? 'bg-slate-100 text-slate-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'complete' ? 'bg-emerald-500' : status === 'failed' ? 'bg-red-500' : 'bg-slate-400'}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ── section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className}`}>
      {title && (
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">{title}</h3>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────

export function CallDetail({ call, audioUrl }: Props) {
  const [retrying, setRetrying] = useState(false)
  const [activeTab, setActiveTab] = useState<'transcript' | 'raw'>('transcript')
  const [seekTo, setSeekTo] = useState<number | undefined>()
  const [currentTime, setCurrentTime] = useState(0)
  const router = useRouter()
  const analysis = call.analysis as Analysis | null

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const res = await fetch(`/api/calls/${call.id}`, { method: 'POST' })
      if (res.ok) {
        toast.success('Call queued for reprocessing')
        router.refresh()
      } else {
        toast.error((await res.json()).error ?? 'Retry failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setRetrying(false)
    }
  }

  const handleSeek = useCallback((t: number) => setSeekTo(t), [])

  const outcomeInfo = analysis ? (OUTCOME_LABELS[analysis.call_outcome] ?? { label: analysis.call_outcome, cls: 'bg-slate-100 text-slate-600' }) : null

  const qualityBreakdownColor = (v: number) =>
    v >= 7 ? 'bg-emerald-500' : v >= 4 ? 'bg-amber-500' : 'bg-red-500'

  const intentColor = (score: number) =>
    score >= 70 ? 'text-emerald-600' : score >= 40 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-6 pb-16">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 truncate">{call.campaign_name ?? 'Unknown Campaign'}</h1>
            <StatusBadge status={call.status} />
            {call.is_duplicate && (
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">DUPLICATE</span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1 font-mono">{call.ringba_call_id}</p>
        </div>
        {(call.status === 'failed' || call.status === 'pending') && (
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="shrink-0 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-medium transition-colors"
          >
            {retrying ? 'Queuing…' : 'Retry'}
          </button>
        )}
      </div>

      {call.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <strong>Error:</strong> {call.error_message}
        </div>
      )}

      {/* ── Hero stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Revenue', value: money(call.revenue), color: 'text-emerald-600', sub: `Payout ${money(call.payout)}` },
          { label: 'Duration', value: dur(call.duration_seconds), color: 'text-slate-900', sub: `${call.duration_seconds ?? 0}s` },
          { label: 'Quality Score', value: analysis ? String(analysis.quality_score) : '—', color: analysis ? (analysis.quality_score >= 70 ? 'text-emerald-600' : analysis.quality_score >= 40 ? 'text-amber-600' : 'text-red-600') : 'text-slate-400', sub: 'out of 100' },
          { label: 'Lead Intent', value: analysis?.lead_intent ? String(analysis.lead_intent.score) : '—', color: analysis?.lead_intent ? intentColor(analysis.lead_intent.score) : 'text-slate-400', sub: analysis?.lead_intent?.verdict ?? 'not analyzed' },
        ].map(item => (
          <div key={item.label} className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{item.label}</p>
            <p className={`text-3xl font-bold mt-1 ${item.color}`}>{item.value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{item.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Two-column body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* ── LEFT: Audio + Transcript ── */}
        <div className="lg:col-span-3 space-y-4">

          {audioUrl ? (
            <AudioPlayer
              src={audioUrl}
              seekTo={seekTo}
              onTimeUpdate={setCurrentTime}
            />
          ) : (
            <div className="bg-slate-100 rounded-2xl px-5 py-4 text-sm text-slate-400 text-center">
              No audio recording available
            </div>
          )}

          {/* Transcript */}
          <Section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                {(['transcript', 'raw'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {tab === 'transcript' ? 'Transcript' : 'Raw JSON'}
                  </button>
                ))}
              </div>
              {analysis && (
                <span className="text-xs text-slate-400">
                  Agent: <strong className="text-slate-600">{analysis.agent_speaker}</strong>
                  &nbsp;·&nbsp;Lang: <strong className="text-slate-600">{analysis.language.toUpperCase()}</strong>
                </span>
              )}
            </div>

            {activeTab === 'transcript' ? (
              call.transcript_text ? (
                <TranscriptViewer
                  transcriptText={call.transcript_text}
                  segments={(call.transcript as any)?.segments ?? []}
                  agentSpeaker={analysis?.agent_speaker}
                  currentTime={currentTime}
                  onSeek={audioUrl ? handleSeek : undefined}
                />
              ) : (
                <p className="text-sm text-slate-400 italic">
                  {call.status !== 'complete' ? `Transcript not ready yet — status: ${call.status}` : 'No transcript available.'}
                </p>
              )
            ) : (
              <pre className="text-xs overflow-auto max-h-[520px] bg-slate-50 rounded-xl p-4 text-slate-700">
                {JSON.stringify({ call, analysis }, null, 2)}
              </pre>
            )}
          </Section>
        </div>

        {/* ── RIGHT: Analysis sidebar ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Final Expense Qualifier */}
          {analysis?.final_expense && (
            <Section title="Final Expense Qualifier">
              <FinalExpenseCard data={analysis.final_expense} />
            </Section>
          )}

          {/* Summary */}
          {analysis ? (
            <>
              <Section title="Call Summary">
                <p className="text-sm text-slate-700 leading-relaxed">{analysis.summary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {outcomeInfo && (
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${outcomeInfo.cls}`}>
                      {outcomeInfo.label}
                    </span>
                  )}
                  <span className={`text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600`}>
                    Confidence: <strong>{analysis.outcome_confidence}</strong>
                  </span>
                </div>
              </Section>

              {/* Quality */}
              <Section title="Quality Score">
                <div className="flex items-center gap-5">
                  <ScoreRing score={analysis.quality_score} />
                  <div className="flex-1 space-y-2">
                    {Object.entries(analysis.quality_breakdown).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 w-36 shrink-0 capitalize">{k.replace(/_/g, ' ')}</span>
                        <Bar value={v as number} max={10} color={qualityBreakdownColor(v as number)} />
                        <span className="text-xs font-semibold text-slate-700 w-7 text-right">{v as number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Section>

              {/* Lead Intent */}
              {analysis.lead_intent && (
                <Section title="Lead Intent">
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <ScoreRing score={analysis.lead_intent.score} />
                      <div>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          analysis.lead_intent.verdict === 'qualified' ? 'bg-emerald-100 text-emerald-800'
                          : analysis.lead_intent.verdict === 'borderline' ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                        }`}>
                          {analysis.lead_intent.verdict}
                        </span>
                        <p className={`text-xs mt-2 font-medium ${analysis.lead_intent.is_genuine_inquiry ? 'text-emerald-600' : 'text-red-600'}`}>
                          {analysis.lead_intent.is_genuine_inquiry ? '✓ Genuine inquiry' : '✗ Not a genuine inquiry'}
                        </p>
                      </div>
                    </div>

                    {analysis.lead_intent.misalignment_reason && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-1">Misalignment</p>
                        <p className="text-xs text-amber-800 leading-relaxed">{analysis.lead_intent.misalignment_reason}</p>
                      </div>
                    )}

                    {analysis.lead_intent.intent_signals.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Intent Signals</p>
                        <ul className="space-y-1">
                          {analysis.lead_intent.intent_signals.map((s, i) => (
                            <li key={i} className="flex gap-2 text-xs text-emerald-700">
                              <span className="text-emerald-400 shrink-0">+</span>
                              <span className="italic">"{s}"</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis.lead_intent.red_flags.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Red Flags</p>
                        <ul className="space-y-1">
                          {analysis.lead_intent.red_flags.map((r, i) => (
                            <li key={i} className="flex gap-2 text-xs text-red-600">
                              <span className="shrink-0">!</span>
                              <span className="italic">"{r}"</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {/* Flags */}
              {analysis.flags.length > 0 && (
                <Section title="Flags">
                  <div className="flex flex-wrap gap-2">
                    {analysis.flags.map(flag => {
                      const c = FLAG_COLORS[flag] ?? { bg: 'bg-slate-100', text: 'text-slate-600' }
                      return (
                        <div key={flag} className="group relative">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold cursor-default ${c.bg} ${c.text}`}>
                            {flag.replace(/_/g, ' ')}
                          </span>
                          {analysis.flag_details[flag] && (
                            <div className="absolute bottom-full left-0 mb-2 z-20 w-52 bg-slate-900 text-white text-xs rounded-xl p-2.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl">
                              {analysis.flag_details[flag]}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Section>
              )}

              {/* Extracted Data */}
              <Section title="Extracted Info">
                <dl className="space-y-3">
                  {[
                    { label: 'Caller name', value: analysis.extracted_data.caller_stated_name },
                    { label: 'State / Location', value: analysis.extracted_data.caller_location_state },
                    { label: 'Intent / Need', value: analysis.extracted_data.intent_or_need },
                  ].map(({ label, value }) => value && (
                    <div key={label}>
                      <dt className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</dt>
                      <dd className="text-sm text-slate-800 mt-0.5">{value}</dd>
                    </div>
                  ))}

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Payment collected</dt>
                      <dd className={`text-sm font-semibold mt-0.5 ${analysis.extracted_data.payment_info_collected ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {analysis.extracted_data.payment_info_collected ? 'Yes' : 'No'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Callback requested</dt>
                      <dd className={`text-sm font-semibold mt-0.5 ${analysis.extracted_data.callback_requested ? 'text-indigo-600' : 'text-slate-400'}`}>
                        {analysis.extracted_data.callback_requested ? 'Yes' : 'No'}
                      </dd>
                    </div>
                  </div>

                  {analysis.extracted_data.objections_raised.length > 0 && (
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Objections raised</dt>
                      <ul className="space-y-0.5">
                        {analysis.extracted_data.objections_raised.map((o, i) => (
                          <li key={i} className="text-xs text-slate-700 flex gap-2"><span className="text-slate-400">·</span>{o}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysis.extracted_data.commitments_made.length > 0 && (
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Commitments made</dt>
                      <ul className="space-y-0.5">
                        {analysis.extracted_data.commitments_made.map((c, i) => (
                          <li key={i} className="text-xs text-emerald-700 flex gap-2"><span>✓</span>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </dl>
              </Section>

              {/* Coaching */}
              {analysis.coaching_notes && (
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">Coaching Note</p>
                  <p className="text-sm text-indigo-900 leading-relaxed">{analysis.coaching_notes}</p>
                </div>
              )}
            </>
          ) : (
            <Section title="Analysis">
              <p className="text-sm text-slate-400 italic">
                {call.status === 'complete' ? 'No analysis data.' : `Processing… (${call.status})`}
              </p>
            </Section>
          )}

          {/* Call Metadata */}
          <Section title="Call Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Pill label="Campaign" value={call.campaign_name ?? '—'} />
              <Pill label="Publisher / Source" value={call.publisher_name ?? '—'} />
              <Pill label="Target name" value={call.target_name ?? '—'} />
              <Pill label="Buyer" value={call.buyer_name ?? '—'} />
              <Pill label="Caller ID" value={call.caller_id ?? '—'} />
              <Pill label="Dialed number" value={call.target_number ?? '—'} />
              <Pill label="Received" value={fmtDate(call.received_at)} />
              <Pill label="Call started" value={fmtDate(call.call_started_at)} />
              <Pill label="End source" value={call.end_call_source ?? '—'} />
              <Pill label="Duplicate" value={call.is_duplicate == null ? '—' : call.is_duplicate ? 'Yes' : 'No'} />
              <Pill label="Revenue" value={money(call.revenue)} accent />
              <Pill label="Payout" value={money(call.payout)} />
            </dl>
          </Section>

        </div>
      </div>
    </div>
  )
}
