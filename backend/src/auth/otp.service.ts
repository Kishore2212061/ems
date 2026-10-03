import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { Errors } from '../common/app-exception';
import { env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { OTP_MODEL, OtpCode, OtpPurpose } from './schemas/otp-code.schema';
import { hmac } from './token.service';

const hashCode = (userId: Types.ObjectId | string, purpose: OtpPurpose, code: string) =>
  hmac(env.PASSWORD_PEPPER, `${userId}:${purpose}:${code}`);

@Injectable()
export class OtpService {
  constructor(
    @InjectModel(OTP_MODEL) private readonly otps: Model<OtpCode>,
    private readonly mail: MailService,
  ) {}

  /**
   * Issue + email a code.
   * - strict=false (login/signup): if limited, silently keep the existing code — the user still gets
   *   the OTP screen and can use the code already in their inbox.
   * - strict=true (explicit "resend"): limits surface as 429 with retryAfterSec.
   * Returns seconds until a resend is allowed.
   */
  async issue(
    user: { _id: Types.ObjectId; email: string; full_name: string },
    purpose: OtpPurpose,
    strict: boolean,
  ): Promise<number> {
    const now = Date.now();
    const cooldownMs = env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
    const windowStart = new Date(now - env.OTP_TTL_MINUTES * 60_000);

    // One indexed query gives both the latest code (cooldown) and the window count.
    const recent = await this.otps
      .find({ user_id: user._id, purpose, created_at: { $gte: windowStart } })
      .sort({ created_at: -1 })
      .limit(env.OTP_MAX_PER_WINDOW)
      .select('created_at')
      .lean();

    const sinceLast = recent[0] ? now - recent[0].created_at.getTime() : Infinity;
    if (sinceLast < cooldownMs) {
      const wait = Math.ceil((cooldownMs - sinceLast) / 1000);
      if (strict) throw Errors.otpCooldown(wait);
      return wait;
    }
    if (recent.length >= env.OTP_MAX_PER_WINDOW) {
      const oldest = recent[recent.length - 1].created_at.getTime();
      const wait = Math.max(1, Math.ceil((oldest + env.OTP_TTL_MINUTES * 60_000 - now) / 1000));
      if (strict) throw Errors.otpCooldown(wait);
      return wait;
    }

    const code = randomInt(0, 10 ** env.OTP_LENGTH).toString().padStart(env.OTP_LENGTH, '0');
    await this.otps.create({
      user_id: user._id,
      purpose,
      code_hash: hashCode(user._id, purpose, code),
      expires_at: new Date(now + env.OTP_TTL_MINUTES * 60_000),
    });
    await this.mail.sendOtp(user.email, user.full_name, code, env.OTP_TTL_MINUTES, purpose);
    return env.OTP_RESEND_COOLDOWN_SECONDS;
  }

  /** Throws on any failure; resolves only when the latest code was matched and atomically consumed. */
  async consume(userId: string, purpose: OtpPurpose, code: string): Promise<void> {
    const otp = await this.otps
      .findOne({ user_id: userId, purpose, consumed_at: null })
      .sort({ created_at: -1 })
      .select('code_hash attempts expires_at')
      .lean();

    if (!otp || otp.expires_at.getTime() <= Date.now()) throw Errors.otpExpired();
    if (otp.attempts >= env.OTP_MAX_ATTEMPTS) throw Errors.otpLocked();

    const expected = Buffer.from(otp.code_hash);
    const given = Buffer.from(hashCode(userId, purpose, code));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      const upd = await this.otps
        .findOneAndUpdate({ _id: otp._id }, { $inc: { attempts: 1 } }, { new: true, projection: 'attempts' })
        .lean();
      const left = Math.max(0, env.OTP_MAX_ATTEMPTS - (upd?.attempts ?? env.OTP_MAX_ATTEMPTS));
      throw left === 0 ? Errors.otpLocked() : Errors.otpInvalid(left);
    }

    // Conditional update = single-use even if two verify requests race.
    const res = await this.otps.updateOne(
      { _id: otp._id, consumed_at: null, attempts: { $lt: env.OTP_MAX_ATTEMPTS } },
      { $set: { consumed_at: new Date() } },
    );
    if (res.modifiedCount !== 1) throw Errors.otpExpired();
  }
}
