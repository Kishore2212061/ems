import { HttpStatus, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'node:crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AppException, Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { env } from '../config/env';
import { GLOBAL_EVENT_MODEL, GlobalEvent } from '../global-events/global-event.schema';
import { LOCAL_EVENT_MODEL, LocalEvent, VISIBLE_STATUSES } from '../local-events/local-event.schema';
import { MailService } from '../mail/mail.service';
import { registrationCancelledEmail } from '../mail/templates';
import { FeeSettingsService } from '../payments/fee-settings.service';
import { calculateBreakdown } from '../payments/fees';
import { RbacService } from '../rbac/rbac.service';
import { TicketsService } from '../tickets/tickets.service';
import { rupees, whenText } from '../common/format';
import { USER_MODEL, User } from '../users/user.schema';
import {
  HOLD_MINUTES,
  Member,
  Payment,
  REGISTRATION_LOCK_MODEL,
  REGISTRATION_MODEL,
  REGISTRATION_STATUS,
  Registration,
  RegistrationLock,
  RegistrationStatus,
} from './registration.schema';
import { CODE, type AdminRegistrationQuery, type CreateRegistrationDto } from './registrations.dto';
import { effectiveEnd } from './schedule';

type Id = Types.ObjectId;
type EventRow = Pick<
  LocalEvent,
  | '_id' | 'global_event_id' | 'department_id' | 'name' | 'slug' | 'status' | 'participation' | 'team_min' | 'team_max' | 'pricing'
  | 'price_version' | 'seats_total' | 'seats_held' | 'registration_opens_at' | 'registration_closes_at' | 'starts_at' | 'ends_at' | 'venue' | 'online'
>;
const EVENT_FIELDS =
  '_id global_event_id department_id name slug status participation team_min team_max pricing price_version seats_total seats_held registration_opens_at registration_closes_at starts_at ends_at venue online';
/** What a registration card shows about its event (fetched with one $in, so it's always current). */
const CARD_EVENT_FIELDS = '_id global_event_id slug name category starts_at ends_at venue online status department_code banner_url';

/** Registrations sit inside an event, which sits in a department and a fest: roles at any level reach them. */
const REG_SCOPE = { globalEventId: 'global_event_id', departmentId: 'department_id', localEventId: 'local_event_id' } as const;
const EVENT_SCOPE = { globalEventId: 'global_event_id', departmentId: 'department_id', localEventId: '_id' } as const;

const SWEEP_EVERY_MS = 30_000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: read aloud at a desk
const newCode = () => `REG-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')}`;


/** Thrown inside the transaction when the seat update matched nothing (full, or no longer open). */
class NoSeat extends Error {}

interface Me {
  _id: Id;
  email: string;
  full_name: string;
  phone?: string;
  college?: string;
  status: string;
}

@Injectable()
export class RegistrationsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Registrations');
  private sweeper?: NodeJS.Timeout;
  /** userId → email. Emails never change, so entries never go stale; bounded so memory can't grow. */
  private readonly emails = new Map<string, string>();

  constructor(
    @InjectModel(REGISTRATION_MODEL) private readonly regs: Model<Registration>,
    @InjectModel(REGISTRATION_LOCK_MODEL) private readonly locks: Model<RegistrationLock>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(GLOBAL_EVENT_MODEL) private readonly fests: Model<GlobalEvent>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectConnection() private readonly conn: Connection,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly fees: FeeSettingsService,
    private readonly tickets: TicketsService,
  ) {}

  // ── hold sweeper ──────────────────────────────────────────────────────────

  onApplicationBootstrap() {
    if (!env.JOBS_ENABLED) return;
    this.sweeper = setInterval(() => void this.releaseExpired().catch((e) => this.logger.error(`sweep failed: ${(e as Error).message}`)), SWEEP_EVERY_MS);
  }

  onApplicationShutdown() {
    clearInterval(this.sweeper);
  }

  /**
   * Gives back the seats of online-pay holds that ran out (batches of 100 on the `pending_holds`
   * index). Each release is a conditional update, so two sweepers (or a sweep racing a payment)
   * release a hold at most once. Returns how many were released.
   */
  async releaseExpired(scope: { local_event_id?: Id } = {}, now = new Date()): Promise<number> {
    const due = await this.regs
      .find({ status: 'PAYMENT_PENDING', hold_expires_at: { $lt: now }, ...scope })
      .select('_id')
      .limit(100)
      .lean();
    let released = 0;
    for (const r of due) {
      const ended = await this.inTransaction((session) => this.end({ _id: r._id, status: 'PAYMENT_PENDING', hold_expires_at: { $lt: now } }, { status: 'EXPIRED' }, session));
      if (ended) released++;
    }
    if (released) this.logger.log(`released ${released} expired hold(s)`);
    return released;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.conn.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Ends an active registration (cancel / expire) and returns its seat, in the caller's transaction.
   * Conditional on `active`, so it happens once. Returns the registration as it was, or null.
   */
  private async end(filter: Record<string, unknown>, set: Partial<Registration>, session: ClientSession) {
    const before = await this.regs
      .findOneAndUpdate({ ...filter, active: true }, { $set: { ...set, active: false, hold_expires_at: null }, $inc: { version: 1 } }, { session })
      .lean();
    if (!before) return null;
    const counter = before.status === 'PAYMENT_PENDING' ? 'seats_held' : 'seats_confirmed';
    await this.events.updateOne({ _id: before.local_event_id }, { $inc: { [counter]: -1 } }, { session });
    await this.tickets.voidRegistration(before._id, set.status === 'EXPIRED' ? 'Seat hold expired' : 'Registration cancelled', session);
    return before;
  }

  private async me(userId: string): Promise<Me> {
    const u = await this.users.findById(userId).select('_id email full_name phone college status').lean<Me>();
    if (!u) throw Errors.unauthorized();
    this.remember(userId, u.email);
    return u;
  }

  private remember(userId: string, email: string) {
    if (this.emails.size >= 10_000) this.emails.clear();
    this.emails.set(userId, email);
  }

  private async emailOf(userId: string) {
    return this.emails.get(userId) ?? (await this.me(userId)).email;
  }

  // ── register ──────────────────────────────────────────────────────────────

  private assertOpen(ev: EventRow, fest: Pick<GlobalEvent, 'status'> | null, now: Date) {
    if (fest?.status !== 'PUBLISHED' || ev.status !== 'PUBLISHED') {
      const paused = fest?.status === 'SUSPENDED' || ev.status === 'SUSPENDED';
      throw paused
        ? Errors.forbidden('REGISTRATION_PAUSED', 'Registrations for this event are paused. Check back later.')
        : Errors.forbidden('REGISTRATION_CLOSED', 'Registrations for this event are closed');
    }
    if (ev.registration_opens_at && now < ev.registration_opens_at) {
      throw new AppException(HttpStatus.FORBIDDEN, 'REGISTRATION_NOT_OPEN', `Registrations open on ${whenText(ev.registration_opens_at, null)}`, { opensAt: ev.registration_opens_at });
    }
    const closes = ev.registration_closes_at ?? ev.starts_at;
    if (!closes || now >= closes) throw Errors.forbidden('REGISTRATION_CLOSED', 'Registrations for this event are closed');
  }

  /** Leader (the signed-in person) + teammates, with size and duplicate checks. */
  private team(ev: EventRow, me: Me, dto: CreateRegistrationDto): Member[] {
    const leader: Member = { name: me.full_name, email: me.email, phone: me.phone ?? null, college: me.college ?? null, leader: true };
    const mates: Member[] = dto.teammates.map((m) => ({ name: m.name, email: m.email, phone: m.phone, college: null, leader: false }));
    if (ev.participation === 'INDIVIDUAL' && mates.length) throw Errors.badRequest('TEAM_SIZE', 'This is a solo event: register just yourself');
    const size = mates.length + 1;
    if (size < ev.team_min || size > ev.team_max) {
      const range = ev.team_min === ev.team_max ? `${ev.team_max}` : `${ev.team_min}–${ev.team_max}`;
      throw Errors.badRequest('TEAM_SIZE', `Teams need ${range} members including you (you have ${size})`, { min: ev.team_min, max: ev.team_max });
    }
    const seen = new Set([leader.email]);
    mates.forEach((m, i) => {
      if (seen.has(m.email)) {
        const msg = m.email === leader.email ? "That's you: you're already in the team as leader" : 'Already in this team';
        throw Errors.badRequest('DUPLICATE_MEMBER', `${m.email} is in the team twice`, { email: m.email, fields: { [`teammates.${i}.email`]: msg } });
      }
      seen.add(m.email);
    });
    return [leader, ...mates];
  }

  private async payment(ev: EventRow, size: number, chosen: CreateRegistrationDto['paymentMode']): Promise<Payment> {
    if (ev.pricing.type === 'FREE') return { mode: 'NONE', status: 'NOT_REQUIRED', amount_paise: 0, price_version: ev.price_version };
    const modes = ev.pricing.modes;
    const mode = chosen ?? (modes.length === 1 ? modes[0] : undefined);
    if (!mode || !modes.includes(mode)) {
      const msg = modes.length > 1 ? 'Choose how you will pay' : `This event is paid ${modes[0] === 'ONLINE' ? 'online' : 'at the registration desk'}`;
      throw Errors.validation({ fields: { paymentMode: msg } });
    }
    const base = ev.pricing.amount_paise * (ev.pricing.per === 'MEMBER' ? size : 1);
    const breakdown = calculateBreakdown({ basePaise: base, online: mode === 'ONLINE', settings: await this.fees.get() });
    return { mode, status: mode === 'ONLINE' ? 'PENDING' : 'DUE', amount_paise: breakdown.totalPaise, breakdown, price_version: ev.price_version };
  }

  /**
   * Register the signed-in person (as leader) and their teammates.
   *
   * One transaction: lock each person → clash/duplicate check → take a seat (atomic, capacity
   * guarded with $expr) → insert. Free and pay-at-desk entries are confirmed at once; online-pay
   * entries hold the seat for HOLD_MINUTES. Retries with the same Idempotency-Key return the first
   * result without touching seats.
   */
  async create(user: AuthUser, dto: CreateRegistrationDto, key: string) {
    const leaderId = new Types.ObjectId(user.id);
    const replay = await this.regs.findOne({ leader_user_id: leaderId, idempotency_key: key }).lean();
    if (replay) return this.view(replay, await this.emailOf(user.id));

    const [me, ev] = await Promise.all([this.me(user.id), this.events.findById(dto.eventId).select(EVENT_FIELDS).lean<EventRow>()]);
    if (!ev || !VISIBLE_STATUSES.includes(ev.status)) throw Errors.notFound('Event');
    const fest = await this.fests.findById(ev.global_event_id).select('_id slug name status').lean();
    const now = new Date();
    this.assertOpen(ev, fest, now);

    const members = this.team(ev, me, dto);
    const payment = await this.payment(ev, members.length, dto.paymentMode);
    const status: RegistrationStatus = payment.status === 'PENDING' ? 'PAYMENT_PENDING' : 'CONFIRMED';
    const start = ev.starts_at!;
    const end = effectiveEnd(start, ev.ends_at);
    const emails = members.map((m) => m.email);

    const seatFilter: Record<string, unknown> = { _id: ev._id, status: 'PUBLISHED' };
    if (ev.seats_total != null) seatFilter.$expr = { $lt: [{ $add: ['$seats_confirmed', '$seats_held'] }, '$seats_total'] };

    for (let attempt = 0; ; attempt++) {
      try {
        const out = await this.inTransaction(async (session) => {
          const at = new Date();
          // 1. Serialise per person (write conflict → the driver retries → step 2 sees the winner).
          await this.locks.bulkWrite(
            emails.map((e) => ({ updateOne: { filter: { _id: e }, update: { $inc: { n: 1 }, $set: { at } }, upsert: true } })),
            { session, ordered: false },
          );
          // 2. Anyone in the team already busy in this window (this event included: it overlaps itself)?
          const busy = await this.regs
            .find({ 'members.email': { $in: emails }, starts_at: { $lt: end }, ends_at: { $gt: start }, active: true })
            .select('code local_event_id leader_user_id idempotency_key starts_at ends_at members.email')
            .limit(10)
            .session(session)
            .lean();
          const mine = busy.find((b) => b.idempotency_key === key && b.leader_user_id.equals(leaderId));
          if (mine) return { reg: (await this.regs.findById(mine._id).session(session).lean())!, replay: true };
          if (busy.length) throw await this.clashError(busy, emails, ev._id, session);
          // 3. Seat: atomic and capacity-guarded, so concurrent requests can never oversell.
          const seat = await this.events.updateOne(seatFilter, { $inc: { [status === 'CONFIRMED' ? 'seats_confirmed' : 'seats_held']: 1 } }, { session });
          if (seat.modifiedCount !== 1) throw new NoSeat();
          // 4. The registration itself.
          const [doc] = await this.regs.create(
            [
              {
                code: newCode(),
                global_event_id: ev.global_event_id,
                local_event_id: ev._id,
                department_id: ev.department_id,
                starts_at: start,
                ends_at: end,
                leader_user_id: leaderId,
                team_name: ev.participation === 'TEAM' ? dto.teamName : null,
                members,
                status,
                active: true,
                payment,
                hold_expires_at: status === 'PAYMENT_PENDING' ? new Date(at.getTime() + HOLD_MINUTES * 60_000) : null,
                idempotency_key: key,
              },
            ],
            { session },
          );
          const reg = doc.toObject() as Registration;
          // Confirmed now (free / pay at desk): tickets + QR emails in the same transaction.
          if (status === 'CONFIRMED') await this.tickets.issue(reg, 'confirmed', session);
          return { reg, replay: false };
        });
        return this.view(out.reg, me.email);
      } catch (e: any) {
        if (e instanceof NoSeat) {
          const now2 = await this.events.findById(ev._id).select('status seats_held').lean();
          if (now2?.status !== 'PUBLISHED') this.assertOpen({ ...ev, status: now2?.status ?? 'CANCELLED' }, fest, new Date());
          // Lazy safety: holds that ran out but weren't swept yet shouldn't make an event look full.
          if (attempt === 0 && (now2?.seats_held ?? 0) > 0 && (await this.releaseExpired({ local_event_id: ev._id })) > 0) continue;
          throw Errors.conflict('SEATS_UNAVAILABLE', 'Sorry, this event just filled up');
        }
        if (e?.code === 11000) {
          const index = Object.keys(e.keyPattern ?? {});
          if (index.includes('idempotency_key')) {
            const first = await this.regs.findOne({ leader_user_id: leaderId, idempotency_key: key }).lean();
            if (first) return this.view(first, me.email);
          }
          if (index.includes('members.email')) throw Errors.conflict('MEMBER_ALREADY_REGISTERED', 'Someone in this team just registered for this event');
          if (attempt < 3) continue; // registration code or lock upsert collided: try again
        }
        throw e;
      }
    }
  }

  /** "Already registered" beats "time clash"; for teammates the other event isn't named (it's their business). */
  private async clashError(busy: Pick<Registration, 'code' | 'local_event_id' | 'members' | 'starts_at' | 'ends_at'>[], emails: string[], eventId: Id, session: ClientSession) {
    const same = busy.find((b) => b.local_event_id.equals(eventId));
    const hit = same ?? busy[0];
    const email = emails.find((e) => hit.members.some((m) => m.email === e))!;
    const i = emails.indexOf(email);
    const self = i === 0;
    const fields = self ? undefined : { [`teammates.${i - 1}.email`]: same ? 'Already registered for this event' : 'Busy with another event at this time' };
    if (same) {
      return Errors.conflict('MEMBER_ALREADY_REGISTERED', self ? "You're already registered for this event" : `${email} is already registered for this event`, {
        email,
        self,
        ...(self && { code: hit.code }),
        fields,
      });
    }
    if (!self) return Errors.conflict('TIME_CLASH', `${email} is registered for another event at this time`, { email, self, fields });
    const other = await this.events.findById(hit.local_event_id).select('name slug').session(session).lean();
    return Errors.conflict('TIME_CLASH', `This clashes with ${other?.name ?? 'another event'}, which you're registered for (${whenText(hit.starts_at, hit.ends_at)})`, {
      email,
      self,
      code: hit.code,
      event: { name: other?.name ?? null, startsAt: hit.starts_at, endsAt: hit.ends_at },
    });
  }

  /**
   * Online payment arrived (called inside the payments transaction). The held seat becomes a
   * confirmed one. If the hold ran out meanwhile, the seat is taken again when one is free and
   * nobody in the team got busy at that time; otherwise seated=false (the caller refunds).
   */
  async confirmPaid(regId: Id, session: ClientSession): Promise<{ reg: Registration | null; seated: boolean }> {
    const held = await this.regs
      .findOneAndUpdate(
        { _id: regId, status: 'PAYMENT_PENDING', active: true },
        { $set: { status: 'CONFIRMED', 'payment.status': 'PAID', hold_expires_at: null }, $inc: { version: 1 } },
        { new: true, session },
      )
      .lean();
    if (held) {
      await this.events.updateOne({ _id: held.local_event_id }, { $inc: { seats_held: -1, seats_confirmed: 1 } }, { session });
      await this.tickets.issue(held, 'paid', session);
      return { reg: held, seated: true };
    }
    const r = await this.regs.findById(regId).session(session).lean();
    if (!r) return { reg: null, seated: false };
    if (r.status === 'CONFIRMED' && r.payment.status === 'PAID') return { reg: r, seated: true };
    if (r.status !== 'EXPIRED') return { reg: r, seated: false };

    const emails = r.members.map((m) => m.email);
    const at = new Date();
    await this.locks.bulkWrite(emails.map((e) => ({ updateOne: { filter: { _id: e }, update: { $inc: { n: 1 }, $set: { at } }, upsert: true } })), { session, ordered: false });
    const busy = await this.regs
      .find({ 'members.email': { $in: emails }, starts_at: { $lt: r.ends_at }, ends_at: { $gt: r.starts_at }, active: true, _id: { $ne: r._id } })
      .select('_id')
      .limit(1)
      .session(session)
      .lean();
    if (busy.length) return { reg: r, seated: false };
    const ev = await this.events.findById(r.local_event_id).select('seats_total').session(session).lean();
    const seatFilter: Record<string, unknown> = { _id: r.local_event_id, status: 'PUBLISHED' };
    if (ev?.seats_total != null) seatFilter.$expr = { $lt: [{ $add: ['$seats_confirmed', '$seats_held'] }, '$seats_total'] };
    const seat = await this.events.updateOne(seatFilter, { $inc: { seats_confirmed: 1 } }, { session });
    if (seat.modifiedCount !== 1) return { reg: r, seated: false };
    const after = (await this.regs
      .findOneAndUpdate(
        { _id: r._id, status: 'EXPIRED' },
        { $set: { status: 'CONFIRMED', active: true, 'payment.status': 'PAID', hold_expires_at: null }, $inc: { version: 1 } },
        { new: true, session },
      )
      .lean())!;
    await this.tickets.issue(after, 'paid', session);
    return { reg: after, seated: true };
  }

  // ── participant reads ─────────────────────────────────────────────────────

  /** Shape for the person's own view; event + fest come from one $in each, so they're always current. */
  private async views(rows: Registration[], email: string) {
    const eventIds = [...new Set(rows.map((r) => String(r.local_event_id)))].map((id) => new Types.ObjectId(id));
    const festIds = [...new Set(rows.map((r) => String(r.global_event_id)))].map((id) => new Types.ObjectId(id));
    const [events, fests] = await Promise.all([
      eventIds.length ? this.events.find({ _id: { $in: eventIds } }).select(CARD_EVENT_FIELDS).lean() : [],
      festIds.length ? this.fests.find({ _id: { $in: festIds } }).select('_id slug name status').lean() : [],
    ]);
    const ev = new Map(events.map((e) => [String(e._id), e]));
    const fe = new Map(fests.map((f) => [String(f._id), f]));
    return rows.map((r) => toView(r, email, ev.get(String(r.local_event_id)), fe.get(String(r.global_event_id))));
  }

  /** One registration, with the viewer's own ticket (QR) when there is one. */
  private async view(r: Registration, email: string) {
    const [v, ticket] = await Promise.all([this.views([r], email).then((x) => x[0]), this.tickets.forMember(r._id, email)]);
    return { ...v, ticket };
  }

  /** Everything the person is part of (as leader or teammate), in time order. Bounded. */
  async mine(user: AuthUser) {
    const email = await this.emailOf(user.id);
    const rows = await this.regs.find({ 'members.email': email }).sort({ starts_at: 1 }).limit(200).lean();
    return { items: await this.views(rows, email) };
  }

  async getMine(user: AuthUser, code: string) {
    const email = await this.emailOf(user.id);
    const r = CODE.test(code) ? await this.regs.findOne({ code, 'members.email': email }).lean() : null;
    if (!r) throw Errors.notFound('Registration');
    return this.view(r, email);
  }

  // ── cancel ────────────────────────────────────────────────────────────────

  private assertCancellable(r: Registration, byStaff: boolean) {
    if (!r.active) throw Errors.conflict('NOT_ACTIVE', `This registration is already ${r.status === 'EXPIRED' ? 'expired' : r.status === 'CANCELLED' ? 'cancelled' : 'closed'}`);
    if (r.payment.status === 'PAID') throw Errors.conflict('REFUND_REQUIRED', 'This entry is paid: cancelling it needs a refund, which opens soon');
    if (!byStaff && r.starts_at <= new Date()) throw Errors.conflict('EVENT_STARTED', 'The event has started, so this registration can no longer be cancelled');
  }

  private async cancel(r: Registration, actor: { id: string; name: string; staff: boolean }, reason: string | null, ip: string) {
    this.assertCancellable(r, actor.staff);
    const ended = await this.inTransaction(async (session) => {
      const before = await this.end(
        { _id: r._id, status: { $in: ['PAYMENT_PENDING', 'CONFIRMED'] }, 'payment.status': { $ne: 'PAID' } },
        { status: 'CANCELLED', cancel_reason: reason, cancelled_by: new Types.ObjectId(actor.id), cancelled_at: new Date() },
        session,
      );
      if (!before) return null;
      const event = await this.events.findById(r.local_event_id).select('name').session(session).lean();
      const notify = before.members.filter((m) => actor.staff || !m.leader);
      for (const m of notify) {
        await this.mail.dispatch(
          { to: m.email, ...registrationCancelledEmail({ name: m.name, event: event?.name ?? 'the event', code: r.code, by: actor.staff ? 'the organisers' : actor.name, reason, link: `${env.WEB_BASE_URL}/` }) },
          { session },
        );
      }
      await this.audit.record(
        { actorId: actor.id, action: 'registration.cancelled', entity: 'registration', entityId: r._id, before: { status: before.status }, after: { status: 'CANCELLED', reason }, meta: { code: r.code, staff: actor.staff }, ip },
        session,
      );
      return before;
    });
    if (!ended) throw Errors.conflict('NOT_ACTIVE', 'This registration was already cancelled');
    return (await this.regs.findById(r._id).lean())!;
  }

  /** Only the leader cancels (they registered the team); teammates are told so instead of "not found". */
  async cancelMine(user: AuthUser, code: string, reason: string | null, ip: string) {
    const me = await this.me(user.id);
    const r = CODE.test(code) ? await this.regs.findOne({ code, 'members.email': me.email }).lean() : null;
    if (!r) throw Errors.notFound('Registration');
    if (!r.leader_user_id.equals(me._id)) throw Errors.forbidden('LEADER_ONLY', 'Only the team leader can cancel this registration');
    return this.view(await this.cancel(r, { id: user.id, name: me.full_name, staff: false }, reason, ip), me.email);
  }

  // ── organisers ────────────────────────────────────────────────────────────

  async adminList(user: AuthUser, eventId: Id, q: AdminRegistrationQuery) {
    const ev = await this.events
      .findOne(this.rbac.withScope({ _id: eventId }, this.rbac.scopeFilter(user, 'registration.read', EVENT_SCOPE)))
      .select('_id name seats_total seats_confirmed seats_held')
      .lean();
    if (!ev) throw Errors.notFound('Event');

    const filter: Record<string, unknown> = { local_event_id: eventId, status: q.status ?? { $in: REGISTRATION_STATUS } };
    const term = q.q?.trim();
    if (term) {
      if (CODE.test(term.toUpperCase())) filter.code = term.toUpperCase();
      else if (term.includes('@')) filter['members.email'] = term.toLowerCase();
      else return { items: [], nextCursor: null, hint: 'Search by registration code (REG-…) or an exact email' };
    }
    if (q.cursor) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    const [rows, counts] = await Promise.all([
      this.regs.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean(),
      q.cursor || term
        ? undefined
        : this.regs.aggregate<{ _id: RegistrationStatus; n: number; people: number }>([
            { $match: { local_event_id: eventId } },
            { $group: { _id: '$status', n: { $sum: 1 }, people: { $sum: { $size: '$members' } } } },
          ]),
    ]);
    const items = rows.slice(0, q.limit);
    return {
      items: items.map(toAdminView),
      nextCursor: rows.length > q.limit ? String(items[items.length - 1]._id) : null,
      ...(counts && {
        counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) as Partial<Record<RegistrationStatus, number>>,
        people: counts.filter((c) => c._id === 'CONFIRMED' || c._id === 'PAYMENT_PENDING').reduce((s, c) => s + c.people, 0),
        seats: { total: ev.seats_total, confirmed: ev.seats_confirmed, held: ev.seats_held },
      }),
    };
  }

  private async loadScoped(user: AuthUser, code: string, perm: 'registration.read' | 'registration.manage') {
    const r = CODE.test(code) ? await this.regs.findOne(this.rbac.withScope({ code }, this.rbac.scopeFilter(user, perm, REG_SCOPE))).lean() : null;
    if (!r) throw Errors.notFound('Registration');
    return r;
  }

  async adminGet(user: AuthUser, code: string) {
    return toAdminView(await this.loadScoped(user, code, 'registration.read'));
  }

  async adminCancel(user: AuthUser, code: string, reason: string, ip: string) {
    const r = await this.loadScoped(user, code, 'registration.manage');
    const me = await this.me(user.id);
    return toAdminView(await this.cancel(r, { id: user.id, name: me.full_name, staff: true }, reason, ip));
  }
}

type CardEvent = Pick<LocalEvent, '_id' | 'slug' | 'name' | 'category' | 'starts_at' | 'ends_at' | 'venue' | 'online' | 'status' | 'department_code' | 'banner_url'>;

function toView(r: Registration, email: string, e?: CardEvent, f?: Pick<GlobalEvent, 'slug' | 'name' | 'status'>) {
  return {
    code: r.code,
    status: r.status,
    role: r.members.find((m) => m.leader)?.email === email ? ('LEADER' as const) : ('MEMBER' as const),
    eventId: String(r.local_event_id),
    /** The window used for clash checks (an event without an end time is assumed to last 2 h). */
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    teamName: r.team_name ?? null,
    members: r.members.map((m) => ({ name: m.name, email: m.email, leader: m.leader })),
    payment: { mode: r.payment.mode, status: r.payment.status, amountPaise: r.payment.amount_paise, breakdown: r.payment.breakdown ?? null },
    holdExpiresAt: r.hold_expires_at ?? null,
    cancelReason: r.cancel_reason ?? null,
    cancelledAt: r.cancelled_at ?? null,
    createdAt: r.created_at,
    event: e
      ? {
          id: String(e._id),
          slug: e.slug,
          name: e.name,
          category: e.category,
          startsAt: e.starts_at,
          endsAt: e.ends_at,
          venue: e.venue,
          online: e.online,
          status: e.status,
          departmentCode: e.department_code,
          bannerUrl: e.banner_url,
        }
      : null,
    fest: f ? { slug: f.slug, name: f.name, status: f.status } : null,
  };
}

function toAdminView(r: Registration) {
  return {
    id: String(r._id),
    code: r.code,
    status: r.status,
    eventId: String(r.local_event_id),
    teamName: r.team_name ?? null,
    members: r.members.map((m) => ({ name: m.name, email: m.email, phone: m.phone ?? null, college: m.college ?? null, leader: m.leader })),
    payment: { mode: r.payment.mode, status: r.payment.status, amountPaise: r.payment.amount_paise, breakdown: r.payment.breakdown ?? null },
    holdExpiresAt: r.hold_expires_at ?? null,
    cancelReason: r.cancel_reason ?? null,
    cancelledAt: r.cancelled_at ?? null,
    createdAt: r.created_at,
  };
}
