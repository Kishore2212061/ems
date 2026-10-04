import { Schema, Types } from 'mongoose';

/** ACTIVE = valid entry · PAYMENT_PENDING = pay at the desk first · USED = scanned in · VOID = cancelled/refunded. */
export const TICKET_STATUS = ['ACTIVE', 'PAYMENT_PENDING', 'USED', 'VOID'] as const;
export type TicketStatus = (typeof TICKET_STATUS)[number];

export interface Ticket {
  _id: Types.ObjectId;
  /** TCK-XXXX-XX: printed under the QR, typed by hand if a QR won't scan. */
  code: string;
  registration_id: Types.ObjectId;
  registration_code: string;
  member_email: string;
  member_name: string;
  leader: boolean;
  global_event_id: Types.ObjectId;
  local_event_id: Types.ObjectId;
  department_id: Types.ObjectId | null;
  status: TicketStatus;
  /** Random per ticket and part of the QR signature: re-issuing a QR (new jti) invalidates old screenshots. */
  jti: string;
  /** Signing key id (rotation: old keys verify until their events end). */
  kid: string;
  issued_at: Date;
  used_at: Date | null;
  used_by: Types.ObjectId | null;
  /** Which scanner admitted it (shown when a copy is scanned again). */
  used_device?: string | null;
  void_reason: string | null;
}

export const TICKET_MODEL = 'Ticket';

export const TicketSchema = new Schema<Ticket>(
  {
    code: { type: String, required: true },
    registration_id: { type: Schema.Types.ObjectId, required: true },
    registration_code: { type: String, required: true },
    member_email: { type: String, required: true },
    member_name: { type: String, required: true },
    leader: { type: Boolean, default: false },
    global_event_id: { type: Schema.Types.ObjectId, required: true },
    local_event_id: { type: Schema.Types.ObjectId, required: true },
    department_id: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: TICKET_STATUS, required: true },
    jti: { type: String, required: true },
    kid: { type: String, required: true },
    issued_at: { type: Date, default: () => new Date() },
    used_at: { type: Date, default: null },
    used_by: { type: Schema.Types.ObjectId, default: null },
    used_device: { type: String, default: null },
    void_reason: { type: String, default: null },
  },
  { collection: 'tickets', versionKey: false },
);

TicketSchema.index({ code: 1 }, { unique: true });
// One ticket per member per registration: issuing twice (retries) can't duplicate.
TicketSchema.index({ registration_id: 1, member_email: 1 }, { unique: true });
// "My tickets", newest first.
TicketSchema.index({ member_email: 1, issued_at: -1 });
// Gate counts / voiding an event's tickets.
TicketSchema.index({ local_event_id: 1, status: 1 });
