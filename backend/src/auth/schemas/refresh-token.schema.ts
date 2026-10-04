import { Schema, Types } from 'mongoose';

export interface RefreshToken {
  _id: Types.ObjectId;
  user_id: Types.ObjectId;
  /** All tokens descended from one login share a family; reuse of a rotated token kills the family. */
  family_id: string;
  token_hash: string;
  /** user.session_version at issue time — mismatch means sessions were revoked. */
  sv: number;
  expires_at: Date;
  revoked_at: Date | null;
  revoke_reason: 'ROTATED' | 'LOGOUT' | 'REUSE_DETECTED' | 'PASSWORD_RESET' | 'PASSWORD_CHANGED' | 'ROLE_CHANGED' | 'SUSPENDED' | null;
  ip?: string;
  user_agent?: string;
  created_at: Date;
}

export const REFRESH_TOKEN_MODEL = 'RefreshToken';

export const RefreshTokenSchema = new Schema<RefreshToken>(
  {
    user_id: { type: Schema.Types.ObjectId, required: true },
    family_id: { type: String, required: true },
    token_hash: { type: String, required: true },
    sv: { type: Number, required: true },
    expires_at: { type: Date, required: true },
    revoked_at: { type: Date, default: null },
    revoke_reason: { type: String, default: null },
    ip: String,
    user_agent: String,
  },
  { collection: 'refresh_tokens', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: false } },
);

RefreshTokenSchema.index({ token_hash: 1 }, { unique: true });
RefreshTokenSchema.index({ family_id: 1 });
RefreshTokenSchema.index({ user_id: 1 });
RefreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
