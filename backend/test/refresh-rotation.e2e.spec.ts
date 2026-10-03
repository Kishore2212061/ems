import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Short windows so rotation + reuse detection can be exercised in real time.
vi.hoisted(() => {
  process.env.REFRESH_ROTATE_AFTER = '1s';
  process.env.REFRESH_REUSE_GRACE = '1s';
});

import { createTestApp, type TestApp } from './helpers/app';
import { client, signupVerified } from './helpers/client';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('refresh token rotation', () => {
  it('rotates once the token is older than REFRESH_ROTATE_AFTER', async () => {
    const c = client(t.app);
    await signupVerified(c, t.lastOtp);
    const first = c.jar.ems_rt;
    await sleep(1100);
    const r = await c.post('/auth/refresh');
    expect(r.status).toBe(200);
    expect(r.setCookies.find((x) => x.name === 'ems_rt')).toBeDefined();
    expect(c.jar.ems_rt).not.toBe(first);
  });

  it('treats a just-rotated token from another tab as a benign race', async () => {
    const c = client(t.app);
    await signupVerified(c, t.lastOtp);
    const old = { ems_rt: c.jar.ems_rt };
    await sleep(1100);
    await c.post('/auth/refresh'); // tab A rotates
    const r = await c.post('/auth/refresh', {}, { cookies: old }); // tab B, same instant
    expect(r.status).toBe(200);
    expect(r.setCookies).toHaveLength(0);
  });

  it('kills the whole family when a rotated token is replayed after the grace window', async () => {
    const c = client(t.app);
    await signupVerified(c, t.lastOtp);
    const stolen = { ems_rt: c.jar.ems_rt };
    await sleep(1100);
    await c.post('/auth/refresh'); // legit rotation
    await sleep(1100); // grace over

    expect((await c.post('/auth/refresh', {}, { cookies: stolen })).body.code).toBe('SESSION_REVOKED');
    // The legitimate holder is signed out too (family revoked).
    expect((await c.post('/auth/refresh')).body.code).toBe('SESSION_REVOKED');
    expect(await t.conn.collection('audit_logs').countDocuments({ action: 'auth.refresh_reuse_detected' })).toBe(1);
  });
});
