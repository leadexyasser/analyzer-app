'use client'

import { FinalExpenseQualifier } from '@/types/analysis'

interface Props { data: FinalExpenseQualifier }

type Signal = 'good' | 'warn' | 'bad' | 'neutral'

const SIG_COLORS: Record<Signal, { dot: string; bg: string; border: string; text: string }> = {
  good:    { dot: '#12b76a', bg: '#071a10', border: '#0d3321', text: '#4ade80' },
  warn:    { dot: '#f79009', bg: '#1c1204', border: '#3d2a08', text: '#fbbf24' },
  bad:     { dot: '#f04438', bg: '#1c0808', border: '#3d1212', text: '#f87171' },
  neutral: { dot: '#4d6078', bg: '#141e2d', border: '#1e2d40', text: '#7a8fa6' },
}

function Row({ label, signal, value, quote }: { label: string; signal: Signal; value: string; quote?: string | null }) {
  const c = SIG_COLORS[signal]
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: c.dot }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--rb-text-2)' }}>{label}</span>
          <span className="text-xs font-bold shrink-0" style={{ color: c.text }}>{value}</span>
        </div>
        {quote && <p className="text-xs italic mt-0.5 truncate" style={{ color: 'var(--rb-text-3)' }}>"{quote}"</p>}
      </div>
    </div>
  )
}

function CompRow({ label, triggered, quotes, quote }: { label: string; triggered: boolean; quotes?: string[]; quote?: string | null }) {
  const all = quotes?.length ? quotes : (quote ? [quote] : [])
  const c = triggered ? SIG_COLORS.bad : SIG_COLORS.good
  return (
    <div className="px-4 py-3 rounded-xl" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <div className="flex items-center gap-3">
        <span className="text-base">{triggered ? '🚨' : '✅'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium" style={{ color: 'var(--rb-text-2)' }}>{label}</span>
            <span className="text-xs font-bold shrink-0" style={{ color: triggered ? '#f04438' : '#12b76a' }}>
              {triggered ? 'DETECTED' : 'Clear'}
            </span>
          </div>
          {triggered && all.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {all.map((q, i) => (
                <li key={i} className="text-xs italic" style={{ color: '#f87171' }}>"{q}"</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function Ring({ score }: { score: number }) {
  const size = 80, r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const fill = (score / 100) * circ
  const color = score >= 70 ? '#12b76a' : score >= 40 ? '#f79009' : '#f04438'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e2d40" strokeWidth="8" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2+6} textAnchor="middle" fontSize="16" fontWeight="700" fill={color}>{score}</text>
    </svg>
  )
}

export function FinalExpenseCard({ data }: Props) {
  const VERDICT = {
    qualified:       { bg: '#071a10', border: '#0d3321', text: '#12b76a', label: 'Qualified' },
    borderline:      { bg: '#1c1204', border: '#3d2a08', text: '#f79009', label: 'Borderline' },
    disqualified:    { bg: '#1c0808', border: '#3d1212', text: '#f04438', label: 'Disqualified' },
    compliance_risk: { bg: '#200a0a', border: '#5c1414', text: '#f04438', label: '⚠ Compliance Risk' },
  }[data.qualifier_verdict]

  const hasCompliance = data.free_government_mentions || data.outbound_call_claimed || data.ftc_regulatory_mention || data.scam_keywords_mentioned || data.misleading_ad_mention

  const ageSignal: Signal = data.age_verdict === 'good' ? 'good' : data.age_verdict === 'borderline' ? 'warn' : data.age_verdict === 'bad' ? 'bad' : 'neutral'
  const insSignal: Signal = data.interested_in_life_insurance === 'yes' ? 'good' : data.interested_in_life_insurance === 'no' ? 'bad' : 'neutral'
  const bankSignal: Signal = data.has_bank_account === 'yes' ? 'good' : data.has_bank_account === 'no' ? 'bad' : 'neutral'
  const affordSignal: Signal = data.can_afford === 'yes' ? 'good' : data.can_afford === 'concerns' ? 'warn' : data.can_afford === 'no' ? 'bad' : 'neutral'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-5">
        <Ring score={data.qualifier_score} />
        <div className="space-y-2">
          <span
            className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold"
            style={{ background: VERDICT.bg, border: `1px solid ${VERDICT.border}`, color: VERDICT.text }}
          >
            {VERDICT.label}
          </span>
          <p className="text-xs leading-relaxed max-w-xs" style={{ color: 'var(--rb-text-2)' }}>{data.qualifier_summary}</p>
        </div>
      </div>

      {/* Compliance banner */}
      {hasCompliance && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{ background: '#200a0a', border: '1px solid #5c1414' }}>
          <span className="text-xl shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-bold" style={{ color: '#f04438' }}>Compliance Issue Detected</p>
            <p className="text-xs mt-0.5" style={{ color: '#c97575' }}>
              This call contains one or more compliance red flags. Review carefully before approving.
            </p>
          </div>
        </div>
      )}

      {/* Qualifiers */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>
          Lead Qualifiers
        </p>
        <div className="space-y-2">
          <Row label="Age"
            signal={ageSignal}
            value={data.age_mentioned != null
              ? `${data.age_mentioned} yrs — ${data.age_verdict === 'good' ? 'In range (40–80)' : data.age_verdict === 'borderline' ? 'Borderline (81–85)' : 'Out of range (85+)'}`
              : 'Not mentioned'}
          />
          <Row label="Interested in life insurance" signal={insSignal}
            value={data.interested_in_life_insurance === 'yes' ? 'Yes' : data.interested_in_life_insurance === 'no' ? 'No' : 'Unclear'}
            quote={data.insurance_interest_notes}
          />
          <Row label="Has bank account / credit card" signal={bankSignal}
            value={data.has_bank_account === 'yes' ? 'Yes' : data.has_bank_account === 'no' ? 'No' : 'Unclear'}
          />
          <Row label="Ability to pay" signal={affordSignal}
            value={data.can_afford === 'yes' ? 'Can afford' : data.can_afford === 'concerns' ? 'Has concerns / fixed income' : data.can_afford === 'no' ? 'Cannot afford' : 'Unknown'}
            quote={data.affordability_notes}
          />
        </div>
      </div>

      {/* Compliance */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--rb-text-3)' }}>
          Compliance Checks
        </p>
        <div className="space-y-2">
          <CompRow label="Free / Government program mentions" triggered={data.free_government_mentions} quotes={data.free_government_quotes} />
          <CompRow label="Outbound call claimed (inbound only)" triggered={data.outbound_call_claimed} quote={data.outbound_call_quote} />
          <CompRow label="FTC / Regulatory complaint mention" triggered={data.ftc_regulatory_mention} quote={data.ftc_quote} />
          <CompRow label="Scam / Fraud keywords" triggered={data.scam_keywords_mentioned} quotes={data.scam_quotes} />
          <CompRow label="Misleading ad / False advertising" triggered={data.misleading_ad_mention} quotes={data.misleading_quotes} />
        </div>
      </div>
    </div>
  )
}
