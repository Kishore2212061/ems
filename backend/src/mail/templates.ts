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

const OTP_COPY = {
  FIRST_LOGIN: { title: 'Verify your email', intro: 'use this code to finish signing in', subject: 'is your verification code' },
  PASSWORD_RESET: { title: 'Reset your password', intro: 'use this code to reset your password', subject: 'is your password reset code' },
};

export function otpEmail(p: { name: string; code: string; ttlMinutes: number; purpose: keyof typeof OTP_COPY }) {
  const copy = OTP_COPY[p.purpose];
  const html = layout(
    copy.title,
    `<p style="margin:0 0 20px;line-height:1.5;color:#374151">Hi ${esc(p.name)}, ${copy.intro}:</p>
<div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f5f3ff;color:#4338ca;border-radius:8px;padding:16px;text-align:center">${p.code}</div>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5">The code expires in ${p.ttlMinutes} minutes. If you didn't request it, you can ignore this email.</p>`,
  );
  return {
    subject: `${p.code} ${copy.subject}`,
    html,
    text: `Hi ${p.name}, ${copy.intro}: ${p.code}\n\nIt expires in ${p.ttlMinutes} minutes.\n\nIf you didn't request it, ignore this email.`,
  };
}

const ROLE_NAME: Record<string, string> = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', FINANCE: 'Finance', SCANNER: 'Scanner' };

export function inviteEmail(p: { inviter: string; role: string; scopeLabel: string | null; link: string; ttlHours: number }) {
  const what = `${ROLE_NAME[p.role] ?? p.role}${p.scopeLabel ? ` · ${p.scopeLabel}` : ''}`;
  const html = layout(
    "You're invited to NEC Events",
    `<p style="margin:0 0 16px;line-height:1.5;color:#374151">${esc(p.inviter)} invited you to join as <strong>${esc(what)}</strong>.</p>
<p style="margin:0 0 24px"><a href="${esc(p.link)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Accept invitation</a></p>
<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5">This link expires in ${p.ttlHours} hours and works once. If you weren't expecting it, ignore this email.</p>`,
  );
  return {
    subject: `Invitation: ${what} — NEC Events`,
    html,
    text: `${p.inviter} invited you to join NEC Events as ${what}.\n\nAccept: ${p.link}\n\nThe link expires in ${p.ttlHours} hours.`,
  };
}

const p = (html: string) => `<p style="margin:0 0 16px;line-height:1.5;color:#374151">${html}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:0 0 20px"><a href="${esc(href)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${esc(label)}</a></p>`;
function facts(rows: [string, string][]) {
  const tr = rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px;font-weight:600">${esc(v)}</td></tr>`)
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-top:1px solid #f3f4f6;width:100%">${tr}</table>`;
}

export interface RegistrationMailInput {
  /** Recipient's name. */
  name: string;
  event: string;
  fest: string;
  when: string;
  where: string;
  code: string;
  team: string | null;
  members: string[];
  /** "Free", "Pay ₹100 at the registration desk", "₹200 paid online". */
  payment: string;
  link: string;
  /** Set when someone else (the team leader) registered the recipient. */
  addedBy?: string;
  /** The recipient's own ticket: its QR is embedded as an inline image (cid). */
  ticket?: { code: string; cid: string; payFirst: boolean };
}

function qrBlock(t: NonNullable<RegistrationMailInput['ticket']>) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td align="center" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
<img src="cid:${esc(t.cid)}" width="200" height="200" alt="Your entry QR code" style="display:block;width:200px;height:200px;border:0">
<div style="margin-top:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;letter-spacing:2px;color:#6b7280">${esc(t.code)}</div>
<div style="margin-top:6px;font-size:13px;color:#374151">${t.payFirst ? 'Pay at the registration desk, then show this QR' : 'Show this QR at the registration desk'}</div>
</td></tr></table>`;
}

export function registrationEmail(r: RegistrationMailInput) {
  const intro = r.addedBy
    ? `Hi ${esc(r.name)}, <strong>${esc(r.addedBy)}</strong> registered you${r.team ? ` in team <strong>${esc(r.team)}</strong>` : ''} for <strong>${esc(r.event)}</strong> at ${esc(r.fest)}.`
    : `Hi ${esc(r.name)}, you're registered for <strong>${esc(r.event)}</strong> at ${esc(r.fest)}.`;
  const rows: [string, string][] = [
    ...(r.ticket ? [] : [['Code', r.code] as [string, string]]),
    ['When', r.when],
    ['Where', r.where],
    ...(r.members.length > 1 ? [['Team', `${r.team ? `${r.team}: ` : ''}${r.members.join(', ')}`] as [string, string]] : []),
    ['Entry', r.payment],
  ];
  const next = r.addedBy
    ? 'Sign in (or create an account) with this email address to see it in your registrations. If this is a mistake, contact the team leader or the event coordinators.'
    : 'Keep this email handy: the QR is your entry pass (it is also in the app).';
  const html = layout(r.addedBy ? 'You have been added to a team' : "You're registered", `${p(intro)}${r.ticket ? qrBlock(r.ticket) : ''}${facts(rows)}${button(r.link, 'View registration')}<p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5">${esc(next)}</p>`);
  return {
    subject: `${r.addedBy ? 'Added to a team' : 'Registered'}: ${r.event} (${r.code})`,
    html,
    text: `${r.addedBy ? `${r.addedBy} registered you${r.team ? ` in team ${r.team}` : ''} for ${r.event} at ${r.fest}.` : `You're registered for ${r.event} at ${r.fest}.`}\n\n${r.ticket ? `Ticket: ${r.ticket.code} (your QR is in this email and in the app)\n` : ''}${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nView: ${r.link}\n\n${next}`,
  };
}

export function registrationCancelledEmail(r: { name: string; event: string; code: string; by: string; reason: string | null; link: string }) {
  const html = layout(
    'Registration cancelled',
    `${p(`Hi ${esc(r.name)}, the registration <strong>${esc(r.code)}</strong> for <strong>${esc(r.event)}</strong> was cancelled by ${esc(r.by)}${r.reason ? `: ${esc(r.reason)}` : '.'}`)}${button(r.link, 'Browse events')}`,
  );
  return {
    subject: `Cancelled: ${r.event} (${r.code})`,
    html,
    text: `The registration ${r.code} for ${r.event} was cancelled by ${r.by}${r.reason ? `: ${r.reason}` : '.'}\n\nBrowse events: ${r.link}`,
  };
}

const REFUND_COPY = {
  started: { title: 'Refund on its way', line: 'Your refund has been started. Banks usually credit it within 5–7 working days.' },
  done: { title: 'Refund processed', line: 'Your refund has been processed by the payment gateway. Your bank will show it shortly.' },
  manual: { title: 'Refund at the registration desk', line: 'You paid in cash, so the organisers will hand your money back at the registration desk.' },
  rejected: { title: 'Refund request declined', line: 'Your refund request was declined.' },
};

export function refundEmail(r: { name: string; event: string; code: string; amount: string; kind: keyof typeof REFUND_COPY; note: string | null; link: string }) {
  const c = REFUND_COPY[r.kind];
  const html = layout(
    c.title,
    `${p(`Hi ${esc(r.name)}, ${esc(c.line)}`)}${facts([
      ['Event', r.event],
      ['Registration', r.code],
      ['Amount', r.amount],
      ...(r.note ? [['Note', r.note] as [string, string]] : []),
    ])}${button(r.link, 'View registration')}`,
  );
  return { subject: `${c.title}: ${r.event} (${r.amount})`, html, text: `${c.line}\n\nEvent: ${r.event}\nRegistration: ${r.code}\nAmount: ${r.amount}${r.note ? `\nNote: ${r.note}` : ''}\n\n${r.link}` };
}
