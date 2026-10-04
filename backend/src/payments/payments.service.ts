import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash, randomInt } from 'node:crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AppException, Errors } from '../common/app-exception';
import type { AuthUser } from '../common/decorators';
import { env } from '../config/env';
import { JobsService } from '../jobs/jobs.service';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { MailService } from '../mail/mail.service';
import { registrationCancelledEmail } from '../mail/templates';
import { RbacService } from '../rbac/rbac.service';
import { REGISTRATION_MODEL, Registration } from '../registrations/registration.schema';
import { CODE as REG_CODE } from '../registrations/registrations.dto';
import { RegistrationsService } from '../registrations/registrations.service';
import { TicketsService } from '../tickets/tickets.service';
import { USER_MODEL, User } from '../users/user.schema';
import { calculateBreakdown } from './fees';
import { GatewayError, MockGateway, PAYMENT_GATEWAY, type PaymentGateway } from './gateway';
import { ORDER_MODEL, Order, WEBHOOK_EVENT_MODEL, WebhookEvent } from './order.schema';
import type { OrderListQuery, VerifyDto } from './payments.dto';

type Id = Types.ObjectId;
const REFUND_JOB = 'payments.refund';
const ORDER_SCOPE = { globalEventId: 'global_event_id', departmentId: 'department_id', localEventId: 'local_event_id' } as const;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => `ORD-${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function toOrderView(o: Order) {
  return {
    code: o.code,
    registrationCode: o.registration_code,
    mode: o.mode,
    status: o.status,
    amountPaise: o.amount_paise,
    breakdown: o.breakdown,
    paidAt: o.paid_at ?? null,
    refundStatus: o.refund_status,
    createdAt: o.created_at,
  };
}

/**
 * Money in: online checkout (create order → browser pays → verify and/or webhook → finalise) and
 * cash at the registration desk. finalise() is one transaction of conditional updates, so verify
 * and webhook (in any order, any number of times) settle a payment exactly once.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    @InjectModel(ORDER_MODEL) private readonly orders: Model<Order>,
    @InjectModel(WEBHOOK_EVENT_MODEL) private readonly hooks: Model<WebhookEvent>,
    @InjectModel(REGISTRATION_MODEL) private readonly regs: Model<Registration>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectConnection() private readonly conn: Connection,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly registrations: RegistrationsService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly jobs: JobsService,
    private readonly tickets: TicketsService,
  ) {
    jobs.register<{ orderId: string; paymentId: string; amountPaise: number }>(REFUND_JOB, (p) => this.runRefund(p));
  }

  private gw(): PaymentGateway {
    if (!this.gateway) throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'PAYMENTS_UNAVAILABLE', 'Online payment is not available right now. Please try again later.');
    return this.gateway;
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

  // ── participant: online checkout ─────────────────────────────────────────

  private async leaderRegistration(user: AuthUser, code: string) {
    const me = await this.users.findById(user.id).select('email full_name phone').lean();
    const r = REG_CODE.test(code) && me ? await this.regs.findOne({ code, 'members.email': me.email }).lean() : null;
    if (!r || !me) throw Errors.notFound('Registration');
    if (!r.leader_user_id.equals(me._id)) throw Errors.forbidden('LEADER_ONLY', 'Only the team leader can pay for this registration');
    return { r, me };
  }

  /** Start (or resume) online payment for a held registration. The amount is the server's, never the browser's. */
  async createOrder(user: AuthUser, code: string) {
    const { r, me } = await this.leaderRegistration(user, code);
    if (r.payment.status === 'PAID') throw Errors.conflict('ALREADY_PAID', 'This registration is already paid');
    if (r.payment.mode !== 'ONLINE') throw Errors.conflict('NOT_ONLINE', 'This entry is paid at the registration desk');
    if (r.status !== 'PAYMENT_PENDING' || !r.active || !r.hold_expires_at || r.hold_expires_at <= new Date()) {
      throw Errors.gone('HOLD_EXPIRED', 'Your seat hold ran out before payment. Register again if seats are left.');
    }
    const gw = this.gw();
    let order = await this.orders.findOne({ registration_id: r._id, status: 'CREATED', gateway: gw.name }).lean();
    if (!order) {
      const orderCode = newCode();
      let gatewayOrder: { id: string };
      try {
        gatewayOrder = await gw.createOrder({ amountPaise: r.payment.amount_paise, receipt: orderCode, notes: { registration: r.code } });
      } catch (e) {
        this.logger.warn(`create order failed: ${(e as Error).message}`);
        throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, 'GATEWAY_UNAVAILABLE', "Couldn't reach the payment gateway. Your seat is still held; please try again.");
      }
      try {
        order = (
          await this.orders.create({
            code: orderCode,
            registration_id: r._id,
            registration_code: r.code,
            global_event_id: r.global_event_id,
            local_event_id: r.local_event_id,
            department_id: r.department_id,
            leader_user_id: r.leader_user_id,
            mode: 'ONLINE',
            breakdown: r.payment.breakdown ?? calculateBreakdown({ basePaise: r.payment.amount_paise, online: true, settings: { platformFeeBps: 0, platformFeeFlatPaise: 0, gstBps: 0, feeBearer: 'PARTICIPANT' } }),
            amount_paise: r.payment.amount_paise,
            gateway: gw.name,
            gateway_order_id: gatewayOrder.id,
          })
        ).toObject();
      } catch (e: any) {
        // Two tabs started checkout at once: use the order that won.
        if (e?.code !== 11000) throw e;
        order = (await this.orders.findOne({ registration_id: r._id, status: 'CREATED' }).lean())!;
      }
    }
    const event = await this.events.findById(r.local_event_id).select('name').lean();
    return {
      orderCode: order.code,
      gateway: gw.name,
      keyId: gw.keyId,
      gatewayOrderId: order.gateway_order_id!,
      amountPaise: order.amount_paise,
      currency: 'INR',
      description: event?.name ?? 'Event registration',
      holdExpiresAt: r.hold_expires_at,
      prefill: { name: me.full_name, email: me.email, contact: me.phone ?? '' },
    };
  }

  /** The browser's checkout handler result. Signature checked in constant time, then finalise(). */
  async verify(user: AuthUser, orderCode: string, dto: VerifyDto, ip: string) {
    const order = await this.orders.findOne({ code: orderCode, leader_user_id: new Types.ObjectId(user.id) }).lean();
    if (!order) throw Errors.notFound('Order');
    const gw = this.gw();
    if (dto.gatewayOrderId !== order.gateway_order_id || !gw.verifyPayment(order.gateway_order_id!, dto.paymentId, dto.signature)) {
      await this.audit.record({ actorId: user.id, action: 'payment.signature_invalid', entity: 'order', entityId: order._id, meta: { code: order.code }, ip });
      throw Errors.badRequest('SIGNATURE_INVALID', "We couldn't confirm this payment. If money was taken, it will be settled or refunded automatically.");
    }
    await this.finalise(order.gateway_order_id!, dto.paymentId, 'verify');
    return this.status(user, orderCode);
  }

  async status(user: AuthUser, orderCode: string) {
    const order = await this.orders.findOne({ code: orderCode, leader_user_id: new Types.ObjectId(user.id) }).lean();
    if (!order) throw Errors.notFound('Order');
    const r = await this.regs.findById(order.registration_id).select('status payment').lean();
    return { ...toOrderView(order), registrationStatus: r?.status ?? null };
  }

  /** Development only (simulated gateway): act as the checkout and return a valid payment signature. */
  async simulatePay(user: AuthUser, orderCode: string) {
    if (!(this.gateway instanceof MockGateway) || env.NODE_ENV === 'production') throw Errors.notFound();
    const order = await this.orders.findOne({ code: orderCode, leader_user_id: new Types.ObjectId(user.id), status: 'CREATED' }).lean();
    if (!order) throw Errors.notFound('Order');
    return { gatewayOrderId: order.gateway_order_id!, ...this.gateway.pay(order.gateway_order_id!) };
  }

  // ── gateway webhook ───────────────────────────────────────────────────────

  /**
   * Razorpay → us. Signed over the raw body. Each delivery is processed once (event id recorded
   * after processing; finalise() is idempotent anyway, so a crash in between is harmless).
   */
  async webhook(raw: Buffer | undefined, signature: string | undefined, eventId: string | undefined) {
    const gw = this.gw();
    if (!raw || !signature || !gw.verifyWebhook(raw, signature)) throw Errors.badRequest('SIGNATURE_INVALID', 'Invalid webhook signature');
    const id = eventId?.slice(0, 100) || createHash('sha256').update(raw).digest('hex');
    if (await this.hooks.exists({ _id: id })) return { ok: true, duplicate: true };
    const body = JSON.parse(raw.toString('utf8'));
    const payment = body?.payload?.payment?.entity;
    if ((body.event === 'payment.captured' || body.event === 'order.paid') && payment?.order_id) {
      await this.finalise(String(payment.order_id), String(payment.id), 'webhook', Number(payment.amount));
    } else if (body.event === 'payment.failed' && payment?.order_id) {
      // The person can retry on the same order until the hold ends; just keep the reason.
      await this.orders.updateOne({ gateway_order_id: String(payment.order_id), status: 'CREATED' }, { $set: { last_error: String(payment.error_description ?? 'Payment failed').slice(0, 300) } });
    }
    await this.hooks.create({ _id: id, type: String(body.event ?? 'unknown') }).catch((e) => {
      if (e?.code !== 11000) throw e;
    });
    return { ok: true };
  }

  /**
   * Settle a captured payment exactly once: order CREATED → PAID, registration confirmed (or, if
   * the seat is gone, a full refund is queued). A second payment for an already-paid order is
   * refunded too. Safe to call any number of times, from verify and webhook in any order.
   */
  async finalise(gatewayOrderId: string, paymentId: string, source: 'verify' | 'webhook', amountPaise?: number) {
    const outcome = await this.tx(async (session) => {
      const order = await this.orders
        .findOneAndUpdate({ gateway_order_id: gatewayOrderId, status: 'CREATED' }, { $set: { status: 'PAID', gateway_payment_id: paymentId, paid_at: new Date(), last_error: null } }, { new: true, session })
        .lean();
      if (!order) {
        const existing = await this.orders.findOne({ gateway_order_id: gatewayOrderId }).session(session).lean();
        if (existing?.status === 'PAID' && existing.gateway_payment_id !== paymentId) {
          // Paid twice (e.g. a bank app retried): give the extra payment back.
          await this.jobs.enqueue(REFUND_JOB, { orderId: String(existing._id), paymentId, amountPaise: amountPaise ?? existing.amount_paise }, { session, idempotencyKey: `refund:${paymentId}` });
          return { kind: 'duplicate' as const, order: existing };
        }
        return { kind: existing ? ('already' as const) : ('unknown' as const), order: existing };
      }
      if (amountPaise !== undefined && amountPaise !== order.amount_paise) this.logger.error(`order ${order.code}: gateway amount ${amountPaise} ≠ ${order.amount_paise}`);
      const { reg, seated } = await this.registrations.confirmPaid(order.registration_id, session);
      if (!seated) {
        await this.orders.updateOne({ _id: order._id }, { $set: { refund_status: 'PENDING' } }, { session });
        await this.jobs.enqueue(REFUND_JOB, { orderId: String(order._id), paymentId, amountPaise: order.amount_paise }, { session, idempotencyKey: `refund:${paymentId}` });
        const leader = reg?.members.find((m) => m.leader);
        const ev = await this.events.findById(order.local_event_id).select('name').session(session).lean();
        if (leader) {
          await this.mail.dispatch(
            {
              to: leader.email,
              ...registrationCancelledEmail({
                name: leader.name,
                event: ev?.name ?? 'the event',
                code: order.registration_code,
                by: 'the system',
                reason: `your payment arrived after the seat hold ran out and no seat was left. A full refund of ${rupees(order.amount_paise)} is on its way`,
                link: `${env.WEB_BASE_URL}/my/registrations/${order.registration_code}`,
              }),
            },
            { session },
          );
        }
      }
      await this.audit.record(
        { actorId: null, action: seated ? 'order.paid' : 'order.paid_refund_due', entity: 'order', entityId: order._id, after: { status: 'PAID', paymentId }, meta: { code: order.code, source }, ip: 'gateway' },
        session,
      );
      return { kind: seated ? ('paid' as const) : ('refund' as const), order };
    });
    return outcome;
  }

  private async runRefund(p: { orderId: string; paymentId: string; amountPaise: number }) {
    const refund = await this.gw().refund(p.paymentId, p.amountPaise);
    await this.orders.updateOne({ _id: new Types.ObjectId(p.orderId) }, { $set: { refund_status: 'DONE', refund_id: refund.id } });
    this.logger.log(`refunded ${p.paymentId} (${p.amountPaise} paise) → ${refund.id}`);
  }

  // ── registration desk ─────────────────────────────────────────────────────

  /** Cash/UPI taken at the desk for a pay-at-desk entry. The amount must match exactly. */
  async collectOffline(user: AuthUser, code: string, amountPaise: number, ip: string) {
    const r = REG_CODE.test(code)
      ? await this.regs.findOne(this.rbac.withScope({ code }, this.rbac.scopeFilter(user, 'order.collect_offline', ORDER_SCOPE))).lean()
      : null;
    if (!r) throw Errors.notFound('Registration');
    if (r.payment.status === 'PAID') throw Errors.conflict('ALREADY_PAID', 'Already paid');
    if (r.payment.status !== 'DUE' || r.status !== 'CONFIRMED' || !r.active) throw Errors.conflict('NOT_DUE', 'Nothing is due at the desk for this registration');
    if (amountPaise !== r.payment.amount_paise) {
      throw Errors.badRequest('AMOUNT_MISMATCH', `The amount due is ${rupees(r.payment.amount_paise)}`, { expectedPaise: r.payment.amount_paise });
    }
    const order = await this.tx(async (session) => {
      const u = await this.regs.updateOne({ _id: r._id, 'payment.status': 'DUE', active: true }, { $set: { 'payment.status': 'PAID' }, $inc: { version: 1 } }, { session });
      if (u.modifiedCount !== 1) throw Errors.conflict('ALREADY_PAID', 'Already paid');
      await this.tickets.activate(r._id, session); // "pay first" tickets become entry passes
      const [o] = await this.orders.create(
        [
          {
            code: newCode(),
            registration_id: r._id,
            registration_code: r.code,
            global_event_id: r.global_event_id,
            local_event_id: r.local_event_id,
            department_id: r.department_id,
            leader_user_id: r.leader_user_id,
            mode: 'OFFLINE',
            status: 'PAID',
            breakdown: r.payment.breakdown ?? calculateBreakdown({ basePaise: r.payment.amount_paise, online: false, settings: { platformFeeBps: 0, platformFeeFlatPaise: 0, gstBps: 0, feeBearer: 'PARTICIPANT' } }),
            amount_paise: r.payment.amount_paise,
            paid_at: new Date(),
            collected_by: new Types.ObjectId(user.id),
          },
        ],
        { session },
      );
      await this.audit.record({ actorId: user.id, action: 'order.collected_offline', entity: 'order', entityId: o._id, after: { amountPaise }, meta: { registration: r.code }, ip }, session);
      return o.toObject();
    });
    return toOrderView(order);
  }

  // ── finance ───────────────────────────────────────────────────────────────

  async list(user: AuthUser, q: OrderListQuery) {
    const scope = this.rbac.scopeFilter(user, 'order.read', ORDER_SCOPE);
    const base: Record<string, unknown> = { global_event_id: q.festId, status: q.status ?? { $in: ['CREATED', 'PAID'] } };
    if (q.mode) base.mode = q.mode;
    const filter = this.rbac.withScope(q.cursor ? { ...base, _id: { $lt: new Types.ObjectId(q.cursor) } } : base, scope);
    const [rows, totals] = await Promise.all([
      this.orders.find(filter).sort({ _id: -1 }).limit(q.limit + 1).lean(),
      q.cursor
        ? undefined
        : this.orders.aggregate<{ _id: { mode: string }; paise: number; n: number; refunds: number }>([
            { $match: this.rbac.withScope({ global_event_id: q.festId, status: 'PAID' }, scope) },
            { $group: { _id: { mode: '$mode' }, paise: { $sum: '$amount_paise' }, n: { $sum: 1 }, refunds: { $sum: { $cond: [{ $ne: ['$refund_status', 'NONE'] }, 1, 0] } } } },
          ]),
    ]);
    const items = rows.slice(0, q.limit);
    const eventIds = [...new Set(items.map((o) => String(o.local_event_id)))].map((id) => new Types.ObjectId(id));
    const names = new Map((await this.events.find({ _id: { $in: eventIds } }).select('name').lean()).map((e) => [String(e._id), e.name]));
    const sum = (mode: string) => totals?.find((t) => t._id.mode === mode);
    return {
      items: items.map((o) => ({ ...toOrderView(o), eventName: names.get(String(o.local_event_id)) ?? null })),
      nextCursor: rows.length > q.limit ? String(items[items.length - 1]._id) : null,
      ...(totals && {
        totals: {
          onlinePaise: sum('ONLINE')?.paise ?? 0,
          onlineCount: sum('ONLINE')?.n ?? 0,
          deskPaise: sum('OFFLINE')?.paise ?? 0,
          deskCount: sum('OFFLINE')?.n ?? 0,
          refunds: totals.reduce((s, t) => s + t.refunds, 0),
        },
      }),
    };
  }
}
