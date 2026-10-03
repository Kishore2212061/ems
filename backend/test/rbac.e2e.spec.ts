import { Controller, Get, Param } from '@nestjs/common';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { TokenService } from '../src/auth/token.service';
import { type AuthUser, CurrentUser } from '../src/common/decorators';
import { RbacService } from '../src/rbac/rbac.service';
import { RequirePermission } from '../src/rbac/require-permission.decorator';
import { createTestApp, type TestApp } from './helpers/app';
import { client, signupVerified } from './helpers/client';

/** Test-only routes that exercise the real guard + RbacService exactly like feature modules will. */
@Controller('__test/rbac')
class RbacProbeController {
  constructor(private readonly rbac: RbacService) {}

  @Get('console')
  @RequirePermission('admin.access')
  console() {
    return { ok: true };
  }

  @Get('fests')
  @RequirePermission('global_event.read')
  list(@CurrentUser() u: AuthUser) {
    return this.rbac.scopeFilter(u, 'global_event.read', { globalEventId: '_id' });
  }

  @Get('fests/:id/edit')
  @RequirePermission('global_event.update')
  edit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    this.rbac.assertCan(u, 'global_event.update', { globalEventId: id });
    return { ok: true };
  }
}

let t: TestApp;
let tokenFor: (...roles: [string, string, string | null][]) => string;
beforeAll(async () => {
  t = await createTestApp({ controllers: [RbacProbeController] });
  const tokens = t.app.get(TokenService);
  tokenFor = (...roles) =>
    tokens.signAccess({
      _id: new Types.ObjectId(),
      session_version: 0,
      roles: roles.map(([role, scope_type, sid]) => ({
        role,
        scope_type,
        scope_id: sid ? new Types.ObjectId(sid) : null,
        granted_at: new Date(),
        granted_by: null,
      })) as any,
    });
});
afterAll(async () => {
  await t?.close();
});

const X = new Types.ObjectId().toHexString();
const Y = new Types.ObjectId().toHexString();

describe('permission guard', () => {
  it('401 without a token, before any permission check', async () => {
    expect((await client(t.app).get('/__test/rbac/console')).body.code).toBe('UNAUTHORIZED');
  });

  it('403 naming the missing permission for a participant', async () => {
    const r = await client(t.app).get('/__test/rbac/console', { token: tokenFor(['PARTICIPANT', 'ORG', null]) });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'admin.access' } });
  });

  it('lets any admin-type role into the console', async () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'FINANCE'] as const) {
      expect((await client(t.app).get('/__test/rbac/console', { token: tokenFor([role, 'ORG', null]) })).status).toBe(200);
    }
    expect((await client(t.app).get('/__test/rbac/console', { token: tokenFor(['SCANNER', 'ORG', null]) })).status).toBe(403);
  });

  it('enforces resource scope in the handler', async () => {
    const token = tokenFor(['ADMIN', 'GLOBAL_EVENT', X]);
    expect((await client(t.app).get(`/__test/rbac/fests/${X}/edit`, { token })).status).toBe(200);
    const other = await client(t.app).get(`/__test/rbac/fests/${Y}/edit`, { token });
    expect(other.status).toBe(403);
  });

  it('builds a list filter limited to the caller’s scopes', async () => {
    const scoped = await client(t.app).get('/__test/rbac/fests', { token: tokenFor(['ADMIN', 'GLOBAL_EVENT', X]) });
    expect(scoped.body).toEqual({ _id: { $in: [X] } });
    const all = await client(t.app).get('/__test/rbac/fests', { token: tokenFor(['FINANCE', 'ORG', null]) });
    expect(all.body).toEqual({});
  });
});

describe('last Super Admin invariant', () => {
  const users = () => t.conn.collection('users');
  const rbac = () => t.app.get(RbacService);

  async function makeSuperAdmin(email: string) {
    const _id = new Types.ObjectId();
    await users().insertOne({
      _id,
      email,
      full_name: email,
      password_hash: 'x',
      status: 'ACTIVE',
      first_login_otp_done: true,
      session_version: 0,
      roles: [{ role: 'SUPER_ADMIN', scope_type: 'ORG', scope_id: null, granted_at: new Date(), granted_by: null }],
    });
    return _id;
  }

  /** The pattern Module 2 will use: change, then ensureSuperAdminRemains, in one transaction. */
  async function demote(userId: Types.ObjectId) {
    const session = await t.conn.startSession();
    try {
      await session.withTransaction(async () => {
        await users().updateOne({ _id: userId }, { $pull: { roles: { role: 'SUPER_ADMIN' } } } as any, { session });
        await rbac().ensureSuperAdminRemains(session);
      });
      return 'ok';
    } catch (e: any) {
      return e.code ?? e.message;
    } finally {
      await session.endSession();
    }
  }

  it('refuses to remove the only active Super Admin and rolls the change back', async () => {
    await users().updateMany({ 'roles.role': 'SUPER_ADMIN' }, { $set: { status: 'SUSPENDED' } });
    const solo = await makeSuperAdmin('solo@test.local');
    expect(await demote(solo)).toBe('LAST_SUPER_ADMIN');
    expect((await users().findOne({ _id: solo }))!.roles[0].role).toBe('SUPER_ADMIN');
    await users().deleteOne({ _id: solo });
  });

  it('two admins demoting each other at the same instant leave exactly one', async () => {
    await users().updateMany({ 'roles.role': 'SUPER_ADMIN' }, { $set: { status: 'SUSPENDED' } });
    const a = await makeSuperAdmin('a@test.local');
    const b = await makeSuperAdmin('b@test.local');

    const results = await Promise.all([demote(a), demote(b)]);
    expect(results.sort()).toEqual(['LAST_SUPER_ADMIN', 'ok']);
    const active = await users().countDocuments({ status: 'ACTIVE', 'roles.role': 'SUPER_ADMIN' });
    expect(active).toBe(1);
  });
});

describe('revokeAllSessions', () => {
  it('signs the user out on every device and makes old tokens fail refresh', async () => {
    const phone = client(t.app);
    const { user } = await signupVerified(phone, t.lastOtp);
    const laptop = client(t.app);
    await laptop.post('/auth/login', { email: user.email, password: 'Passw0rd123' });

    const ended = await t.app.get(AuthService).revokeAllSessions(user.id, 'ROLE_CHANGED');
    expect(ended).toBe(2);
    expect((await phone.post('/auth/refresh')).body.code).toBe('SESSION_REVOKED');
    expect((await laptop.post('/auth/refresh')).body.code).toBe('SESSION_REVOKED');
  });
});
