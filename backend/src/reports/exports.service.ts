import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Readable } from 'node:stream';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../common/decorators';
import { GLOBAL_EVENT_MODEL, GlobalEvent } from '../global-events/global-event.schema';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { RbacService } from '../rbac/rbac.service';
import { REGISTRATION_MODEL, Registration } from '../registrations/registration.schema';
import { TICKET_MODEL, Ticket } from '../tickets/ticket.schema';
import { USER_MODEL, User } from '../users/user.schema';
import { Errors } from '../common/app-exception';
import { REPORT_SCOPE } from './reports.service';

type Id = Types.ObjectId;

/** RFC 4180 cell; leading = + - @ are neutralised so a spreadsheet can't run a cell as a formula. */
export const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (cells: unknown[]) => `${cells.map(csvCell).join(',')}\r\n`;

export const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, '$1***$2');
export const maskPhone = (p: string | null) => (p ? `${p.slice(0, 2)}******${p.slice(-2)}` : '');

const istStamp = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

@Injectable()
export class ExportsService {
  constructor(
    @InjectModel(REGISTRATION_MODEL) private readonly regs: Model<Registration>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    @InjectModel(TICKET_MODEL) private readonly tickets: Model<Ticket>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Registrations of a fest (or one event) as CSV, one row per person, streamed from a cursor with
   * backpressure (memory stays flat for any size). Emails/phones are masked unless the requester
   * may export personal data; the first line says who exported it and when.
   */
  async registrations(user: AuthUser, festId: Id, eventId?: Id) {
    const fest = await this.fests.findById(festId).select('name slug').lean();
    if (!fest) throw Errors.notFound('Fest');
    const filter = this.rbac.withScope({ global_event_id: festId, ...(eventId && { local_event_id: eventId }) }, this.rbac.scopeFilter(user, 'report.read', REPORT_SCOPE));
    const [events, me, used] = await Promise.all([
      this.events.find({ global_event_id: festId }).select('name department_code').lean(),
      this.users.findById(user.id).select('full_name email').lean(),
      this.tickets.find({ global_event_id: festId, status: 'USED', ...(eventId && { local_event_id: eventId }) }).select('registration_id member_email').lean(),
    ]);
    const ev = new Map(events.map((e) => [String(e._id), e]));
    const checkedIn = new Set(used.map((t) => `${t.registration_id}:${t.member_email}`));
    const pii = this.rbac.can(user, 'export.pii', { globalEventId: festId });
    const cursor = this.regs.find(filter).sort({ local_event_id: 1, _id: 1 }).select('code local_event_id status payment team_name members created_at').lean().cursor({ batchSize: 500 });

    async function* lines() {
      yield '﻿'; // Excel opens UTF-8 (₹, Tamil names) correctly
      yield row([`# ${fest!.name} registrations exported by ${me?.full_name ?? 'unknown'} (${me?.email ?? user.id}) on ${istStamp.format(new Date())} IST. ${pii ? 'Contains personal data: handle with care.' : 'Emails and phones masked.'}`]);
      yield row(['Registration', 'Event', 'Department', 'Status', 'Payment', 'Amount (Rs)', 'Team', 'Name', 'Email', 'Phone', 'College', 'Leader', 'Checked in', 'Registered at (IST)']);
      for await (const r of cursor) {
        const e = ev.get(String(r.local_event_id));
        for (const m of r.members) {
          yield row([
            r.code,
            e?.name ?? '',
            e?.department_code ?? 'Fest-wide',
            r.status,
            r.payment.status,
            (r.payment.amount_paise / 100).toFixed(2),
            r.team_name ?? '',
            m.name,
            pii ? m.email : maskEmail(m.email),
            pii ? (m.phone ?? '') : maskPhone(m.phone),
            m.college ?? '',
            m.leader ? 'yes' : '',
            checkedIn.has(`${r._id}:${m.email}`) ? 'yes' : '',
            istStamp.format(r.created_at),
          ]);
        }
      }
    }
    return { filename: `${fest.slug}${eventId ? `-${String(eventId).slice(-6)}` : ''}-registrations.csv`, stream: Readable.from(lines()) };
  }
}
