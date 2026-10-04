import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client, signupVerified } from './helpers/client';
import { expectIndexed } from './helpers/explain';

let t: TestApp;
let audit: AuditService;
beforeAll(async () => {
  t = await createTestApp();
  audit = t.app.get(AuditService);
});
afterAll(async () => {
  await t?.close();
});

const logs = () => t.conn.collection('audit_logs');

describe('audit log', () => {
  it('records the seeded Super Admin', async () => {
    expect(await logs().findOne({ action: 'system.super_admin_seeded' })).toMatchObject({
      actor_id: null,
      entity: 'user',
      after: { email: 'root@test.local' },
    });
  });

  it('seeds the Super Admin as a participant too, and backfills older seeded accounts once', async () => {
    const users = t.conn.collection('users');
    const roles = async () => (await users.findOne({ email: 'root@test.local' }))!.roles.map((r: any) => r.role);
    expect(await roles()).toEqual(['PARTICIPANT', 'SUPER_ADMIN']);

    await users.updateOne({ email: 'root@test.local' }, { $pull: { roles: { role: 'PARTICIPANT' } } } as any); // pre-fix shape
    const { SeedService } = await import('../src/seed/seed.service');
    const seed = t.app.get(SeedService);
    await seed.onApplicationBootstrap();
    await seed.onApplicationBootstrap(); // idempotent
    expect(await roles()).toEqual(['PARTICIPANT', 'SUPER_ADMIN']);
    expect(await logs().countDocuments({ action: 'system.super_admin_seeded' })).toBe(1);
  });

  it('redacts secrets before writing', async () => {
    await audit.record({ action: 'test.redaction', entity: 'user', entityId: 'u1', after: { name: 'x', password: 'hunter2' } });
    expect((await logs().findOne({ action: 'test.redaction' }))!.after).toEqual({ name: 'x', password: '[redacted]' });
  });

  it('commits together with its transaction', async () => {
    const session = await t.conn.startSession();
    await session.withTransaction(() => audit.record({ action: 'test.tx_commit', entity: 'x' }, session));
    await session.endSession();
    expect(await logs().countDocuments({ action: 'test.tx_commit' })).toBe(1);
  });

  it('rolls back together with its transaction', async () => {
    const session = await t.conn.startSession();
    await expect(
      session.withTransaction(async () => {
        await audit.record({ action: 'test.tx_rollback', entity: 'x' }, session);
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    await session.endSession();
    expect(await logs().countDocuments({ action: 'test.tx_rollback' })).toBe(0);
  });

  it('records account lockout with the client IP', async () => {
    const c = client(t.app, { ip: '10.7.7.7' });
    const { email, user } = await signupVerified(c, t.lastOtp);
    for (let i = 0; i < 5; i++) await c.post('/auth/login', { email, password: 'Wrong12345' });
    expect(await logs().findOne({ action: 'auth.account_locked', entity_id: user.id })).toMatchObject({
      ip: '10.7.7.7',
      meta: { failedAttempts: 5, lockMinutes: 15 },
    });
  });

  it('records password resets with the number of sessions revoked', async () => {
    const c = client(t.app);
    const { email, user } = await signupVerified(c, t.lastOtp);
    const f = await c.post('/auth/forgot-password', { email });
    await c.post('/auth/reset-password', { otpToken: f.body.otpToken, code: await t.lastOtp(email), password: 'BrandNew456' });
    const row = await logs().findOne({ action: 'auth.password_reset', entity_id: user.id });
    expect(row).toMatchObject({ meta: { sessionsRevoked: 1 } });
    expect(String(row!.actor_id)).toBe(user.id);
  });

  it('serves its read patterns from indexes', async () => {
    const m = t.conn.model('AuditLog');
    await expectIndexed(m.find({ entity: 'user', entity_id: 'x' }).sort({ at: -1 }));
    await expectIndexed(m.find({ actor_id: null }).sort({ at: -1 }));
    await expectIndexed(m.find({ action: 'auth.password_reset' }).sort({ at: -1 }));
    await expectIndexed(m.find({}).sort({ at: -1 }).limit(50));
  });
});
