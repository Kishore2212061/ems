import { Schema, Types } from 'mongoose';
import type { Breakdown } from '../payments/fees';

export const REGISTRATION_STATUS = ['PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUS)[number];
/** These hold a seat and a place in the person's schedule. */
export const ACTIVE_STATUSES: RegistrationStatus[] = ['PAYMENT_PENDING', 'CONFIRMED'];

/**
 * NOT_REQUIRED = free · PENDING = online payment not made yet (seat held) ·
 * DUE = pay at the registration desk (seat confirmed) · PAID = settled.
 */
export const PAYMENT_STATUS = ['NOT_REQUIRED', 'PENDING', 'DUE', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];
export type PayMode = 'NONE' | 'ONLINE' | 'OFFLINE';

/** How long an online-pay registration holds its seat. */
export const HOLD_MINUTES = 10;

export interface Member {
  name: string;
  /** Identity: a teammate sees the registration once they sign in with this (verified) email. */
  email: string;
  phone: string | null;
  college: string | null;
  leader: boolean;
}

export interface Payment {
  mode: PayMode;
  status: PaymentStatus;
  /** What the participant pays (= breakdown.totalPaise). */
  amount_paise: number;
  /** Base, platform fee and GST as priced when registering (fee settings can change later). */
  breakdown?: Breakdown;
  /** The event's price_version when registering: later price changes don't touch this entry. */
  price_version: number;
}

export interface Registration {
  _id: Types.ObjectId;
  code: string;
  global_event_id: Types.ObjectId;
  local_event_id: Types.ObjectId;
  department_id: Types.ObjectId | null;
  /** The event's window (end = assumed end when the event has none), kept in sync on time edits → clash checks are one indexed query. */
  starts_at: Date;
  ends_at: Date;
  leader_user_id: Types.ObjectId;
  team_name: string | null;
  members: Member[];
  status: RegistrationStatus;
  /** true while PAYMENT_PENDING/CONFIRMED and the event is on. Drives the one-place-per-event index and clash checks. */
  active: boolean;
  payment: Payment;
  hold_expires_at: Date | null;
  /** Absent (not null) when there is none, so the partial index below serves equality lookups. */
  idempotency_key?: string;
  cancel_reason: string | null;
  cancelled_by: Types.ObjectId | null;
  cancelled_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export const REGISTRATION_MODEL = 'Registration';
export const REGISTRATION_LOCK_MODEL = 'RegistrationLock';

const MemberSchema = new Schema<Member>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: null },
    college: { type: String, default: null },
    leader: { type: Boolean, default: false },
  },
  { _id: false },
);

const PaymentSchema = new Schema<Payment>(
  {
    mode: { type: String, enum: ['NONE', 'ONLINE', 'OFFLINE'], required: true },
    status: { type: String, enum: PAYMENT_STATUS, required: true },
    amount_paise: { type: Number, default: 0 },
    breakdown: { type: Schema.Types.Mixed, default: undefined },
    price_version: { type: Number, default: 0 },
  },
  { _id: false },
);

export const RegistrationSchema = new Schema<Registration>(
  {
    code: { type: String, required: true },
    global_event_id: { type: Schema.Types.ObjectId, required: true },
    local_event_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, default: null },
    starts_at: { type: Date, required: true },
    ends_at: { type: Date, required: true },
    leader_user_id: { type: Schema.Types.ObjectId, required: true },
    team_name: { type: String, default: null },
    members: { type: [MemberSchema], required: true },
    status: { type: String, enum: REGISTRATION_STATUS, required: true },
    active: { type: Boolean, required: true },
    payment: { type: PaymentSchema, required: true },
    hold_expires_at: { type: Date, default: null },
    idempotency_key: { type: String },
    cancel_reason: { type: String, default: null },
    cancelled_by: { type: Schema.Types.ObjectId, default: null },
    cancelled_at: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { collection: 'registrations', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

RegistrationSchema.index({ code: 1 }, { unique: true });
// One active place per person per event, across all teams: the race guard behind MEMBER_ALREADY_REGISTERED.
RegistrationSchema.index(
  { local_event_id: 1, 'members.email': 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_place_per_event' },
);
// A person's registrations in time order: "my registrations" and the time-clash check.
RegistrationSchema.index({ 'members.email': 1, starts_at: 1 }, { name: 'person_schedule' });
// Organiser list: one event, a status tab, newest first (keyset on _id).
RegistrationSchema.index({ local_event_id: 1, status: 1, _id: -1 });
// Hold sweeper: only pending holds are indexed.
RegistrationSchema.index({ hold_expires_at: 1 }, { partialFilterExpression: { status: 'PAYMENT_PENDING' }, name: 'pending_holds' });
// Idempotent create: a retried request finds its first result.
RegistrationSchema.index(
  { leader_user_id: 1, idempotency_key: 1 },
  { unique: true, partialFilterExpression: { idempotency_key: { $exists: true } }, name: 'idempotency' },
);

/**
 * One tiny document per person (email). Every registration transaction writes the lock of each
 * member, so two registrations involving the same person can't commit side by side: one hits a
 * write conflict, retries, and then sees the other's registration in its clash check.
 */
export interface RegistrationLock {
  _id: string;
  n: number;
  at: Date;
}
export const RegistrationLockSchema = new Schema<RegistrationLock>(
  { _id: { type: String }, n: { type: Number, default: 0 }, at: { type: Date, default: () => new Date() } },
  { collection: 'registration_locks', versionKey: false },
);
// Locks only matter during a transaction; old ones are cleaned up.
RegistrationLockSchema.index({ at: 1 }, { expireAfterSeconds: 86_400 });
