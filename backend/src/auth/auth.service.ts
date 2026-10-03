import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app-exception';
import { env } from '../config/env';
import { PUBLIC_USER_FIELDS, PublicUserDoc, toPublicUser, User, USER_MODEL } from '../users/user.schema';
import { LoginDto, ResetPasswordDto, SignupDto, VerifyOtpDto } from './auth.dto';
import { OtpService } from './otp.service';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { REFRESH_TOKEN_MODEL, RefreshToken } from './schemas/refresh-token.schema';
import { ClientCtx, TokenService } from './token.service';

/**
 * Revoked tokens are kept only long enough to catch replay of a stolen token, then the TTL index
 * deletes them — instead of every rotation leaving a row behind for the full 30-day refresh TTL.
 */
const purgeAt = () => new Date(Date.now() + env.REFRESH_REVOKED_RETENTION * 1000);

export interface SessionResult {
  accessToken: string;
  expiresIn: number;
  user: ReturnType<typeof toPublicUser>;
  /** Present when a new refresh cookie must be set. */
  refreshToken?: string;
}

export interface OtpRequiredResult {
  otpRequired: true;
  otpToken: string;
  email: string;
  resendAfterSec: number;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(REFRESH_TOKEN_MODEL) private readonly refreshTokens: Model<RefreshToken>,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
  ) {}

  // ── Signup ────────────────────────────────────────────────────────────────
  async signup(dto: SignupDto): Promise<OtpRequiredResult> {
    const existing = await this.users.findOne({ email: dto.email }).select('first_login_otp_done').lean();
    if (existing?.first_login_otp_done) throw Errors.emailTaken();

    const profile = {
      full_name: dto.fullName,
      phone: dto.phone,
      college: dto.college,
      password_hash: await hashPassword(dto.password),
    };

    let user: Pick<User, '_id' | 'email' | 'full_name'>;
    if (existing) {
      // Never-verified account: nobody has proven they own this email yet, so the latest signup
      // wins. Stops someone squatting a classmate's email with an unverified account.
      await this.users.updateOne({ _id: existing._id, first_login_otp_done: false }, { $set: profile });
      user = { _id: existing._id, email: dto.email, full_name: dto.fullName };
    } else {
      try {
        const doc = await this.users.create({
          ...profile,
          email: dto.email,
          roles: [{ role: 'PARTICIPANT', scope_type: 'ORG', scope_id: null, granted_by: null }],
        });
        user = { _id: doc._id, email: doc.email, full_name: doc.full_name };
      } catch (e: any) {
        if (e?.code === 11000) throw Errors.emailTaken(); // concurrent signup race
        throw e;
      }
    }

    return this.otpRequired(user);
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, ctx: ClientCtx): Promise<SessionResult | OtpRequiredResult> {
    const user = await this.users
      .findOne({ email: dto.email })
      .select(`${PUBLIC_USER_FIELDS} failed_login_count locked_until +password_hash`)
      .lean();

    if (!user) {
      await burnPasswordCheck(dto.password);
      throw Errors.invalidCredentials();
    }

    const now = Date.now();
    if (user.locked_until && user.locked_until.getTime() > now) {
      throw Errors.accountLocked(Math.ceil((user.locked_until.getTime() - now) / 1000));
    }

    if (!(await verifyPassword(user.password_hash, dto.password))) {
      await this.recordFailedLogin(user._id, ctx);
      throw Errors.invalidCredentials();
    }

    // Checked only after the password, so suspension status isn't leaked to strangers.
    if (user.status === 'SUSPENDED') throw Errors.accountSuspended();

    if (!user.first_login_otp_done) return this.otpRequired(user);

    await this.users.updateOne(
      { _id: user._id },
      { $set: { last_login_at: new Date(), failed_login_count: 0, locked_until: null } },
    );
    return this.startSession(user, ctx);
  }

  private async recordFailedLogin(userId: Types.ObjectId, ctx: ClientCtx) {
    const upd = await this.users
      .findOneAndUpdate({ _id: userId }, { $inc: { failed_login_count: 1 } }, { new: true, projection: 'failed_login_count' })
      .lean();
    if (upd && upd.failed_login_count >= env.LOGIN_MAX_ATTEMPTS) {
      await this.users.updateOne(
        { _id: userId },
        { $set: { failed_login_count: 0, locked_until: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) } },
      );
      await this.audit.recordSafe({
        action: 'auth.account_locked',
        entity: 'user',
        entityId: userId,
        meta: { failedAttempts: upd.failed_login_count, lockMinutes: env.LOGIN_LOCK_MINUTES },
        ip: ctx.ip,
      });
    }
  }

  // ── OTP ───────────────────────────────────────────────────────────────────
  private async otpRequired(user: Pick<User, '_id' | 'email' | 'full_name'>): Promise<OtpRequiredResult> {
    const resendAfterSec = await this.otp.issue(user, 'FIRST_LOGIN', false);
    return {
      otpRequired: true,
      otpToken: this.tokens.signOtpToken(user._id, 'FIRST_LOGIN'),
      email: user.email,
      resendAfterSec,
    };
  }

  async verifyOtp(dto: VerifyOtpDto, ctx: ClientCtx): Promise<SessionResult> {
    const t = this.tokens.verifyOtpToken(dto.otpToken);
    if (!t || t.purpose !== 'FIRST_LOGIN') throw Errors.otpSession();

    await this.otp.consume(t.userId, t.purpose, dto.code);

    const now = new Date();
    const user = await this.users
      .findOneAndUpdate(
        { _id: t.userId, status: { $ne: 'SUSPENDED' } },
        {
          $set: {
            first_login_otp_done: true,
            status: 'ACTIVE',
            email_verified_at: now,
            last_login_at: now,
            failed_login_count: 0,
            locked_until: null,
          },
        },
        { new: true, projection: PUBLIC_USER_FIELDS },
      )
      .lean();
    if (!user) throw Errors.accountSuspended();

    return this.startSession(user, ctx);
  }

  async resendOtp(otpToken: string) {
    const t = this.tokens.verifyOtpToken(otpToken);
    if (!t) throw Errors.otpSession();
    const user = await this.users.findById(t.userId).select('email full_name first_login_otp_done status').lean();
    if (t.purpose === 'FIRST_LOGIN' && (!user || user.first_login_otp_done)) throw Errors.otpSession();
    // Reset flow for an unknown email: pretend success so the endpoint doesn't reveal who has an account.
    if (!user || user.status === 'SUSPENDED') return { sent: true, resendAfterSec: env.OTP_RESEND_COOLDOWN_SECONDS };
    const resendAfterSec = await this.otp.issue(user, t.purpose, true);
    return { sent: true, resendAfterSec };
  }

  // ── Password reset ────────────────────────────────────────────────────────
  /** Same response whether or not the email exists (no account enumeration). */
  async forgotPassword(email: string): Promise<OtpRequiredResult> {
    const user = await this.users.findOne({ email }).select('email full_name status').lean();
    if (!user || user.status === 'SUSPENDED') {
      return {
        otpRequired: true,
        otpToken: this.tokens.signOtpToken(new Types.ObjectId(), 'PASSWORD_RESET'),
        email,
        resendAfterSec: env.OTP_RESEND_COOLDOWN_SECONDS,
      };
    }
    const resendAfterSec = await this.otp.issue(user, 'PASSWORD_RESET', false);
    return {
      otpRequired: true,
      otpToken: this.tokens.signOtpToken(user._id, 'PASSWORD_RESET'),
      email: user.email,
      resendAfterSec,
    };
  }

  /** Code proves email ownership → set new password, sign out every other device, sign in here. */
  async resetPassword(dto: ResetPasswordDto, ctx: ClientCtx): Promise<SessionResult> {
    const t = this.tokens.verifyOtpToken(dto.otpToken);
    if (!t || t.purpose !== 'PASSWORD_RESET') throw Errors.otpSession();

    await this.otp.consume(t.userId, 'PASSWORD_RESET', dto.code);

    const now = new Date();
    const user = await this.users
      .findOneAndUpdate(
        { _id: t.userId, status: { $ne: 'SUSPENDED' } },
        {
          $set: {
            password_hash: await hashPassword(dto.password),
            // Reset code also proves email ownership, so it completes first-time verification too.
            first_login_otp_done: true,
            status: 'ACTIVE',
            email_verified_at: now,
            last_login_at: now,
            failed_login_count: 0,
            locked_until: null,
          },
          $inc: { session_version: 1 }, // invalidates every existing session
        },
        { new: true, projection: PUBLIC_USER_FIELDS },
      )
      .lean();
    if (!user) throw Errors.accountSuspended();

    const revoked = await this.refreshTokens.updateMany(
      { user_id: user._id, revoked_at: null },
      { $set: { revoked_at: now, revoke_reason: 'PASSWORD_RESET', expires_at: purgeAt() } },
    );
    await this.audit.recordSafe({
      actorId: user._id,
      action: 'auth.password_reset',
      entity: 'user',
      entityId: user._id,
      meta: { sessionsRevoked: revoked.modifiedCount },
      ip: ctx.ip,
    });
    return this.startSession(user, ctx);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────
  private async startSession(user: PublicUserDoc, ctx: ClientCtx, familyId?: string): Promise<SessionResult> {
    const refreshToken = await this.tokens.createRefresh(user._id, user.session_version, ctx, familyId);
    return { ...this.accessFor(user), refreshToken };
  }

  private accessFor(user: PublicUserDoc) {
    return {
      accessToken: this.tokens.signAccess(user),
      expiresIn: env.JWT_ACCESS_TTL,
      user: toPublicUser(user),
    };
  }

  /**
   * Issue a fresh access token from the refresh cookie. Returns user too, so the SPA restores a
   * session in one round trip.
   *
   * The refresh token itself is rotated at most once per REFRESH_ROTATE_AFTER. Page reloads and
   * the 14-min background refresh inside that window are a single indexed read + user read —
   * no write, no new row. Trade-off: replay of a stolen cookie within the window isn't detected.
   */
  async refresh(raw: string | undefined, ctx: ClientCtx): Promise<SessionResult> {
    if (!raw) throw Errors.unauthorized('NO_SESSION');
    const now = new Date();

    const token = await this.refreshTokens
      .findOne({ token_hash: this.tokens.hashRefresh(raw) })
      .select('user_id family_id sv revoked_at revoke_reason expires_at created_at')
      .lean();
    if (!token || token.expires_at <= now) {
      throw Errors.unauthorized('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
    }

    if (token.revoked_at) {
      if (token.revoke_reason === 'ROTATED' && now.getTime() - token.revoked_at.getTime() < env.REFRESH_REUSE_GRACE * 1000) {
        // Another tab just rotated this token. Hand out an access token but no new cookie —
        // the browser already holds the winner's cookie.
        return this.accessFor(await this.loadSessionUser(token.user_id, token.sv));
      }
      if (token.revoke_reason === 'ROTATED') {
        // A rotated token came back after the grace window → likely stolen. Kill the whole family.
        await this.refreshTokens.updateMany(
          { family_id: token.family_id, revoked_at: null },
          { $set: { revoked_at: now, revoke_reason: 'REUSE_DETECTED', expires_at: purgeAt() } },
        );
        await this.audit.recordSafe({
          action: 'auth.refresh_reuse_detected',
          entity: 'user',
          entityId: token.user_id,
          meta: { familyId: token.family_id, userAgent: ctx.userAgent },
          ip: ctx.ip,
        });
      }
      throw Errors.unauthorized('SESSION_REVOKED', 'Your session has ended. Please log in again.');
    }

    const user = await this.loadSessionUser(token.user_id, token.sv);

    // Still young → keep the same refresh token (no cookie change).
    if (now.getTime() - token.created_at.getTime() < env.REFRESH_ROTATE_AFTER * 1000) {
      return this.accessFor(user);
    }

    // Old enough → rotate. Conditional update so only one concurrent request wins.
    const claimed = await this.refreshTokens.updateOne(
      { _id: token._id, revoked_at: null },
      { $set: { revoked_at: now, revoke_reason: 'ROTATED', expires_at: purgeAt() } },
    );
    if (claimed.modifiedCount !== 1) return this.accessFor(user); // lost the race to another tab
    return this.startSession(user, ctx, token.family_id);
  }

  private async loadSessionUser(userId: Types.ObjectId, sv: number) {
    const user = await this.users.findById(userId).select(PUBLIC_USER_FIELDS).lean();
    if (!user || user.status === 'SUSPENDED' || user.session_version !== sv) {
      throw Errors.unauthorized('SESSION_REVOKED', 'Your session has ended. Please log in again.');
    }
    return user;
  }

  /**
   * Sign a user out everywhere, effective immediately for refresh and within one access-token TTL
   * for API calls. Use for role removal and suspension; pass `session` to make it part of the
   * same transaction as the change. Returns the number of sessions ended.
   */
  async revokeAllSessions(
    userId: Types.ObjectId | string,
    reason: 'ROLE_CHANGED' | 'SUSPENDED' | 'PASSWORD_RESET',
    session?: ClientSession,
  ): Promise<number> {
    await this.users.updateOne({ _id: userId }, { $inc: { session_version: 1 } }, { session });
    const r = await this.refreshTokens.updateMany(
      { user_id: userId, revoked_at: null },
      { $set: { revoked_at: new Date(), revoke_reason: reason, expires_at: purgeAt() } },
      { session },
    );
    return r.modifiedCount;
  }

  async logout(raw: string | undefined) {
    if (!raw) return;
    const t = await this.refreshTokens.findOne({ token_hash: this.tokens.hashRefresh(raw) }).select('family_id').lean();
    if (t) {
      await this.refreshTokens.updateMany(
        { family_id: t.family_id, revoked_at: null },
        { $set: { revoked_at: new Date(), revoke_reason: 'LOGOUT', expires_at: purgeAt() } },
      );
    }
  }

  async me(userId: string) {
    const user = await this.users.findById(userId).select(PUBLIC_USER_FIELDS).lean();
    if (!user || user.status === 'SUSPENDED') throw Errors.unauthorized();
    return toPublicUser(user);
  }
}
