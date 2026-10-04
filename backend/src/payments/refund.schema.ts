import { Schema, Types } from 'mongoose';

/**
 * REQUESTED → (APPROVED →) QUEUED → PROCESSING → SUCCEEDED | FAILED (retryable by "resume")
 * REQUESTED → REJECTED. Cash orders: MANUAL_PENDING → MANUAL_DONE (finance hands the money back).
 */
export const REFUND_STATUS = ['REQUESTED', 'REJECTED', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'MANUAL_PENDING', 'MANUAL_DONE'] as const;
export type RefundStatus = (typeof REFUND_STATUS)[number];
export type RefundSource = 'REQUEST' | 'EVENT_CANCELLED' | 'LATE_PAYMENT' | 'DUPLICATE_PAYMENT';

export interface Refund {
  _id: Types.ObjectId;
  /** One refund per gateway payment (or per cash order): retries can never refund twice. */
  key: string;
  order_id: Types.ObjectId;
  order_code: string;
  registration_id: Types.ObjectId;
  registration_code: string;
  global_event_id: Types.ObjectId;
  local_event_id: Types.ObjectId;
  department_id: Types.ObjectId | null;
  leader_user_id: Types.ObjectId;
  mode: 'ONLINE' | 'OFFLINE';
  payment_id: string | null;
  amount_paise: number;
  source: RefundSource;
  reason: string | null;
  status: RefundStatus;
  batch_id: Types.ObjectId | null;
  gateway_refund_id: string | null;
  failure: string | null;
  decided_by: Types.ObjectId | null;
  decided_at: Date | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export const REFUND_MODEL = 'Refund';
export const REFUND_BATCH_MODEL = 'RefundBatch';

export const RefundSchema = new Schema<Refund>(
  {
    key: { type: String, required: true },
    order_id: { type: Schema.Types.ObjectId, required: true },
    order_code: { type: String, required: true },
    registration_id: { type: Schema.Types.ObjectId, required: true },
    registration_code: { type: String, required: true },
    global_event_id: { type: Schema.Types.ObjectId, required: true },
    local_event_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, default: null },
    leader_user_id: { type: Schema.Types.ObjectId, required: true },
    mode: { type: String, enum: ['ONLINE', 'OFFLINE'], required: true },
    payment_id: { type: String, default: null },
    amount_paise: { type: Number, required: true },
    source: { type: String, required: true },
    reason: { type: String, default: null },
    status: { type: String, enum: REFUND_STATUS, required: true },
    batch_id: { type: Schema.Types.ObjectId, default: null },
    gateway_refund_id: { type: String, default: null },
    failure: { type: String, default: null },
    decided_by: { type: Schema.Types.ObjectId, default: null },
    decided_at: { type: Date, default: null },
    note: { type: String, default: null },
  },
  { collection: 'refunds', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
RefundSchema.index({ key: 1 }, { unique: true });
// Finance queue: a fest, a status, newest first.
RefundSchema.index({ global_event_id: 1, status: 1, _id: -1 });
// The participant's own refunds.
RefundSchema.index({ leader_user_id: 1, _id: -1 });
// Batch progress / resume.
RefundSchema.index({ batch_id: 1, status: 1 });
// Gateway webhooks find the refund by the gateway's id.
RefundSchema.index({ gateway_refund_id: 1 }, { partialFilterExpression: { gateway_refund_id: { $type: 'string' } } });

/** All refunds caused by one cancelled event, with live counters ($inc, never recounted). */
export interface RefundBatch {
  _id: Types.ObjectId;
  local_event_id: Types.ObjectId;
  global_event_id: Types.ObjectId;
  department_id: Types.ObjectId | null;
  event_name: string;
  reason: string;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED';
  total: number;
  succeeded: number;
  failed: number;
  manual: number;
  paused_reason: string | null;
  started_by: Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}
export const RefundBatchSchema = new Schema<RefundBatch>(
  {
    local_event_id: { type: Schema.Types.ObjectId, required: true },
    global_event_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, default: null },
    event_name: { type: String, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ['RUNNING', 'PAUSED', 'COMPLETED'], default: 'RUNNING' },
    total: { type: Number, default: 0 },
    succeeded: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    manual: { type: Number, default: 0 },
    paused_reason: { type: String, default: null },
    started_by: { type: Schema.Types.ObjectId, default: null },
  },
  { collection: 'refund_batches', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);
// One batch per cancelled event (the cancel job can run twice safely).
RefundBatchSchema.index({ local_event_id: 1 }, { unique: true });
RefundBatchSchema.index({ global_event_id: 1, _id: -1 });
