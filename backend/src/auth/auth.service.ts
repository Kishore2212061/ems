import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Errors } from '../common/app-exception';
import { env } from '../config/env';
import { PUBLIC_USER_FIELDS, PublicUserDoc, toPublicUser, User, USER_MODEL } from '../users/user.schema';
import { LoginDto, SignupDto, VerifyOtpDto } from './auth.dto';
import { OtpService } from './otp.service';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { REFRESH_TOKEN_MODEL, RefreshToken } from './schemas/refresh-token.schema';
import { ClientCtx, TokenService } from './token.service';

/** If two tabs refresh simultaneously, the loser presents an already-rotated token within this window. */
const ROTATION_GRACE_MS = 30_000;

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
      await this.recordFailedLogin(user._id);
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

  private async recordFailedLogin(userId: Types.ObjectId) {
    const upd = await this.users
      .findOneAndUpdate({ _id: userId }, { $inc: { failed_login_count: 1 } }, { new: true, projection: 'failed_login_count' })
      .lean();
    if (upd && upd.failed_login_count >= env.LOGIN_MAX_ATTEMPTS) {
      await this.users.updateOne(
        { _id: userId },
        { $set: { failed_login_count: 0, locked_until: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) } },
      );
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
    if (!t) throw Errors.otpSession();

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
    const user = await this.users.findById(t.userId).select('email full_name first_login_otp_done').lean();
    if (!user || user.first_login_otp_done) throw Errors.otpSession();
    const resendAfterSec = await this.otp.issue(user, t.purpose, true);
    return { sent: true, resendAfterSec };
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

  /** Rotate refresh token. Returns user too, so the SPA restores a session in one round trip. */
  async refresh(raw: string | undefined, ctx: ClientCtx): Promise<SessionResult> {
    if (!raw) throw Errors.unauthorized('NO_SESSION');
    const tokenHash = this.tokens.hashRefresh(raw);
    const now = new Date();

    // Atomic claim: exactly one request can rotate a given token.
    const claimed = await this.refreshTokens
      .findOneAndUpdate(
        { token_hash: tokenHash, revoked_at: null, expires_at: { $gt: now } },
        { $set: { revoked_at: now, revoke_reason: 'ROTATED' } },
        { projection: 'user_id family_id sv' },
      )
      .lean();

    if (!claimed) {
      const prev = await this.refreshTokens
        .findOne({ token_hash: tokenHash })
        .select('user_id family_id sv revoked_at revoke_reason')
        .lean();
      if (!prev) throw Errors.unauthorized('SESSION_EXPIRED', 'Your session has expired. Please log in again.');

      const benignRace =
        prev.revoke_reason === 'ROTATED' && prev.revoked_at && now.getTime() - prev.revoked_at.getTime() < ROTATION_GRACE_MS;
      if (benignRace) {
        // Another tab just rotated this token. Hand out an access token but no new cookie —
        // the browser already holds the winner's cookie.
        const user = await this.loadSessionUser(prev.user_id, prev.sv);
        return this.accessFor(user);
      }

      if (prev.revoke_reason === 'ROTATED') {
        // A rotated token came back after the grace window → likely stolen. Kill the whole family.
        await this.refreshTokens.updateMany(
          { family_id: prev.family_id, revoked_at: null },
          { $set: { revoked_at: now, revoke_reason: 'REUSE_DETECTED' } },
        );
      }
      throw Errors.unauthorized('SESSION_REVOKED', 'Your session has ended. Please log in again.');
    }

    const user = await this.loadSessionUser(claimed.user_id, claimed.sv);
    return this.startSession(user, ctx, claimed.family_id);
  }

  private async loadSessionUser(userId: Types.ObjectId, sv: number) {
    const user = await this.users.findById(userId).select(PUBLIC_USER_FIELDS).lean();
    if (!user || user.status === 'SUSPENDED' || user.session_version !== sv) {
      throw Errors.unauthorized('SESSION_REVOKED', 'Your session has ended. Please log in again.');
    }
    return user;
  }

  async logout(raw: string | undefined) {
    if (!raw) return;
    const t = await this.refreshTokens.findOne({ token_hash: this.tokens.hashRefresh(raw) }).select('family_id').lean();
    if (t) {
      await this.refreshTokens.updateMany(
        { family_id: t.family_id, revoked_at: null },
        { $set: { revoked_at: new Date(), revoke_reason: 'LOGOUT' } },
      );
    }
  }

  async me(userId: string) {
    const user = await this.users.findById(userId).select(PUBLIC_USER_FIELDS).lean();
    if (!user || user.status === 'SUSPENDED') throw Errors.unauthorized();
    return toPublicUser(user);
  }
}
