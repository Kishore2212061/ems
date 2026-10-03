import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/decorators';
import { env, isDeployed } from '../config/env';
import { PublicUserDoc } from '../users/user.schema';
import { OtpPurpose } from './schemas/otp-code.schema';
import { REFRESH_TOKEN_MODEL, RefreshToken } from './schemas/refresh-token.schema';

export const REFRESH_COOKIE = 'ems_rt';

export interface ClientCtx {
  ip: string;
  userAgent?: string;
}

export const hmac = (key: string, value: string) => createHmac('sha256', key).update(value).digest('base64url');

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @InjectModel(REFRESH_TOKEN_MODEL) private readonly refreshTokens: Model<RefreshToken>,
  ) {}

  /** Compact claims keep the Authorization header small on every request. */
  signAccess(u: Pick<PublicUserDoc, '_id' | 'roles' | 'session_version'>) {
    const claims: Omit<AuthUser, 'id'> = {
      roles: u.roles.map((r) => ({ r: r.role, st: r.scope_type, sid: r.scope_id ? String(r.scope_id) : null })),
      sv: u.session_version,
    };
    return this.jwt.sign(claims, { subject: String(u._id), audience: 'access', expiresIn: env.JWT_ACCESS_TTL });
  }

  verifyAccess(token: string): AuthUser {
    const p = this.jwt.verify(token, { audience: 'access' });
    return { id: p.sub, roles: p.roles, sv: p.sv };
  }

  /** Proves the password step was passed; required by verify-otp / resend-otp. */
  signOtpToken(userId: Types.ObjectId, purpose: OtpPurpose) {
    return this.jwt.sign({ pur: purpose }, { subject: String(userId), audience: 'otp', expiresIn: '20m' });
  }

  verifyOtpToken(token: string): { userId: string; purpose: OtpPurpose } | null {
    try {
      const p = this.jwt.verify(token, { audience: 'otp' });
      return { userId: p.sub, purpose: p.pur };
    } catch {
      return null;
    }
  }

  hashRefresh(raw: string) {
    return hmac(env.JWT_REFRESH_SECRET, raw);
  }

  /** Opaque 256-bit token; only its HMAC is stored. */
  async createRefresh(userId: Types.ObjectId, sv: number, ctx: ClientCtx, familyId: string = randomUUID()) {
    const raw = randomBytes(32).toString('base64url');
    await this.refreshTokens.create({
      user_id: userId,
      family_id: familyId,
      token_hash: this.hashRefresh(raw),
      sv,
      expires_at: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000),
      ip: ctx.ip,
      user_agent: ctx.userAgent?.slice(0, 256),
    });
    return raw;
  }

  cookieOptions(): CookieSerializeOptions {
    return {
      httpOnly: true,
      secure: isDeployed,
      // Frontend and API share one origin (nginx / Vite proxy), so Strict works and blocks CSRF.
      sameSite: 'strict',
      // Only sent to auth endpoints — not on every API call.
      path: '/api/v1/auth',
      maxAge: env.JWT_REFRESH_TTL,
    };
  }
}
