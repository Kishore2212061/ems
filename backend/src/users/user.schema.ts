import { Schema, Types } from 'mongoose';

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'SCANNER', 'PARTICIPANT'] as const;
export const SCOPE_TYPES = ['ORG', 'GLOBAL_EVENT', 'DEPARTMENT', 'LOCAL_EVENT'] as const;
export const USER_STATUS = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'] as const;

export type Role = (typeof ROLES)[number];
export type ScopeType = (typeof SCOPE_TYPES)[number];
export type UserStatus = (typeof USER_STATUS)[number];

export interface UserRole {
  role: Role;
  scope_type: ScopeType;
  scope_id: Types.ObjectId | null;
  /** Denormalised scope name ("CSE", "NEC Tech Fest '25") so role lists need no lookups. */
  scope_label?: string | null;
  granted_at: Date;
  granted_by: Types.ObjectId | null;
}

export interface User {
  _id: Types.ObjectId;
  email: string;
  password_hash: string;
  full_name: string;
  /** Lower-cased full_name for anchored, indexed admin search (maintained by middleware). */
  full_name_lc?: string;
  phone?: string;
  college?: string;
  roles: UserRole[];
  status: UserStatus;
  first_login_otp_done: boolean;
  email_verified_at?: Date | null;
  /** Bumped on password change / suspension → every refresh token dies. */
  session_version: number;
  failed_login_count: number;
  locked_until?: Date | null;
  last_login_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const USER_MODEL = 'User';

const UserRoleSchema = new Schema<UserRole>(
  {
    role: { type: String, enum: ROLES, required: true },
    scope_type: { type: String, enum: SCOPE_TYPES, required: true },
    scope_id: { type: Schema.Types.ObjectId, default: null },
    scope_label: { type: String, default: null },
    granted_at: { type: Date, default: Date.now },
    granted_by: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

export const UserSchema = new Schema<User>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true, select: false },
    full_name: { type: String, required: true, trim: true },
    full_name_lc: { type: String },
    phone: { type: String, trim: true },
    college: { type: String, trim: true },
    roles: { type: [UserRoleSchema], default: [] },
    status: { type: String, enum: USER_STATUS, default: 'PENDING_VERIFICATION' },
    first_login_otp_done: { type: Boolean, default: false },
    email_verified_at: { type: Date, default: null },
    session_version: { type: Number, default: 0 },
    failed_login_count: { type: Number, default: 0 },
    locked_until: { type: Date, default: null },
    last_login_at: { type: Date, default: null },
  },
  { collection: 'users', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ full_name_lc: 1 });
// Module 2+: "who has a role on X" lookups
UserSchema.index({ 'roles.role': 1, 'roles.scope_id': 1 });

// Keep full_name_lc in sync on every write path (create, updateOne, findOneAndUpdate).
UserSchema.pre('validate', function () {
  if (this.full_name) this.full_name_lc = this.full_name.toLowerCase();
});
UserSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function () {
  const u = this.getUpdate() as Record<string, any> | null;
  const name = u?.$set?.full_name ?? u?.full_name;
  if (typeof name === 'string') this.set('full_name_lc', name.trim().toLowerCase());
});

/** Fields any auth response needs — keeps every read a narrow projection. */
export const PUBLIC_USER_FIELDS =
  '_id email full_name phone college roles status first_login_otp_done email_verified_at session_version created_at';

export type PublicUserDoc = Pick<
  User,
  '_id' | 'email' | 'full_name' | 'phone' | 'college' | 'roles' | 'status' | 'first_login_otp_done' | 'email_verified_at' | 'session_version' | 'created_at'
>;

export function toPublicUser(u: PublicUserDoc) {
  return {
    id: String(u._id),
    email: u.email,
    fullName: u.full_name,
    phone: u.phone ?? null,
    college: u.college ?? null,
    status: u.status,
    emailVerified: !!u.email_verified_at,
    roles: u.roles.map((r) => ({
      role: r.role,
      scopeType: r.scope_type,
      scopeId: r.scope_id ? String(r.scope_id) : null,
      scopeLabel: r.scope_label ?? null,
    })),
    createdAt: u.created_at,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;
