import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * EventSource can't send an Authorization header, so a live stream is opened with a short pass:
 * `<userId>.<festId>.<expiry>.<mac>`, issued to a signed-in user who may read that fest's reports.
 */
const TTL_MS = 60 * 60_000;
const key = () => createHmac('sha256', env.JWT_ACCESS_SECRET).update('live-pass').digest();
const mac = (body: string) => createHmac('sha256', key()).update(body).digest('base64url').slice(0, 32);

export function issueLivePass(userId: string, festId: string, now = Date.now()) {
  const body = `${userId}.${festId}.${(now + TTL_MS).toString(36)}`;
  return { pass: `${body}.${mac(body)}`, expiresIn: TTL_MS / 1000 };
}

export function readLivePass(pass: string, festId: string, now = Date.now()): string | null {
  const parts = pass.split('.');
  if (parts.length !== 4) return null;
  const [userId, fest, exp, sig] = parts;
  const want = Buffer.from(mac(`${userId}.${fest}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (fest !== festId || parseInt(exp, 36) < now) return null;
  return userId;
}
