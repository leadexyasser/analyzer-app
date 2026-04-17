'use client'

import { Analysis } from '@/types/analysis'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Props {
  analysis: Analysis
}

const FLAG_COLORS: Record<string, string> = {
  agent_unprofessional: 'bg-red-100 text-red-800',
  compliance_concern: 'bg-red-100 text-red-800',
  caller_hostile: 'bg-orange-100 text-orange-800',
  premature_hangup: 'bg-orange-100 text-orange-800',
  agent_script_deviation: 'bg-yellow-100 text-yellow-800',
  dead_air_excessive: 'bg-yellow-100 text-yellow-800',
  caller_confused: 'bg-yellow-100 text-yellow-800',
  audio_quality_poor: 'bg-gray-100 text-gray-700',
  insufficient_audio: 'bg-gray-100 text-gray-700',
  language_mismatch: 'bg-blue-100 text-blue-800',
  duplicate_caller_suspected: 'bg-purple-100 text-purple-800',
}

function ScoreMeter({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-gray-200 rounded-full h-3">
        <div className={`h-3 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-lg font-bold w-10 text-right">{score}</span>
    </div>
  )
}

function BreakdownRow({ label, score }: { label: string; score: number }) {
  const pct = (score / 10) * 100
  const color = pct >= 70 ? 'bg-green-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground w-48 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-medium w-8 text-right">{score}/10</span>
    </div>
  )
}

export function AnalysisCard({ analysis }: Props) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">{analysis.summary}</p>
          <div className="flex gap-3 mt-3 text-xs text-muted-foreground">
            <span>Outcome: <strong className="text-foreground">{analysis.call_outcome.replace(/_/g, ' ')}</strong></span>
            <span>Confidence: <strong className="text-foreground">{analysis.outcome_confidence}</strong></span>
            <span>Language: <strong className="text-foreground">{analysis.language}</strong></span>
            <span>Agent: <strong className="text-foreground">{analysis.agent_speaker}</strong></span>
          </div>
        </CardContent>
      </Card>

      {/* Quality Score */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Quality Score</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ScoreMeter score={analysis.quality_score} />
          <div className="space-y-2 pt-2">
            <BreakdownRow label="Agent Professionalism" score={analysis.quality_breakdown.agent_professionalism} />
            <BreakdownRow label="Caller Engagement" score={analysis.quality_breakdown.caller_engagement} />
            <BreakdownRow label="Qualification Completeness" score={analysis.quality_breakdown.qualification_completeness} />
            <BreakdownRow label="Call Outcome Clarity" score={analysis.quality_breakdown.call_outcome_clarity} />
          </div>
        </CardContent>
      </Card>

      {/* Flags */}
      {analysis.flags.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Flags</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {analysis.flags.map((flag) => (
                <div key={flag} className="group relative">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium cursor-default ${FLAG_COLORS[flag] ?? 'bg-gray-100 text-gray-700'}`}>
                    {flag.replace(/_/g, ' ')}
                  </span>
                  {analysis.flag_details[flag] && (
                    <div className="absolute bottom-full left-0 mb-1 z-10 w-48 bg-gray-900 text-white text-xs rounded p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      {analysis.flag_details[flag]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extracted Data */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Extracted Data</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Caller Name</dt>
              <dd className="mt-0.5">{analysis.extracted_data.caller_stated_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Location</dt>
              <dd className="mt-0.5">{analysis.extracted_data.caller_location_state ?? '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Intent / Need</dt>
              <dd className="mt-0.5">{analysis.extracted_data.intent_or_need ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Payment Collected</dt>
              <dd className="mt-0.5">{analysis.extracted_data.payment_info_collected ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Callback Requested</dt>
              <dd className="mt-0.5">{analysis.extracted_data.callback_requested ? 'Yes' : 'No'}</dd>
            </div>
            {analysis.extracted_data.objections_raised.length > 0 && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Objections</dt>
                <dd className="mt-0.5">
                  <ul className="list-disc list-inside space-y-0.5">
                    {analysis.extracted_data.objections_raised.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </dd>
              </div>
            )}
            {analysis.extracted_data.commitments_made.length > 0 && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Commitments</dt>
                <dd className="mt-0.5">
                  <ul className="list-disc list-inside space-y-0.5">
                    {analysis.extracted_data.commitments_made.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Lead Intent */}
      {analysis.lead_intent && (
        <Card className={analysis.lead_intent.verdict === 'qualified' ? 'border-emerald-200' : analysis.lead_intent.verdict === 'invalid' || analysis.lead_intent.verdict === 'unqualified' ? 'border-red-200' : 'border-amber-200'}>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              Lead Intent Match
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                analysis.lead_intent.verdict === 'qualified' ? 'bg-emerald-100 text-emerald-800'
                : analysis.lead_intent.verdict === 'borderline' ? 'bg-amber-100 text-amber-800'
                : 'bg-red-100 text-red-800'
              }`}>
                {analysis.lead_intent.verdict} · {analysis.lead_intent.score}/100
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ScoreMeter score={analysis.lead_intent.score} />
            <div className="flex items-center gap-2 text-sm">
              <span className={analysis.lead_intent.is_genuine_inquiry ? 'text-emerald-700' : 'text-red-600'}>
                {analysis.lead_intent.is_genuine_inquiry ? '✓ Genuine inquiry' : '✗ Not a genuine inquiry'}
              </span>
            </div>
            {analysis.lead_intent.misalignment_reason && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs font-medium text-amber-700 mb-0.5">Misalignment</p>
                <p className="text-sm text-amber-800">{analysis.lead_intent.misalignment_reason}</p>
              </div>
            )}
            {analysis.lead_intent.intent_signals.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Intent Signals</p>
                <ul className="space-y-0.5">
                  {analysis.lead_intent.intent_signals.map((s, i) => (
                    <li key={i} className="text-sm text-emerald-700 flex gap-2"><span>+</span><span>"{s}"</span></li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.lead_intent.red_flags.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Red Flags</p>
                <ul className="space-y-0.5">
                  {analysis.lead_intent.red_flags.map((r, i) => (
                    <li key={i} className="text-sm text-red-600 flex gap-2"><span>!</span><span>"{r}"</span></li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Coaching Notes */}
      {analysis.coaching_notes && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader><CardTitle className="text-sm text-blue-800">Coaching Note</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-blue-900">{analysis.coaching_notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
