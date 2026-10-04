import { Types } from 'mongoose';
import type { TestApp } from './app';
import { client, uniqueEmail } from './client';

export type RoleTuple = [role: string, scopeType: string, scopeId?: string | null, scopeLabel?: string | null];

/** Insert a verified user with the given roles (bypassing invites) and sign them in. */
export async function makeUser(t: TestApp, roles: RoleTuple[], over: { email?: string; password?: string; name?: string } = {}) {
  const { hashPassword } = await import('../../src/auth/password');
  const email = over.email ?? uniqueEmail('staff');
  const password = over.password ?? 'StaffPass123';
  const name = over.name ?? `Staff ${email.split('@')[0]}`;
  const _id = new Types.ObjectId();
  await t.conn.collection('users').insertOne({
    _id,
    email,
    full_name: name,
    full_name_lc: name.toLowerCase(),
    password_hash: await hashPassword(password),
    status: 'ACTIVE',
    first_login_otp_done: true,
    email_verified_at: new Date(),
    session_version: 0,
    failed_login_count: 0,
    roles: [
      { role: 'PARTICIPANT', scope_type: 'ORG', scope_id: null, scope_label: null, granted_at: new Date(), granted_by: null },
      ...roles.map(([role, scope_type, sid, label]) => ({
        role,
        scope_type,
        scope_id: sid ? new Types.ObjectId(sid) : null,
        scope_label: label ?? null,
        granted_at: new Date(),
        granted_by: null,
      })),
    ],
  });
  const c = client(t.app);
  const r = await c.post('/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
  return { id: String(_id), email, password, name, token: r.body.accessToken as string, c };
}

export const superAdmin = (t: TestApp) => makeUser(t, [['SUPER_ADMIN', 'ORG']]);
