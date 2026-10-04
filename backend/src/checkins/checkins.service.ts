import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema, Types } from 'mongoose';
import { Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { rupees, whenText } from '../common/format';
import { env } from '../config/env';
import { GLOBAL_EVENT_MODEL, GlobalEvent } from '../global-events/global-event.schema';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { ORDER_MODEL, Order } from '../payments/order.schema';
import { RbacService } from '../rbac/rbac.service';
import { REGISTRATION_MODEL, Registration } from '../registrations/registration.schema';
import { parseTicketToken, verifyTicketToken } from '../tickets/qr';
import { TICKET_MODEL, Ticket } from '../tickets/ticket.schema';
import { TICKET_CODE } from '../tickets/tickets.service';

type Id = Types.ObjectId;

/** Stable scan outcomes the scanner switches on. */
export type ScanResult = 'OK' | 'PAYMENT_DUE' | 'ALREADY_USED' | 'WRONG_EVENT' | 'INVALID_TICKET' | 'VOID_TICKET' | 'NOT_YET_OPEN';

export interface CheckIn {
  _id: Id;
  ticket_id: Id | null;
  ticket_code: string | null;
  local_event_id: Id;
  operator_id: Id;
  device_id: string | null;
  result: ScanResult;
  scanned_at: Date;
}
export const CHECK_IN_MODEL = 'CheckIn';
export const CheckInSchema = new Schema<CheckIn>(
  {
    ticket_id: { type: Schema.Types.ObjectId, default: null },
    ticket_code: { type: String, default: null },
    local_event_id: { type: Schema.Types.ObjectId, required: true },
    operator_id: { type: Schema.Types.ObjectId, required: true },
    device_id: { type: String, default: null },
    result: { type: String, required: true },
    scanned_at: { type: Date, default: () => new Date() },
  },
  { collection: 'check_ins', versionKey: false },
);
// Gate log per event (newest first) and per operator (shift summary).
CheckInSchema.index({ local_event_id: 1, scanned_at: -1 });
CheckInSchema.index({ operator_id: 1, scanned_at: -1 });

const EVENT_SCOPE = { globalEventId: 'global_event_id', departmentId: 'department_id', localEventId: '_id' } as const;
const LIVE_EVENT = ['PUBLISHED', 'SUSPENDED', 'COMPLETED'];

/**
 * Gate check-in. A scan is one signature check (in memory) + one conditional update
 * (ACTIVE → USED, so two phones scanning the same QR can't both admit) + one log insert.
 */
@Injectable()
export class CheckinsService {
  constructor(
    @InjectModel(CHECK_IN_MODEL) private readonly log: Model<CheckIn>,
    @InjectModel(TICKET_MODEL) private readonly tickets: Model<Ticket>,
    @InjectModel(REGISTRATION_MODEL) private readonly regs: Model<Registration>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    @InjectModel(ORDER_MODEL) private readonly orders: Model<Order>,
    private readonly rbac: RbacService,
  ) {}

  /** The event, if the operator may run its gate (scanner for the fest, or an admin of it). */
  private async gate(user: AuthUser, eventId: Id) {
    const ev = await this.events
      .findOne(this.rbac.withScope({ _id: eventId, status: { $in: LIVE_EVENT } }, this.rbac.scopeFilter(user, 'checkin.scan', EVENT_SCOPE)))
      .select('_id name starts_at ends_at venue global_event_id department_id')
      .lean();
    if (!ev) throw Errors.notFound('Event');
    return ev;
  }

  /** Events this operator can check people into, grouped by fest, with live counts. */
  async gateEvents(user: AuthUser) {
    const scope = this.rbac.scopeFilter(user, 'checkin.scan', EVENT_SCOPE);
    const fests = await this.fests.find({ status: { $in: ['PUBLISHED', 'SUSPENDED'] } }).select('_id name slug starts_at').sort({ starts_at: 1 }).limit(20).lean();
    if (!fests.length) return { fests: [] };
    const rows = await this.events
      .find(this.rbac.withScope({ global_event_id: { $in: fests.map((f) => f._id) }, status: { $in: ['PUBLISHED', 'SUSPENDED'] } }, scope))
      .sort({ starts_at: 1, _id: 1 })
      .select('_id global_event_id name starts_at ends_at venue department_code')
      .limit(500)
      .lean();
    const counts = await this.tickets.aggregate<{ _id: { e: Id; s: string }; n: number }>([
      { $match: { local_event_id: { $in: rows.map((r) => r._id) } } },
      { $group: { _id: { e: '$local_event_id', s: '$status' }, n: { $sum: 1 } } },
    ]);
    const c = new Map<string, Record<string, number>>();
    for (const x of counts) c.set(String(x._id.e), { ...(c.get(String(x._id.e)) ?? {}), [x._id.s]: x.n });
    return {
      fests: fests
        .map((f) => ({
          id: String(f._id),
          name: f.name,
          events: rows
            .filter((r) => r.global_event_id.equals(f._id))
            .map((r) => {
              const k = c.get(String(r._id)) ?? {};
              return {
                id: String(r._id),
                name: r.name,
                startsAt: r.starts_at,
                endsAt: r.ends_at,
                venue: r.venue,
                departmentCode: r.department_code,
                checkedIn: k.USED ?? 0,
                expected: (k.USED ?? 0) + (k.ACTIVE ?? 0) + (k.PAYMENT_PENDING ?? 0),
              };
            }),
        }))
        .filter((f) => f.events.length),
    };
  }

  /**
   * Scan a QR (or a ticket code typed by hand). Never throws for a bad ticket: the result code says
   * what happened, so the gate shows a clear screen instead of an error.
   */
  async scan(user: AuthUser, eventId: Id, input: { qr?: string; code?: string; deviceId?: string }) {
    const ev = await this.gate(user, eventId);
    const operator = new Types.ObjectId(user.id);
    const record = (result: ScanResult, t?: Pick<Ticket, '_id' | 'code'> | null) =>
      this.log.create({ ticket_id: t?._id ?? null, ticket_code: t?.code ?? null, local_event_id: ev._id, operator_id: operator, device_id: input.deviceId ?? null, result });

    const parsed = input.qr ? parseTicketToken(input.qr) : null;
    const code = parsed?.code ?? input.code?.trim().toUpperCase();
    const t = code && TICKET_CODE.test(code) ? await this.tickets.findOne({ code }).lean() : null;
    if (!t || (input.qr && !verifyTicketToken(input.qr, t))) {
      await record('INVALID_TICKET', t);
      return { result: 'INVALID_TICKET' as const, message: input.qr ? 'This QR is not a valid ticket' : 'No ticket with that code' };
    }

    const holder = { name: t.member_name, ticketCode: t.code, registrationCode: t.registration_code, leader: t.leader };
    if (!t.local_event_id.equals(ev._id)) {
      const other = await this.events.findById(t.local_event_id).select('name starts_at').lean();
      await record('WRONG_EVENT', t);
      return { result: 'WRONG_EVENT' as const, holder, message: `This ticket is for ${other?.name ?? 'another event'}${other?.starts_at ? ` (${whenText(other.starts_at, null)})` : ''}` };
    }
    if (t.status === 'VOID') {
      await record('VOID_TICKET', t);
      return { result: 'VOID_TICKET' as const, holder, message: t.void_reason ?? 'This ticket was cancelled' };
    }
    const opens = ev.starts_at ? new Date(ev.starts_at.getTime() - env.CHECKIN_OPEN_BEFORE_MINUTES * 60_000) : null;
    if (opens && new Date() < opens) {
      await record('NOT_YET_OPEN', t);
      return { result: 'NOT_YET_OPEN' as const, holder, opensAt: opens, message: `Check-in opens at ${whenText(opens, null)}` };
    }
    if (t.status === 'PAYMENT_PENDING') {
      const r = await this.regs.findById(t.registration_id).select('payment').lean();
      await record('PAYMENT_DUE', t);
      return { result: 'PAYMENT_DUE' as const, holder, amountPaise: r?.payment.amount_paise ?? 0, message: `Collect ${rupees(r?.payment.amount_paise ?? 0)} for the team, then scan again` };
    }

    const used = await this.tickets
      .findOneAndUpdate({ _id: t._id, status: 'ACTIVE' }, { $set: { status: 'USED', used_at: new Date(), used_by: operator, used_device: input.deviceId ?? null } }, { new: true })
      .lean();
    if (!used) {
      const now = await this.tickets.findById(t._id).select('status used_at used_by').lean();
      if (now?.status === 'USED') {
        await record('ALREADY_USED', t);
        return { result: 'ALREADY_USED' as const, holder, usedAt: now.used_at, message: `Already checked in at ${now.used_at ? whenText(now.used_at, null) : 'an earlier time'}` };
      }
      await record('VOID_TICKET', t);
      return { result: 'VOID_TICKET' as const, holder, message: 'This ticket is no longer valid' };
    }
    await record('OK', t);
    return { result: 'OK' as const, holder, message: `Welcome, ${t.member_name.split(' ')[0]}!` };
  }

  /** Find tickets of this event by ticket/registration code, email or phone (QR won't scan, phone dead…). */
  async lookup(user: AuthUser, eventId: Id, q: string) {
    const ev = await this.gate(user, eventId);
    const term = q.trim();
    let regIds: Id[] | null = null;
    const filter: Record<string, unknown> = { local_event_id: ev._id };
    if (TICKET_CODE.test(term.toUpperCase())) filter.code = term.toUpperCase();
    else if (/^REG-[A-Z0-9]{6}$/i.test(term)) filter.registration_code = term.toUpperCase();
    else if (term.includes('@')) filter.member_email = term.toLowerCase();
    else {
      const phone = term.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
      if (!/^[6-9]\d{9}$/.test(phone)) throw Errors.badRequest('BAD_LOOKUP', 'Enter a ticket code, registration code, email or 10-digit mobile number');
      regIds = (await this.regs.find({ local_event_id: ev._id, status: { $in: ['CONFIRMED'] }, 'members.phone': phone }).select('_id').limit(10).lean()).map((r) => r._id);
      filter.registration_id = { $in: regIds };
    }
    const rows = await this.tickets.find(filter).limit(20).lean();
    return { items: rows.map((t) => ({ code: t.code, holder: t.member_name, status: t.status, registrationCode: t.registration_code, leader: t.leader, usedAt: t.used_at ?? null })) };
  }

  /** Gate dashboard: event totals + this operator's shift (scans, admissions, cash taken today). */
  async summary(user: AuthUser, eventId: Id) {
    const ev = await this.gate(user, eventId);
    const operator = new Types.ObjectId(user.id);
    const dayStart = new Date(Date.now() - ((Date.now() + 5.5 * 3_600_000) % 86_400_000)); // midnight IST
    const [counts, mine, cash] = await Promise.all([
      this.tickets.aggregate<{ _id: string; n: number }>([{ $match: { local_event_id: ev._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.log.aggregate<{ _id: string; n: number }>([{ $match: { operator_id: operator, scanned_at: { $gte: dayStart } } }, { $group: { _id: '$result', n: { $sum: 1 } } }]),
      this.orders.aggregate<{ paise: number; n: number }>([
        { $match: { collected_by: operator, status: 'PAID', paid_at: { $gte: dayStart } } },
        { $group: { _id: null, paise: { $sum: '$amount_paise' }, n: { $sum: 1 } } },
      ]),
    ]);
    const k = Object.fromEntries(counts.map((x) => [x._id, x.n]));
    const m = Object.fromEntries(mine.map((x) => [x._id, x.n]));
    return {
      event: { id: String(ev._id), name: ev.name, startsAt: ev.starts_at, endsAt: ev.ends_at, venue: ev.venue },
      checkedIn: k.USED ?? 0,
      expected: (k.USED ?? 0) + (k.ACTIVE ?? 0) + (k.PAYMENT_PENDING ?? 0),
      paymentDue: k.PAYMENT_PENDING ?? 0,
      shift: { scans: Object.values(m).reduce((s, n) => s + n, 0), admitted: m.OK ?? 0, cashPaise: cash[0]?.paise ?? 0, cashCount: cash[0]?.n ?? 0 },
    };
  }
}
