import { hash, verify } from '@node-rs/argon2';
import { env } from '../config/env';

// argon2id with OWASP's recommended profile (19 MiB, t=2, p=1): strong, but ~4x less RAM per
// login than 64 MiB — matters when a few hundred students log in at once on a small container.
// @node-rs/argon2 runs off the event loop, so hashing never blocks other requests.
const opts = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  secret: Buffer.from(env.PASSWORD_PEPPER),
};

export const hashPassword = (plain: string) => hash(plain, opts);

export async function verifyPassword(hashed: string, plain: string) {
  try {
    return await verify(hashed, plain, { secret: opts.secret });
  } catch {
    return false;
  }
}

// Verified against when the email doesn't exist, so "no such user" and "wrong password"
// take the same time (prevents account enumeration via timing).
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string) {
  dummy ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummy, plain);
}
