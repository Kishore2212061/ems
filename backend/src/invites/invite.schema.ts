import { Schema, Types } from 'mongoose';
import { ROLES, SCOPE_TYPES, type Role, type ScopeType } from '../users/user.schema';

export const INVITE_STATUS = ['PENDING', 'ACCEPTED', 'REVOKED'] as const;
export type InviteStatus = (typeof INVITE_STATUS)[number];

export interface Invite {
  _id: Types.ObjectId;
  email: string;
  role: Role;
  scope_type: ScopeType;
  scope_id: Types.ObjectId | null;
  scope_label: string | null;
  /** HMAC of the emailed token; the raw token is never stored. */
  token_hash: string;
  expires_at: Date;
  status: InviteStatus;
  invited_by: Types.ObjectId;
  invited_by_name: string;
  accepted_at?: Date | null;
  accepted_user_id?: Types.ObjectId | null;
  last_sent_at: Date;
  created_at: Date;
}

export const INVITE_MODEL = 'Invite';

export const InviteSchema = new Schema<Invite>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    scope_type: { type: String, enum: SCOPE_TYPES, required: true },
    scope_id: { type: Schema.Types.ObjectId, default: null },
    scope_label: { type: String, default: null },
    token_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    status: { type: String, enum: INVITE_STATUS, default: 'PENDING' },
    invited_by: { type: Schema.Types.ObjectId, required: true },
    invited_by_name: { type: String, required: true },
    accepted_at: { type: Date, default: null },
    accepted_user_id: { type: Schema.Types.ObjectId, default: null },
    last_sent_at: { type: Date, default: Date.now },
  },
  { collection: 'admin_invites', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: false } },
);

InviteSchema.index({ token_hash: 1 }, { unique: true });
InviteSchema.index({ status: 1, created_at: -1 }); // admin list
InviteSchema.index({ invited_by: 1, status: 1, created_at: -1 }); // "my invites" for scoped admins
InviteSchema.index({ email: 1, role: 1, scope_id: 1, status: 1 }); // de-dupe pending invites

export const toPublicInvite = (i: Invite) => ({
  id: String(i._id),
  email: i.email,
  role: i.role,
  scopeType: i.scope_type,
  scopeId: i.scope_id ? String(i.scope_id) : null,
  scopeLabel: i.scope_label,
  status: i.status,
  expiresAt: i.expires_at,
  expired: i.status === 'PENDING' && i.expires_at < new Date(),
  invitedByName: i.invited_by_name,
  lastSentAt: i.last_sent_at,
  createdAt: i.created_at,
  acceptedAt: i.accepted_at ?? null,
});
