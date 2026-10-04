import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes, randomInt } from 'node:crypto';
import { ClientSession, Model, Types } from 'mongoose';
import { Errors } from '../common/app-exception';
import { initials, rupees, whenText } from '../common/format';
import { env } from '../config/env';
import { GLOBAL_EVENT_MODEL, GlobalEvent } from '../global-events/global-event.schema';
import { JobsService } from '../jobs/jobs.service';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { MailService } from '../mail/mail.service';
import { registrationEmail } from '../mail/templates';
import { REGISTRATION_MODEL, Registration } from '../registrations/registration.schema';
import { currentKid, qrPng, signTicket } from './qr';
import { TICKET_MODEL, Ticket, TicketStatus } from './ticket.schema';

type Id = Types.ObjectId;
const NOTIFY_JOB = 'tickets.notify';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const newCode = () => `TCK-${pick(4)}-${pick(2)}`;
export const TICKET_CODE = /^TCK-[A-Z0-9]{4}-[A-Z0-9]{2}$/;
const LIVE: TicketStatus[] = ['ACTIVE', 'PAYMENT_PENDING'];

/** What the holder sees (with the signed QR payload only when `withQr`). */
export function toTicketView(t: Ticket, withQr = false) {
  return {
    code: t.code,
    status: t.status,
    registrationCode: t.registration_code,
    holder: t.member_name,
    leader: t.leader,
    issuedAt: t.issued_at,
    usedAt: t.used_at ?? null,
    ...(withQr && t.status !== 'VOID' && { qr: signTicket(t.code, t.jti, t.kid) }),
  };
}

/**
 * Tickets: one per team member, created in the same transaction that confirms the registration
 * (so a confirmed registration always has its tickets). Emails with each member's own QR are
 * rendered by a job (PNG via sharp) and sent once per ticket and reason.
 */
@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(TICKET_MODEL) private readonly tickets: Model<Ticket>,
    @InjectModel(REGISTRATION_MODEL) private readonly regs: Model<Registration>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
  ) {
    jobs.register<{ registrationId: string; reason: string; only?: string }>(NOTIFY_JOB, (p) => this.sendTickets(p.registrationId, p.reason, p.only));
  }

  // ── lifecycle (called inside the registration/payment transactions) ──

  /** Issue missing tickets for a confirmed registration and queue the emails. Idempotent. */
  async issue(r: Registration, reason: 'confirmed' | 'paid', session: ClientSession) {
    const have = new Set((await this.tickets.find({ registration_id: r._id }).select('member_email').session(session).lean()).map((t) => t.member_email));
    const status: TicketStatus = r.payment.status === 'DUE' ? 'PAYMENT_PENDING' : 'ACTIVE';
    const fresh = r.members
      .filter((m) => !have.has(m.email))
      .map((m) => ({
        code: newCode(),
        registration_id: r._id,
        registration_code: r.code,
        member_email: m.email,
        member_name: m.name,
        leader: m.leader,
        global_event_id: r.global_event_id,
        local_event_id: r.local_event_id,
        department_id: r.department_id,
        status,
        jti: randomBytes(9).toString('base64url'),
        kid: currentKid(),
      }));
    if (fresh.length) await this.tickets.insertMany(fresh, { session });
    if (have.size) await this.tickets.updateMany({ registration_id: r._id, status: { $in: LIVE } }, { $set: { status } }, { session });
    await this.jobs.enqueue(NOTIFY_JOB, { registrationId: String(r._id), reason }, { session, idempotencyKey: `tickets:${r._id}:${reason}` });
  }

  /** Desk payment taken: "pay first" tickets become entry passes. */
  activate(registrationId: Id, session: ClientSession) {
    return this.tickets.updateMany({ registration_id: registrationId, status: 'PAYMENT_PENDING' }, { $set: { status: 'ACTIVE' } }, { session });
  }

  voidRegistration(registrationId: Id, reason: string, session?: ClientSession) {
    return this.tickets.updateMany({ registration_id: registrationId, status: { $in: LIVE } }, { $set: { status: 'VOID', void_reason: reason } }, { session });
  }

  // ── emails ──

  /** `only`: one ticket code (a resend), otherwise every member. */
  private async sendTickets(registrationId: string, reason: string, only?: string) {
    const r = await this.regs.findById(registrationId).lean();
    if (!r || r.status !== 'CONFIRMED') return;
    const [ev, fest, tickets] = await Promise.all([
      this.events.findById(r.local_event_id).select('name starts_at ends_at venue online').lean(),
      this.fests.findById(r.global_event_id).select('name').lean(),
      this.tickets.find({ registration_id: r._id, status: { $in: LIVE }, ...(only && { code: only }) }).lean(),
    ]);
    if (!ev || !fest) return;
    const leader = r.members.find((m) => m.leader)!;
    for (const t of tickets) {
      const png = await qrPng(signTicket(t.code, t.jti, t.kid));
      const cid = `qr-${t.code}@ems`;
      const m = registrationEmail({
        name: t.member_name,
        event: ev.name,
        fest: fest.name,
        when: whenText(ev.starts_at!, ev.ends_at),
        where: ev.venue ?? (ev.online ? 'Online' : 'Venue to be announced'),
        code: r.code,
        team: r.team_name,
        members: r.members.map((x) => x.name),
        payment:
          r.payment.status === 'DUE' ? `Pay ${rupees(r.payment.amount_paise)} at the registration desk` : r.payment.status === 'PAID' ? `${rupees(r.payment.amount_paise)} paid` : 'Free',
        link: `${env.WEB_BASE_URL}/my/registrations/${r.code}`,
        ...(!t.leader && { addedBy: leader.name }),
        ticket: { code: t.code, cid, payFirst: t.status === 'PAYMENT_PENDING' },
      });
      await this.mail.dispatch(
        { to: t.member_email, ...m, inline: [{ filename: `${t.code}.png`, content: png.toString('base64'), contentType: 'image/png', cid }] },
        { idempotencyKey: `ticket-mail:${t.code}:${reason}` },
      );
    }
  }

  // ── holder ──

  /** The viewer's own ticket for a registration (with QR), or null. */
  async forMember(registrationId: Id, email: string) {
    const t = await this.tickets.findOne({ registration_id: registrationId, member_email: email }).lean();
    return t ? toTicketView(t, true) : null;
  }

  async mine(email: string) {
    const rows = await this.tickets.find({ member_email: email }).sort({ issued_at: -1 }).limit(200).lean();
    const ids = [...new Set(rows.map((t) => String(t.local_event_id)))].map((id) => new Types.ObjectId(id));
    const events = new Map((await this.events.find({ _id: { $in: ids } }).select('name slug starts_at ends_at venue').lean()).map((e) => [String(e._id), e]));
    return {
      items: rows.map((t) => {
        const e = events.get(String(t.local_event_id));
        return { ...toTicketView(t), event: e ? { name: e.name, slug: e.slug, startsAt: e.starts_at, endsAt: e.ends_at, venue: e.venue } : null };
      }),
    };
  }

  async getMine(email: string, code: string) {
    const t = TICKET_CODE.test(code) ? await this.tickets.findOne({ code, member_email: email }).lean() : null;
    if (!t) throw Errors.notFound('Ticket');
    const [e, f] = await Promise.all([
      this.events.findById(t.local_event_id).select('name slug starts_at ends_at venue online').lean(),
      this.fests.findById(t.global_event_id).select('name slug').lean(),
    ]);
    return {
      ...toTicketView(t, true),
      event: e ? { name: e.name, slug: e.slug, startsAt: e.starts_at, endsAt: e.ends_at, venue: e.venue, online: e.online } : null,
      fest: f ? { name: f.name, slug: f.slug } : null,
    };
  }

  /** Email the ticket again (lost email). Rate-limited at the controller. */
  async resend(email: string, code: string) {
    const t = TICKET_CODE.test(code) ? await this.tickets.findOne({ code, member_email: email, status: { $in: LIVE } }).lean() : null;
    if (!t) throw Errors.notFound('Ticket');
    await this.jobs.enqueue(NOTIFY_JOB, { registrationId: String(t.registration_id), reason: `resend-${Date.now()}`, only: t.code });
    return { sent: true };
  }

  /** Public check (e.g. a volunteer scanning with a normal camera): no personal data beyond initials. */
  async verifyPublic(code: string) {
    const t = TICKET_CODE.test(code) ? await this.tickets.findOne({ code }).select('status member_name local_event_id global_event_id used_at').lean() : null;
    if (!t) throw Errors.notFound('Ticket');
    const [e, f] = await Promise.all([this.events.findById(t.local_event_id).select('name starts_at').lean(), this.fests.findById(t.global_event_id).select('name').lean()]);
    return { code, status: t.status, holder: initials(t.member_name), event: e?.name ?? null, startsAt: e?.starts_at ?? null, fest: f?.name ?? null, usedAt: t.used_at ?? null };
  }
}
