import { Schema, Types } from 'mongoose';
import type { Breakdown, FeeSettings } from './fees';

export const ORDER_STATUS = ['CREATED', 'PAID'] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];
/** NONE · PENDING (queued) · DONE · FAILED — a payment that arrived when no seat could be given. */
export type RefundStatus = 'NONE' | 'PENDING' | 'DONE' | 'FAILED';

export interface Order {
  _id: Types.ObjectId;
  /** ORD-XXXXXXXX, also the gateway "receipt". */
  code: string;
  registration_id: Types.ObjectId;
  registration_code: string;
  global_event_id: Types.ObjectId;
  local_event_id: Types.ObjectId;
  department_id: Types.ObjectId | null;
  leader_user_id: Types.ObjectId;
  mode: 'ONLINE' | 'OFFLINE';
  status: OrderStatus;
  breakdown: Breakdown;
  amount_paise: number;
  gateway: 'razorpay' | 'mock' | null;
  /** Online orders only (absent for desk payments, so the unique index below can be partial on $exists). */
  gateway_order_id?: string;
  gateway_payment_id: string | null;
  paid_at: Date | null;
  /** Desk payments: who took the money. */
  collected_by: Types.ObjectId | null;
  last_error: string | null;
  refund_status: RefundStatus;
  refund_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export const ORDER_MODEL = 'Order';
export const WEBHOOK_EVENT_MODEL = 'WebhookEvent';
export const FEE_SETTINGS_MODEL = 'FeeSettings';

const BreakdownSchema = new Schema<Breakdown>(
  {
    basePaise: Number,
    platformFeePaise: Number,
    gstPaise: Number,
    cgstPaise: Number,
    sgstPaise: Number,
    igstPaise: Number,
    totalPaise: Number,
  },
  { _id: false },
);

export const OrderSchema = new Schema<Order>(
  {
    code: { type: String, required: true },
    registration_id: { type: Schema.Types.ObjectId, required: true },
    registration_code: { type: String, required: true },
    global_event_id: { type: Schema.Types.ObjectId, required: true },
    local_event_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, default: null },
    leader_user_id: { type: Schema.Types.ObjectId, required: true },
    mode: { type: String, enum: ['ONLINE', 'OFFLINE'], required: true },
    status: { type: String, enum: ORDER_STATUS, default: 'CREATED' },
    breakdown: { type: BreakdownSchema, required: true },
    amount_paise: { type: Number, required: true },
    gateway: { type: String, default: null },
    gateway_order_id: { type: String },
    gateway_payment_id: { type: String, default: null },
    paid_at: { type: Date, default: null },
    collected_by: { type: Schema.Types.ObjectId, default: null },
    last_error: { type: String, default: null },
    refund_status: { type: String, enum: ['NONE', 'PENDING', 'DONE', 'FAILED'], default: 'NONE' },
    refund_id: { type: String, default: null },
  },
  { collection: 'orders', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

OrderSchema.index({ code: 1 }, { unique: true });
// Webhooks and verify find the order by the gateway's id.
OrderSchema.index({ gateway_order_id: 1 }, { unique: true, partialFilterExpression: { gateway_order_id: { $exists: true } } });
// "Is there an open order for this registration?" + one PAID order per registration (no double charge on our side).
OrderSchema.index({ registration_id: 1, status: 1 });
OrderSchema.index({ registration_id: 1 }, { unique: true, partialFilterExpression: { status: 'PAID' }, name: 'one_paid_order' });
// Finance list: a fest, a status, newest first.
OrderSchema.index({ global_event_id: 1, status: 1, _id: -1 });

/** Each gateway delivery is recorded once (the unique _id is the idempotency key). */
export interface WebhookEvent {
  _id: string;
  type: string;
  received_at: Date;
}
export const WebhookEventSchema = new Schema<WebhookEvent>(
  { _id: { type: String }, type: { type: String, required: true }, received_at: { type: Date, default: () => new Date() } },
  { collection: 'webhook_events', versionKey: false },
);
WebhookEventSchema.index({ received_at: 1 }, { expireAfterSeconds: 90 * 86_400 });

/** One document (_id "default"): fee settings for the whole org. */
export interface FeeSettingsDoc extends FeeSettings {
  _id: string;
  updated_by: Types.ObjectId | null;
  updated_at: Date;
}
export const FeeSettingsSchema = new Schema<FeeSettingsDoc>(
  {
    _id: { type: String },
    platformFeeBps: { type: Number, default: 0 },
    platformFeeFlatPaise: { type: Number, default: 0 },
    gstBps: { type: Number, default: 0 },
    feeBearer: { type: String, enum: ['PARTICIPANT', 'ORGANIZER'], default: 'PARTICIPANT' },
    updated_by: { type: Schema.Types.ObjectId, default: null },
    updated_at: { type: Date, default: () => new Date() },
  },
  { collection: 'fee_settings', versionKey: false },
);
