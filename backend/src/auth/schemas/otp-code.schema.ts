import { Schema, Types } from 'mongoose';

export const OTP_PURPOSES = ['FIRST_LOGIN', 'PASSWORD_RESET'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export interface OtpCode {
  _id: Types.ObjectId;
  user_id: Types.ObjectId;
  purpose: OtpPurpose;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

export const OTP_MODEL = 'OtpCode';

export const OtpCodeSchema = new Schema<OtpCode>(
  {
    user_id: { type: Schema.Types.ObjectId, required: true },
    purpose: { type: String, enum: OTP_PURPOSES, required: true },
    code_hash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expires_at: { type: Date, required: true },
    consumed_at: { type: Date, default: null },
  },
  { collection: 'otp_codes', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: false } },
);

// Latest-code lookup + resend window counting are both served by this one index.
OtpCodeSchema.index({ user_id: 1, purpose: 1, created_at: -1 });
// Mongo deletes expired codes itself — no cleanup job needed.
OtpCodeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
