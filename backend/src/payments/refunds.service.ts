import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { rupees } from '../common/format';
import { env } from '../config/env';
import { JobsService } from '../jobs/jobs.service';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { MailService } from '../mail/mail.service';
import { refundEmail } from '../mail/templates';
import { RbacService } from '../rbac/rbac.service';
import { REGISTRATION_MODEL, Registration } from '../registrations/registration.schema';
import { CODE as REG_CODE } from '../registrations/registrations.dto';
import { RegistrationsService } from '../registrations/registrations.service';
import { TICKET_MODEL, Ticket } from '../tickets/ticket.schema';
import { USER_MODEL, User } from '../users/user.schema';
import { StatsService } from '../stats/stats.service';
import { GatewayError, isSimulatedPayment, PAYMENT_GATEWAY, type PaymentGateway } from './gateway';
import { ORDER_MODEL, Order } from './order.schema';
import { REFUND_BATCH_MODEL, REFUND_MODEL, Refund, RefundBatch, RefundSource, RefundStatus } from './refund.schema';

type Id = Types.ObjectId;
export const PROCESS_JOB = 'refunds.process';
export const EVENT_CANCELLED_JOB = 'refunds.event_cancelled';
const SCOPE = { globalEventId: 'global_event_id', departmentId: 'department_id', localEventId: 'local_event_id' } as const;
/** Gateway refunds are spaced to ≤ 5 per second for the whole process (no 429 storms on mass cancels). */
const MIN_GAP_MS = 200;

export function toRefundView(r: Refund) {
  return {
    id: String(r._id),
    registrationCode: r.registration_code,
    orderCode: r.order_code,
    mode: r.mode,
    amountPaise: r.amount_paise,
    source: r.source,
    reason: r.reason,
    status: r.status,
    failure: r.failure,
    note: r.note,
    batchId: r.batch_id ? String(r.batch_id) : null,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Money back. Every refund is a document keyed by the payment it returns (so a retry can never
 * pay out twice) and moves through a small state machine; gateway calls run in jobs, spaced out
 * by a process-wide limiter. Cash payments become "hand back at the desk" items for finance.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Refunds');
  private nextSlot = 0;

  constructor(
    @InjectModel(REFUND_MODEL) private readonly refunds: Model<Refund>,
    @InjectModel(REFUND_BATCH_MODEL) private readonly batches: Model<RefundBatch>,
    @InjectModel(ORDER_MODEL) private readonly orders: Model<Order>,
    @InjectModel(REGISTRATION_MODEL) private readonly regs: Model<Registration>,
    @InjectModel(TICKET_MODEL) private readonly tickets: Model<Ticket>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectConnection() private readonly conn: Connection,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly registrations: RegistrationsService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    private readonly stats: StatsService,
  ) {
    jobs.register<{ refundId: string }>(PROCESS_JOB, (p) => this.process(new Types.ObjectId(p.refundId)));
    jobs.register<{ eventId: string; reason: string; by: string | null }>(EVENT_CANCELLED_JOB, (p) =>
      this.refundCancelledEvent(new Types.ObjectId(p.eventId), p.reason, p.by ? new Types.ObjectId(p.by) : null),
    );
  }

  private async tx<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
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

  private async slot() {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + MIN_GAP_MS;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  /** A refund doc for a paid order (QUEUED online / MANUAL_PENDING for cash), plus its job. Idempotent by key. */
  private async open(order: Order, source: RefundSource, o: { paymentId?: string; amountPaise?: number; reason?: string | null; batchId?: Id | null; status?: RefundStatus; session: ClientSession }) {
    const paymentId = o.paymentId ?? order.gateway_payment_id ?? null;
    const key = order.mode === 'ONLINE' ? `pay:${paymentId}` : `cash:${order.code}`;
    if (await this.refunds.exists({ key }).session(o.session)) return null;
    const status: RefundStatus = o.status ?? (order.mode === 'ONLINE' ? 'QUEUED' : 'MANUAL_PENDING');
    const [r] = await this.refunds.create(
      [
        {
          key,
          order_id: order._id,
          order_code: order.code,
          registration_id: order.registration_id,
          registration_code: order.registration_code,
          global_event_id: order.global_event_id,
          local_event_id: order.local_event_id,
          department_id: order.department_id,
          leader_user_id: order.leader_user_id,
          mode: order.mode,
          payment_id: paymentId,
          amount_paise: o.amountPaise ?? order.amount_paise,
          source,
          reason: o.reason ?? null,
          status,
          batch_id: o.batchId ?? null,
        },
      ],
      { session: o.session },
    );
    if (status === 'QUEUED') await this.jobs.enqueue(PROCESS_JOB, { refundId: String(r._id) }, { session: o.session, idempotencyKey: `refund-job:${r._id}` });
    if (paymentId === order.gateway_payment_id || order.mode === 'OFFLINE') await this.orders.updateOne({ _id: order._id }, { $set: { refund_status: 'PENDING' } }, { session: o.session });
    return r;
  }

  /** From payments: money that arrived with no seat to give, or a second payment for a paid order. */
  autoRefund(order: Order, source: 'LATE_PAYMENT' | 'DUPLICATE_PAYMENT', paymentId: string, amountPaise: number, session: ClientSession) {
    return this.open(order, source, { paymentId, amountPaise, reason: source === 'LATE_PAYMENT' ? 'Paid after the seat hold ran out; no seat left' : 'Paid twice', session });
  }

  // ── the gateway call (job) ──

  async process(id: Id) {
    const r = await this.refunds.findOneAndUpdate({ _id: id, status: { $in: ['QUEUED', 'FAILED'] } }, { $set: { status: 'PROCESSING', failure: null } }, { new: true }).lean();
    if (!r) return; // already done / not ours to run
    // Paid through the simulator (e.g. before the Razorpay keys were set): nothing real to send back.
    if (isSimulatedPayment(r.payment_id) && this.gateway?.name !== 'mock') return this.succeeded(r, `rfnd_sim_${String(r._id)}`);
    if (!this.gateway) throw new Error('payments are not configured');
    await this.slot();
    try {
      const out = await this.gateway.refund(r.payment_id!, r.amount_paise, String(r._id));
      await this.succeeded(r, out.id);
    } catch (e) {
      if (e instanceof GatewayError && e.alreadyRefunded) return this.succeeded(r, r.gateway_refund_id);
      if (e instanceof GatewayError && e.status >= 400) {
        // The gateway refused: retrying now won't help. Pause the batch on low balance so the rest wait.
        const failure = e.insufficientFunds ? 'GATEWAY_INSUFFICIENT_FUNDS' : e.message.slice(0, 200);
        await this.refunds.updateOne({ _id: r._id, status: 'PROCESSING' }, { $set: { status: 'FAILED', failure } });
        if (r.batch_id) {
          await this.batches.updateOne({ _id: r.batch_id }, { $inc: { failed: 1 }, ...(e.insufficientFunds && { $set: { status: 'PAUSED', paused_reason: 'Gateway balance too low for refunds' } }) });
        }
        this.logger.error(`refund ${r._id} failed: ${failure}`);
        return;
      }
      // Network trouble: back to the queue; the job retries with back-off.
      await this.refunds.updateOne({ _id: r._id, status: 'PROCESSING' }, { $set: { status: 'QUEUED' } });
      throw e;
    }
  }

  private async succeeded(r: Refund, gatewayRefundId: string | null) {
    const done = await this.refunds.findOneAndUpdate({ _id: r._id, status: { $ne: 'SUCCEEDED' } }, { $set: { status: 'SUCCEEDED', gateway_refund_id: gatewayRefundId, failure: null } }, { new: true }).lean();
    if (!done) return;
    if (done.payment_id) {
      const ord = await this.orders.findOneAndUpdate({ _id: r.order_id, gateway_payment_id: done.payment_id }, { $set: { refund_status: 'DONE', refund_id: gatewayRefundId } }).lean();
      if (ord) await this.regs.updateOne({ _id: r.registration_id }, { $set: { 'payment.status': 'REFUNDED' } });
    }
    if (r.batch_id) await this.finishBatchStep(r.batch_id, 'succeeded');
    await this.countRefund(done, 1);
    await this.notify(done, 'started');
  }

  private async finishBatchStep(batchId: Id, field: 'succeeded' | 'manual') {
    const b = await this.batches.findOneAndUpdate({ _id: batchId }, { $inc: { [field]: 1 } }, { new: true }).lean();
    if (b && b.succeeded + b.manual >= b.total) await this.batches.updateOne({ _id: batchId, status: { $ne: 'COMPLETED' } }, { $set: { status: 'COMPLETED' } });
  }

  /** refund.processed / refund.failed webhooks. */
  async onGatewayRefund(entity: { id?: string; status?: string; error_description?: string }, event: string) {
    if (!entity?.id) return;
    if (event === 'refund.failed') {
      const r = await this.refunds.findOneAndUpdate({ gateway_refund_id: entity.id, status: 'SUCCEEDED' }, { $set: { status: 'FAILED', failure: entity.error_description ?? 'Refund failed at the bank' } }).lean();
      if (r?.batch_id) await this.batches.updateOne({ _id: r.batch_id }, { $inc: { succeeded: -1, failed: 1 }, $set: { status: 'PAUSED', paused_reason: 'A refund failed at the bank' } });
      if (r) await this.orders.updateOne({ _id: r.order_id }, { $set: { refund_status: 'FAILED' } });
      if (r) await this.countRefund(r, -1);
    } else if (event === 'refund.processed') {
      const r = await this.refunds.findOne({ gateway_refund_id: entity.id }).lean();
      if (r) await this.notify(r, 'done');
    }
  }

  /** Late/duplicate payments were never counted as revenue, so their refunds aren't counted either. */
  private countRefund(r: Refund, sign: 1 | -1) {
    if (r.source !== 'REQUEST' && r.source !== 'EVENT_CANCELLED') return;
    return this.stats.bump(r, { refunds_paise: sign * r.amount_paise });
  }

  private async notify(r: Refund, kind: 'started' | 'done' | 'manual' | 'rejected') {
    const [reg, ev] = await Promise.all([this.regs.findById(r.registration_id).select('members code').lean(), this.events.findById(r.local_event_id).select('name').lean()]);
    const leader = reg?.members.find((m) => m.leader);
    if (!leader) return;
    await this.mail.dispatch(
      {
        to: leader.email,
        ...refundEmail({ name: leader.name, event: ev?.name ?? 'your event', code: r.registration_code, amount: rupees(r.amount_paise), kind, note: r.note, link: `${env.WEB_BASE_URL}/my/registrations/${r.registration_code}` }),
      },
      { idempotencyKey: `refund-mail:${r._id}:${kind}` },
    );
  }

  // ── participant ──

  /** The leader asks for their money back (paid entries, until REFUND_WINDOW_HOURS before the start). */
  async request(user: AuthUser, code: string, reason: string) {
    const me = await this.users.findById(user.id).select('email').lean();
    const reg = REG_CODE.test(code) && me ? await this.regs.findOne({ code, 'members.email': me.email }).lean() : null;
    if (!reg) throw Errors.notFound('Registration');
    if (!reg.leader_user_id.equals(user.id)) throw Errors.forbidden('LEADER_ONLY', 'Only the team leader can ask for a refund');
    if (reg.status !== 'CONFIRMED' || reg.payment.status !== 'PAID') throw Errors.conflict('NOT_REFUNDABLE', 'Only paid, confirmed registrations can be refunded');
    if (reg.starts_at.getTime() - env.REFUND_WINDOW_HOURS * 3_600_000 <= Date.now()) {
      throw Errors.forbidden('REFUND_WINDOW_CLOSED', `Refunds can be requested until ${env.REFUND_WINDOW_HOURS} hours before the event`);
    }
    if (await this.tickets.exists({ registration_id: reg._id, status: 'USED' })) throw Errors.conflict('TICKET_USED', 'Someone in this team has already checked in');
    const order = await this.orders.findOne({ registration_id: reg._id, status: 'PAID' }).lean();
    if (!order) throw Errors.conflict('NOT_REFUNDABLE', 'No payment found for this registration');
    const r = await this.tx((session) => this.open(order, 'REQUEST', { reason, status: 'REQUESTED', session }));
    if (!r) throw Errors.conflict('ALREADY_REQUESTED', 'A refund for this registration is already in progress');
    return toRefundView(r.toObject());
  }

  async mine(user: AuthUser) {
    const rows = await this.refunds.find({ leader_user_id: new Types.ObjectId(user.id) }).sort({ _id: -1 }).limit(100).lean();
    return { items: rows.map(toRefundView) };
  }

  // ── finance ──

  async list(user: AuthUser, q: { festId: Id; status?: RefundStatus; cursor?: string; limit: number }) {
    const scope = this.rbac.scopeFilter(user, 'refund.approve', SCOPE);
    const base: Record<string, unknown> = { global_event_id: q.festId, status: q.status ?? { $in: ['REQUESTED', 'REJECTED', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'MANUAL_PENDING', 'MANUAL_DONE'] } };
    if (q.cursor) base._id = { $lt: new Types.ObjectId(q.cursor) };
    const rows = await this.refunds.find(this.rbac.withScope(base, scope)).sort({ _id: -1 }).limit(q.limit + 1).lean();
    const items = rows.slice(0, q.limit);
    const counts = q.cursor
      ? undefined
      : await this.refunds.aggregate<{ _id: string; n: number }>([{ $match: this.rbac.withScope({ global_event_id: q.festId }, scope) }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const names = new Map((await this.events.find({ _id: { $in: [...new Set(items.map((r) => String(r.local_event_id)))].map((x) => new Types.ObjectId(x)) } }).select('name').lean()).map((e) => [String(e._id), e.name]));
    return {
      items: items.map((r) => ({ ...toRefundView(r), eventName: names.get(String(r.local_event_id)) ?? null })),
      nextCursor: rows.length > q.limit ? String(items[items.length - 1]._id) : null,
      ...(counts && { counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) }),
    };
  }

  private async loadScoped(user: AuthUser, id: Id) {
    const r = await this.refunds.findOne(this.rbac.withScope({ _id: id }, this.rbac.scopeFilter(user, 'refund.approve', SCOPE))).lean();
    if (!r) throw Errors.notFound('Refund');
    return r;
  }

  /** Approve a request: the registration ends (seat back, tickets void) and the money goes back. */
  async approve(user: AuthUser, id: Id, ip: string) {
    const r = await this.loadScoped(user, id);
    const actor = new Types.ObjectId(user.id);
    const next: RefundStatus = r.mode === 'ONLINE' ? 'QUEUED' : 'MANUAL_PENDING';
    const done = await this.tx(async (session) => {
      const u = await this.refunds.findOneAndUpdate({ _id: id, status: 'REQUESTED' }, { $set: { status: next, decided_by: actor, decided_at: new Date() } }, { new: true, session }).lean();
      if (!u) throw Errors.conflict('NOT_PENDING', 'This request was already decided');
      await this.registrations.endForRefund(r.registration_id, 'Refund approved', actor, session);
      if (next === 'QUEUED') await this.jobs.enqueue(PROCESS_JOB, { refundId: String(id) }, { session, idempotencyKey: `refund-job:${id}` });
      await this.audit.record({ actorId: user.id, action: 'refund.approved', entity: 'refund', entityId: id, after: { status: next }, meta: { registration: r.registration_code, amountPaise: r.amount_paise }, ip }, session);
      return u;
    });
    if (next === 'MANUAL_PENDING') await this.notify(done, 'manual');
    return toRefundView(done);
  }

  async reject(user: AuthUser, id: Id, note: string, ip: string) {
    await this.loadScoped(user, id);
    const r = await this.refunds
      .findOneAndUpdate({ _id: id, status: 'REQUESTED' }, { $set: { status: 'REJECTED', note, decided_by: new Types.ObjectId(user.id), decided_at: new Date() } }, { new: true })
      .lean();
    if (!r) throw Errors.conflict('NOT_PENDING', 'This request was already decided');
    await this.orders.updateOne({ _id: r.order_id, refund_status: 'PENDING' }, { $set: { refund_status: 'NONE' } });
    // A rejected request frees the key, so the leader may ask again with more detail.
    await this.refunds.updateOne({ _id: r._id }, { $set: { key: `${r.key}:rejected:${r._id}` } });
    await this.audit.record({ actorId: user.id, action: 'refund.rejected', entity: 'refund', entityId: id, after: { note }, ip });
    await this.notify(r, 'rejected');
    return toRefundView(r);
  }

  /** Cash handed back at the desk. */
  async markPaid(user: AuthUser, id: Id, note: string | null, ip: string) {
    await this.loadScoped(user, id);
    const r = await this.refunds
      .findOneAndUpdate({ _id: id, status: 'MANUAL_PENDING' }, { $set: { status: 'MANUAL_DONE', note, decided_by: new Types.ObjectId(user.id), decided_at: new Date() } }, { new: true })
      .lean();
    if (!r) throw Errors.conflict('NOT_PENDING', 'This refund is not waiting for a cash hand-back');
    await this.orders.updateOne({ _id: r.order_id }, { $set: { refund_status: 'DONE' } });
    await this.regs.updateOne({ _id: r.registration_id }, { $set: { 'payment.status': 'REFUNDED' } });
    if (r.batch_id) await this.finishBatchStep(r.batch_id, 'manual');
    await this.countRefund(r, 1);
    await this.audit.record({ actorId: user.id, action: 'refund.cash_returned', entity: 'refund', entityId: id, after: { note }, ip });
    return toRefundView(r);
  }

  // ── cancelled events ──

  /** Job after an event is cancelled: one batch, a refund per paid order (online queued, cash for the desk). */
  async refundCancelledEvent(eventId: Id, reason: string, by: Id | null) {
    const ev = await this.events.findById(eventId).select('name global_event_id department_id').lean();
    if (!ev) return;
    let batch: RefundBatch;
    try {
      batch = (await this.batches.create({ local_event_id: eventId, global_event_id: ev.global_event_id, department_id: ev.department_id, event_name: ev.name, reason, started_by: by })).toObject();
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
      batch = (await this.batches.findOne({ local_event_id: eventId }).lean())!;
    }
    const paid = await this.orders.find({ local_event_id: eventId, status: 'PAID', refund_status: { $in: ['NONE', 'FAILED'] } }).lean();
    let added = 0;
    for (const o of paid) {
      const r = await this.tx((session) => this.open(o, 'EVENT_CANCELLED', { reason: `Event cancelled: ${reason}`, batchId: batch._id, session }));
      if (r) {
        added++;
        if (r.status === 'MANUAL_PENDING') await this.notify(r.toObject(), 'manual');
      }
    }
    await this.batches.updateOne({ _id: batch._id }, { $inc: { total: added } });
    if (added === 0) await this.batches.updateOne({ _id: batch._id, total: 0 }, { $set: { status: 'COMPLETED' } });
    // The paid registrations were deactivated by the cancel itself; mark them cancelled for the participants' lists.
    await this.regs.updateMany({ local_event_id: eventId, status: 'CONFIRMED', active: false }, { $set: { status: 'CANCELLED', cancel_reason: `Event cancelled: ${reason}`, cancelled_at: new Date() } });
  }

  async listBatches(user: AuthUser, festId: Id) {
    const rows = await this.batches.find(this.rbac.withScope({ global_event_id: festId }, this.rbac.scopeFilter(user, 'refund.approve', SCOPE))).sort({ _id: -1 }).limit(50).lean();
    return {
      items: rows.map((b) => ({ id: String(b._id), eventName: b.event_name, reason: b.reason, status: b.status, total: b.total, succeeded: b.succeeded, failed: b.failed, manual: b.manual, pausedReason: b.paused_reason, createdAt: b.created_at })),
    };
  }

  /** FAILED → QUEUED plus a fresh job. Atomic, so double clicks queue it once. */
  private async requeue(id: Id) {
    const r = await this.refunds.findOneAndUpdate({ _id: id, status: 'FAILED', mode: 'ONLINE' }, { $set: { status: 'QUEUED', failure: null } }, { new: true }).lean();
    if (!r) return null;
    if (r.batch_id) await this.batches.updateOne({ _id: r.batch_id }, { $inc: { failed: -1 } });
    await this.orders.updateOne({ _id: r.order_id, refund_status: 'FAILED' }, { $set: { refund_status: 'PENDING' } });
    await this.jobs.enqueue(PROCESS_JOB, { refundId: String(r._id) }, { idempotencyKey: `refund-job:${r._id}:${Date.now()}` });
    return r;
  }

  /** Try one failed refund again (after fixing whatever made the gateway refuse it). */
  async retry(user: AuthUser, id: Id, ip: string) {
    await this.loadScoped(user, id);
    const r = await this.requeue(id);
    if (!r) throw Errors.conflict('NOT_FAILED', 'Only failed online refunds can be tried again');
    await this.audit.record({ actorId: user.id, action: 'refund.retried', entity: 'refund', entityId: id, ip });
    return toRefundView(r);
  }

  /** Re-queue a batch's failed refunds (e.g. after topping up the gateway balance). */
  async resume(user: AuthUser, batchId: Id, ip: string) {
    const b = await this.batches.findOne(this.rbac.withScope({ _id: batchId }, this.rbac.scopeFilter(user, 'refund.approve', SCOPE))).lean();
    if (!b) throw Errors.notFound('Batch');
    const failed = await this.refunds.find({ batch_id: batchId, status: 'FAILED' }).select('_id').lean();
    await this.batches.updateOne({ _id: batchId }, { $set: { status: 'RUNNING', paused_reason: null } });
    let requeued = 0;
    for (const r of failed) if (await this.requeue(r._id)) requeued++;
    await this.audit.record({ actorId: user.id, action: 'refund.batch_resumed', entity: 'refund_batch', entityId: batchId, meta: { requeued }, ip });
    return { requeued };
  }
}
