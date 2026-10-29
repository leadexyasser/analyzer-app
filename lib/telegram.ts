// Telegram close-notification helper.
// Fires a one-time DM when a call transitions to sale_closed. Duplicate prevention
// is handled by the worker (checks metadata->>'telegram_notified_at' before calling this).

import type { ClosingBuyer } from '@/lib/closing-buyer'

type CloseCallInput = {
  id: string
  caller_id: string | null
  duration_seconds: number | null
  advisor_name: string | null
  policy_number: string | null
  premium_amount: string | null
  coverage_amount: string | null
  billing_date: string | null
  close_confidence: string | null
  todayCloseNumber: number | null
  campaignLabel: string | null
  closingBuyer: ClosingBuyer
}

const TELEGRAM_API = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`

// Escape only what Telegram's HTML parser cares about — see:
// https://core.telegram.org/bots/api#html-style
function esc(v: string | null | undefined): string {
  if (v == null) return '—'
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildMessage(c: CloseCallInput, appUrl: string): string {
  const minutes = c.duration_seconds ? Math.round(c.duration_seconds / 60) : null
  const durText = minutes != null ? `${minutes} min` : '—'
  const closeCounter = c.todayCloseNumber ? `Close #${c.todayCloseNumber} today` : ''
  const dashboardUrl = `${appUrl}/dashboard/calls/${c.id}`
  const buyer = c.closingBuyer
  const buyerText = buyer.via ? `${buyer.name} (via ${buyer.via})` : buyer.name

  const lines = [
    `🎉 <b>${esc(buyer.code)} | CLOSE — ${esc(c.campaignLabel || buyer.name)}</b>`,
    ``,
    `🏢 <b>Buyer:</b> ${esc(buyerText)}`,
    `📞 <b>Caller:</b> <code>${esc(c.caller_id)}</code>`,
    `👤 <b>Advisor:</b> ${esc(c.advisor_name)}`,
    c.coverage_amount ? `🛡 <b>Coverage:</b> ${esc(c.coverage_amount)}` : null,
    c.premium_amount ? `💵 <b>Premium:</b> ${esc(c.premium_amount)}` : null,
    c.policy_number ? `📄 <b>Policy #:</b> <code>${esc(c.policy_number)}</code>` : null,
    c.billing_date ? `📅 <b>Draft date:</b> ${esc(c.billing_date)}` : null,
    `⏱ <b>Duration:</b> ${durText}`,
    c.close_confidence ? `✅ <b>Confidence:</b> ${esc(c.close_confidence)}` : null,
    closeCounter ? `` : null,
    closeCounter ? `<i>${esc(closeCounter)}</i>` : null,
    ``,
    `🔗 <a href="${dashboardUrl}">View call</a>`,
  ].filter(Boolean) as string[]

  return lines.join('\n')
}

// Fire-and-log — never throw. A Telegram failure must not roll back a successful analysis.
export async function notifyClose(input: CloseCallInput): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  const appUrl = process.env.APP_URL || 'https://analyzer-app-delta.vercel.app'
  if (!token || !chatId) return

  try {
    const message = buildMessage(input, appUrl)
    const res = await fetch(TELEGRAM_API(token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[telegram] send failed', res.status, body.slice(0, 200))
    }
  } catch (err) {
    console.error('[telegram] error', err instanceof Error ? err.message : String(err))
  }
}
