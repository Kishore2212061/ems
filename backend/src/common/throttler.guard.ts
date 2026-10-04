import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/** `sub` from a JWT payload without verifying it — only used to pick a rate-limit bucket. */
function jwtSubject(token: string): string | undefined {
  const part = token.split('.')[1];
  if (!part || part.length > 2000) return undefined;
  try {
    const sub = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))?.sub;
    return typeof sub === 'string' ? sub.slice(0, 64) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `sub` of a Bearer access token whose HS256 signature checks out. This guard runs before the JWT
 * guard, so it verifies the signature itself (one HMAC, microseconds): a forged token can't pick
 * its own bucket to dodge the per-IP limit. Expiry isn't checked: it only selects a bucket.
 */
function bearerSubject(header: unknown): string | undefined {
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 4000) return undefined;
  const token = header.slice(7);
  const dot = token.lastIndexOf('.');
  if (dot < 0) return undefined;
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(createHmac('sha256', env.JWT_ACCESS_SECRET).update(token.slice(0, dot)).digest('base64url'));
  return sig.length === expected.length && timingSafeEqual(sig, expected) ? jwtSubject(token) : undefined;
}

/**
 * Campus networks put hundreds of students behind one NAT IP, so pure per-IP limits would lock
 * out a whole college during a registration rush. Buckets are therefore per IP + person:
 *  - login / signup / forgot-password → the email in the body
 *  - verify-otp / resend-otp / reset-password → the user id inside the otpToken
 *    (a forged token only gets its own bucket and still fails signature verification; code
 *    guessing is separately capped by OTP_MAX_ATTEMPTS per code in the database)
 *  - signed-in requests → the user id in the (signature-checked) access token, so a registration
 *    rush from one campus IP is limited per student, not per campus
 *  - everything else → IP (with a generous global limit)
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const user = bearerSubject(req.headers?.authorization);
    if (user) return `${req.ip}|u:${user}`;
    const body = req.body;
    if (typeof body?.email === 'string') return `${req.ip}|e:${body.email.trim().toLowerCase()}`;
    if (typeof body?.otpToken === 'string') {
      const sub = jwtSubject(body.otpToken);
      if (sub) return `${req.ip}|u:${sub}`;
    }
    return req.ip;
  }
}
