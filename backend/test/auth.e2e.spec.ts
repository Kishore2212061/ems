import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { client, signupVerified, uniqueEmail } from './helpers/client';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

const signupBody = (email: string, over: Record<string, unknown> = {}) => ({
  fullName: 'Asha Kumar',
  email,
  phone: '+91 98765 43210',
  college: 'National Engineering College',
  password: 'Passw0rd123',
  ...over,
});

describe('health', () => {
  it('reports db up', async () => {
    const r = await client(t.app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', db: 'up' });
  });
});

describe('signup', () => {
  it('creates an unverified participant, emails an OTP, normalises the phone', async () => {
    const c = client(t.app);
    const email = uniqueEmail('signup');
    const r = await c.post('/auth/signup', signupBody(email.toUpperCase()));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ otpRequired: true, email, resendAfterSec: 60 });
    expect(r.body.otpToken).toEqual(expect.any(String));
    expect(await t.lastOtp(email)).toMatch(/^\d{6}$/);

    const user = await t.conn.collection('users').findOne({ email });
    expect(user).toMatchObject({ phone: '9876543210', status: 'PENDING_VERIFICATION', first_login_otp_done: false });
    expect(user!.roles).toEqual([expect.objectContaining({ role: 'PARTICIPANT', scope_type: 'ORG' })]);
    expect(user!.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('returns field-level validation errors', async () => {
    const r = await client(t.app).post('/auth/signup', { fullName: 'A', email: 'bad', phone: '12345678901', college: '', password: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(r.body.details.fields).sort()).toEqual(['college', 'email', 'fullName', 'password', 'phone']);
  });

  it('rejects an email that already has a verified account', async () => {
    const c = client(t.app);
    const { email } = await signupVerified(c, t.lastOtp);
    const r = await c.post('/auth/signup', signupBody(email));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('EMAIL_TAKEN');
  });

  it('lets a never-verified email be signed up again (latest signup wins)', async () => {
    const c = client(t.app);
    const email = uniqueEmail('squat');
    await c.post('/auth/signup', signupBody(email, { password: 'Squatter123' }));
    const r = await c.post('/auth/signup', signupBody(email, { password: 'RealOwner123' }));
    expect(r.status).toBe(201);
    await c.post('/auth/verify-otp', { otpToken: r.body.otpToken, code: await t.lastOtp(email) });
    expect((await c.post('/auth/login', { email, password: 'Squatter123' })).status).toBe(401);
    expect((await c.post('/auth/login', { email, password: 'RealOwner123' })).status).toBe(200);
  });
});

describe('OTP', () => {
  it('counts down attempts, then burns the code after 5 wrong tries', async () => {
    const c = client(t.app);
    const email = uniqueEmail('otp');
    const { body } = await c.post('/auth/signup', signupBody(email));
    const wrong = await t.lastOtp(email) === '000000' ? '111111' : '000000';

    for (let left = 4; left >= 1; left--) {
      const r = await c.post('/auth/verify-otp', { otpToken: body.otpToken, code: wrong });
      expect(r.body).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: left } });
    }
    expect((await c.post('/auth/verify-otp', { otpToken: body.otpToken, code: wrong })).body.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    // Even the right code is useless now.
    expect((await c.post('/auth/verify-otp', { otpToken: body.otpToken, code: await t.lastOtp(email) })).body.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('enforces the resend cooldown', async () => {
    const c = client(t.app);
    const { body } = await c.post('/auth/signup', signupBody(uniqueEmail('cool')));
    const r = await c.post('/auth/resend-otp', { otpToken: body.otpToken });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('OTP_COOLDOWN');
    expect(r.body.details.retryAfterSec).toBeGreaterThan(50);
  });

  it('rejects a tampered OTP token', async () => {
    const r = await client(t.app).post('/auth/verify-otp', { otpToken: 'not.a.jwt', code: '123456' });
    expect(r.body.code).toBe('OTP_SESSION_EXPIRED');
  });

  it('verifying sets a secure HttpOnly, SameSite=Strict refresh cookie scoped to /api/v1/auth', async () => {
    const c = client(t.app);
    const email = uniqueEmail('cookie');
    const { body } = await c.post('/auth/signup', signupBody(email));
    const r = await c.post('/auth/verify-otp', { otpToken: body.otpToken, code: await t.lastOtp(email) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accessToken: expect.any(String), expiresIn: 900, user: { email, emailVerified: true, status: 'ACTIVE' } });
    expect(r.body.refreshToken).toBeUndefined(); // never in JSON
    const cookie = r.setCookies.find((x) => x.name === 'ems_rt')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' });
  });
});

describe('login', () => {
  it('uses password only after first verification', async () => {
    const c = client(t.app);
    const { email, password } = await signupVerified(c, t.lastOtp);
    const r = await c.post('/auth/login', { email, password });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toEqual(expect.any(String));
  });

  it('asks unverified accounts for an OTP', async () => {
    const c = client(t.app);
    const email = uniqueEmail('unverified');
    await c.post('/auth/signup', signupBody(email));
    const r = await c.post('/auth/login', { email, password: 'Passw0rd123' });
    expect(r.body).toMatchObject({ otpRequired: true, email });
  });

  it('gives the same error for unknown email and wrong password', async () => {
    const c = client(t.app);
    const { email } = await signupVerified(c, t.lastOtp);
    const a = await c.post('/auth/login', { email, password: 'Wrong12345' });
    const b = await c.post('/auth/login', { email: uniqueEmail('ghost'), password: 'Wrong12345' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('locks the account after 5 failures, even for the right password', async () => {
    const c = client(t.app);
    const { email, password } = await signupVerified(c, t.lastOtp);
    for (let i = 0; i < 5; i++) expect((await c.post('/auth/login', { email, password: 'Wrong12345' })).status).toBe(401);
    const r = await c.post('/auth/login', { email, password });
    expect(r.status).toBe(423);
    expect(r.body.code).toBe('ACCOUNT_LOCKED');
    expect(r.body.details.retryAfterSec).toBeGreaterThan(800);
  });

  it('rate-limits repeated auth calls per IP+email', async () => {
    const c = client(t.app, { ip: '10.9.9.9' });
    const email = uniqueEmail('flood');
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await c.post('/auth/login', { email, password: 'Whatever123' })).status);
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // A different student behind the same campus IP is unaffected.
    expect((await c.post('/auth/login', { email: uniqueEmail('neighbour'), password: 'Whatever123' })).status).toBe(401);
  });

  it('lets many students behind one campus NAT IP verify OTPs at the same time', async () => {
    const campus = client(t.app, { ip: '10.50.50.50' });
    const results = await Promise.all(
      Array.from({ length: 15 }, () => signupVerified(campus, t.lastOtp).then(() => 'ok', (e) => String(e))),
    );
    expect(results.filter((r) => r !== 'ok')).toEqual([]);
  });
});

describe('session', () => {
  it('protects /me', async () => {
    const c = client(t.app);
    const { token, email } = await signupVerified(c, t.lastOtp);
    expect((await c.get('/auth/me', { token })).body.email).toBe(email);
    expect((await c.get('/auth/me')).body.code).toBe('UNAUTHORIZED');
    expect((await c.get('/auth/me', { token: token + 'x' })).body.code).toBe('TOKEN_INVALID');
  });

  it('refresh inside the rotation window reuses the cookie and writes nothing', async () => {
    const c = client(t.app);
    const { email } = await signupVerified(c, t.lastOtp);
    const before = await t.conn.collection('refresh_tokens').countDocuments();
    const cookie = c.jar.ems_rt;
    for (let i = 0; i < 3; i++) {
      const r = await c.post('/auth/refresh');
      expect(r.status).toBe(200);
      expect(r.body.user.email).toBe(email);
      expect(r.setCookies).toHaveLength(0);
    }
    expect(c.jar.ems_rt).toBe(cookie);
    expect(await t.conn.collection('refresh_tokens').countDocuments()).toBe(before);
  });

  it('logout revokes the session', async () => {
    const c = client(t.app);
    await signupVerified(c, t.lastOtp);
    const cookie = { ems_rt: c.jar.ems_rt };
    expect((await c.post('/auth/logout')).status).toBe(204);
    const r = await c.post('/auth/refresh', {}, { cookies: cookie });
    expect(r.body.code).toBe('SESSION_REVOKED');
  });

  it('refresh without a cookie is rejected', async () => {
    expect((await client(t.app).post('/auth/refresh')).body.code).toBe('NO_SESSION');
  });
});

describe('password reset', () => {
  it('answers identically for unknown emails', async () => {
    const r = await client(t.app).post('/auth/forgot-password', { email: uniqueEmail('nobody') });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ otpRequired: true, resendAfterSec: 60 });
  });

  it('resets the password, signs out other devices, and cannot be replayed via verify-otp', async () => {
    const phone = client(t.app);
    const { email, password } = await signupVerified(phone, t.lastOtp);
    const otherDevice = { ems_rt: phone.jar.ems_rt };

    const laptop = client(t.app);
    const f = await laptop.post('/auth/forgot-password', { email });
    const code = await t.lastOtp(email);
    expect(t.outbox.at(-1)!.subject).toContain('password reset code');

    expect((await laptop.post('/auth/verify-otp', { otpToken: f.body.otpToken, code })).body.code).toBe('OTP_SESSION_EXPIRED');
    const r = await laptop.post('/auth/reset-password', { otpToken: f.body.otpToken, code, password: 'BrandNew456' });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toEqual(expect.any(String));

    expect((await phone.post('/auth/refresh', {}, { cookies: otherDevice })).body.code).toBe('SESSION_REVOKED');
    expect((await laptop.post('/auth/login', { email, password })).status).toBe(401);
    expect((await laptop.post('/auth/login', { email, password: 'BrandNew456' })).status).toBe(200);
  });
});
