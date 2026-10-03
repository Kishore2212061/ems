import { Schema, Types } from 'mongoose';

export interface AuditLog {
  _id: Types.ObjectId;
  /** null = system (seed, jobs). */
  actor_id: Types.ObjectId | null;
  /** Dotted verb, e.g. "auth.password_reset", "user.role_granted", "global_event.published". */
  action: string;
  entity: string;
  entity_id: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  ip?: string;
  at: Date;
}

export const AUDIT_LOG_MODEL = 'AuditLog';

export const AuditLogSchema = new Schema<AuditLog>(
  {
    actor_id: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entity_id: { type: String, default: null },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    meta: Schema.Types.Mixed,
    ip: String,
    at: { type: Date, default: Date.now },
  },
  // Append-only by design: the service exposes no update/delete. Retained 7 years (no TTL).
  { collection: 'audit_logs', versionKey: false },
);

AuditLogSchema.index({ entity: 1, entity_id: 1, at: -1 }); // history of one record
AuditLogSchema.index({ actor_id: 1, at: -1 }); // what did this person do
AuditLogSchema.index({ action: 1, at: -1 }); // all events of a kind
AuditLogSchema.index({ at: -1 }); // latest activity feed
