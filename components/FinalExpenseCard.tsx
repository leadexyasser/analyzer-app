'use client'

import { FinalExpenseQualifier } from '@/types/analysis'

interface Props {
  data: FinalExpenseQualifier
}

// ── atoms ─────────────────────────────────────────────────────────────────────

type Signal = 'good' | 'warn' | 'bad' | 'neutral'

function SignalDot({ s }: { s: Signal }) {
  const cls = {
    good: 'bg-emerald-500',
    warn: 'bg-amber-400',
    bad: 'bg-red-500',
    neutral: 'bg-slate-300',
  }[s]
  return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cls}`} />
}

function Row({
  label, signal, value, quote,
}: {
  label: string
  signal: Signal
  value: string
  quote?: string | null
}) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${
      signal === 'good' ? 'bg-emerald-50 border-emerald-100'
      : signal === 'warn' ? 'bg-amber-50 border-amber-100'
      : signal === 'bad' ? 'bg-red-50 border-red-100'
      : 'bg-slate-50 border-slate-100'
    }`}>
      <SignalDot s={signal} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">{label}</span>
          <span className={`text-xs font-bold ${
            signal === 'good' ? 'text-emerald-700'
            : signal === 'warn' ? 'text-amber-700'
            : signal === 'bad' ? 'text-red-700'
            : 'text-slate-500'
          }`}>{value}</span>
        </div>
        {quote && (
          <p className="text-xs italic text-slate-500 mt-1 truncate">"{quote}"</p>
        )}
      </div>
    </div>
  )
}

function ComplianceRow({
  label, triggered, quotes, quote,
}: {
  label: string
  triggered: boolean
  quotes?: string[]
  quote?: string | null
}) {
  const allQuotes = quotes?.length ? quotes : (quote ? [quote] : [])
  return (
    <div className={`rounded-xl border px-4 py-3 ${
      triggered
        ? 'bg-red-50 border-red-200'
        : 'bg-emerald-50 border-emerald-100'
    }`}>
      <div className="flex items-center gap-3">
        <span className={`text-base ${triggered ? '' : ''}`}>
          {triggered ? '🚨' : '✅'}
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">{label}</span>
            <span className={`text-xs font-bold ${triggered ? 'text-red-700' : 'text-emerald-700'}`}>
              {triggered ? 'DETECTED' : 'Clear'}
            </span>
          </div>
          {triggered && allQuotes.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {allQuotes.map((q, i) => (
                <li key={i} className="text-xs text-red-700 italic">"{q}"</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── score ring ────────────────────────────────────────────────────────────────

function QScoreRing({ score }: { score: number }) {
  const size = 80
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const fill = (score / 100) * circ
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#ef4444'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize="16" fontWeight="700" fill={color}>
        {score}
      </text>
    </svg>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────

export function FinalExpenseCard({ data }: Props) {
  const verdictStyle = {
    qualified: { bg: 'bg-emerald-500', text: 'text-white', label: 'Qualified' },
    borderline: { bg: 'bg-amber-400', text: 'text-white', label: 'Borderline' },
    disqualified: { bg: 'bg-red-500', text: 'text-white', label: 'Disqualified' },
    compliance_risk: { bg: 'bg-red-700', text: 'text-white', label: 'Compliance Risk' },
  }[data.qualifier_verdict]

  const hasComplianceIssue =
    data.free_government_mentions ||
    data.outbound_call_claimed ||
    data.ftc_regulatory_mention ||
    data.scam_keywords_mentioned ||
    data.misleading_ad_mention

  // Age signal
  const ageSignal: Signal =
    data.age_verdict === 'good' ? 'good'
    : data.age_verdict === 'borderline' ? 'warn'
    : data.age_verdict === 'bad' ? 'bad'
    : 'neutral'

  const ageLabel =
    data.age_mentioned != null
      ? `${data.age_mentioned} yrs — ${data.age_verdict === 'good' ? 'In range (40–80)' : data.age_verdict === 'borderline' ? 'Borderline (81–85)' : 'Out of range (85+)'}`
      : 'Not mentioned'

  // Insurance interest signal
  const insuranceSignal: Signal =
    data.interested_in_life_insurance === 'yes' ? 'good'
    : data.interested_in_life_insurance === 'no' ? 'bad'
    : 'neutral'

  // Bank signal
  const bankSignal: Signal =
    data.has_bank_account === 'yes' ? 'good'
    : data.has_bank_account === 'no' ? 'bad'
    : 'neutral'

  // Affordability signal
  const affordSignal: Signal =
    data.can_afford === 'yes' ? 'good'
    : data.can_afford === 'concerns' ? 'warn'
    : data.can_afford === 'no' ? 'bad'
    : 'neutral'

  const affordLabel =
    data.can_afford === 'yes' ? 'Can afford'
    : data.can_afford === 'concerns' ? 'Has concerns / fixed income'
    : data.can_afford === 'no' ? 'Cannot afford'
    : 'Unknown'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-5">
        <QScoreRing score={data.qualifier_score} />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
            Final Expense Qualifier
          </p>
          <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-bold ${verdictStyle.bg} ${verdictStyle.text}`}>
            {hasComplianceIssue && <span className="mr-1.5">⚠️</span>}
            {verdictStyle.label}
          </span>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed max-w-xs">
            {data.qualifier_summary}
          </p>
        </div>
      </div>

      {/* Compliance alert banner */}
      {hasComplianceIssue && (
        <div className="bg-red-700 text-white rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-xl shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-bold">Compliance Issue Detected</p>
            <p className="text-xs text-red-200 mt-0.5">
              This call contains one or more compliance red flags. Review carefully before approving.
            </p>
          </div>
        </div>
      )}

      {/* Qualifying factors */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">
          Lead Qualifiers
        </p>
        <div className="space-y-2">
          <Row
            label="Age"
            signal={ageSignal}
            value={ageLabel}
          />
          <Row
            label="Interested in life insurance"
            signal={insuranceSignal}
            value={data.interested_in_life_insurance === 'yes' ? 'Yes' : data.interested_in_life_insurance === 'no' ? 'No' : 'Unclear'}
            quote={data.insurance_interest_notes}
          />
          <Row
            label="Has bank account / credit card"
            signal={bankSignal}
            value={data.has_bank_account === 'yes' ? 'Yes' : data.has_bank_account === 'no' ? 'No' : 'Unclear'}
          />
          <Row
            label="Ability to pay"
            signal={affordSignal}
            value={affordLabel}
            quote={data.affordability_notes}
          />
        </div>
      </div>

      {/* Compliance checks */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">
          Compliance Checks
        </p>
        <div className="space-y-2">
          <ComplianceRow
            label="Free / Government program mentions"
            triggered={data.free_government_mentions}
            quotes={data.free_government_quotes}
          />
          <ComplianceRow
            label="Outbound call claimed (we are inbound only)"
            triggered={data.outbound_call_claimed}
            quote={data.outbound_call_quote}
          />
          <ComplianceRow
            label="FTC / Regulatory complaint mention"
            triggered={data.ftc_regulatory_mention}
            quote={data.ftc_quote}
          />
          <ComplianceRow
            label="Scam / Fraud keywords"
            triggered={data.scam_keywords_mentioned}
            quotes={data.scam_quotes}
          />
          <ComplianceRow
            label="Misleading ad / False advertising"
            triggered={data.misleading_ad_mention}
            quotes={data.misleading_quotes}
          />
        </div>
      </div>
    </div>
  )
}
