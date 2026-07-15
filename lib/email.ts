import { Resend } from 'resend'

const FROM = process.env.EMAIL_FROM ?? 'Call Analyzer <onboarding@resend.dev>'

function client(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY is not set')
  return new Resend(key)
}

export async function sendMagicLinkEmail(to: string, link: string): Promise<void> {
  const r = client()
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0d1117; background: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 48px; height: 48px; background: #eab308; color: #0d1117; border-radius: 12px; line-height: 48px; font-weight: 900; font-size: 18px;">CA</div>
      </div>
      <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px; text-align: center;">Sign in to Call Analyzer</h1>
      <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px; text-align: center;">Click the button below to sign in. This link expires in 10 minutes.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${link}" style="display: inline-block; padding: 12px 32px; background: #eab308; color: #0d1117; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 8px;">Sign in</a>
      </div>
      <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 24px 0 0;">
        Or copy and paste this link:<br>
        <span style="word-break: break-all; color: #6b7280;">${link}</span>
      </p>
      <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 32px 0 0; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        If you didn't request this email, you can safely ignore it.
      </p>
    </div>
  `
  const { error } = await r.emails.send({
    from: FROM,
    to,
    subject: 'Sign in to Call Analyzer',
    html,
  })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
}
