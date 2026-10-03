import { env } from '../config/env';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:#4f46e5;padding:20px 28px;color:#fff;font-weight:600;font-size:16px">${esc(env.EMAIL_FROM_NAME)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #f3f4f6;color:#9ca3af;font-size:12px">${esc(env.SEED_ORG_NAME)} · This is an automated message.</td></tr>
</table></td></tr></table></body></html>`;
}

export function otpEmail(p: { name: string; code: string; ttlMinutes: number }) {
  const html = layout(
    'Verify your email',
    `<p style="margin:0 0 20px;line-height:1.5;color:#374151">Hi ${esc(p.name)}, use this code to finish signing in:</p>
<div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f5f3ff;color:#4338ca;border-radius:8px;padding:16px;text-align:center">${p.code}</div>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5">The code expires in ${p.ttlMinutes} minutes. If you didn't request it, you can ignore this email.</p>`,
  );
  return {
    subject: `${p.code} is your verification code`,
    html,
    text: `Hi ${p.name},\n\nYour verification code is ${p.code}. It expires in ${p.ttlMinutes} minutes.\n\nIf you didn't request it, ignore this email.`,
  };
}
