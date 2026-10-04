import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { client, signupVerified, uniqueEmail } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let dept: Record<string, string>;
let fest: { id: string; name: string };

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  dept = Object.fromEntries((await client(t.app).get('/departments')).body.map((d: any) => [d.code, d.id]));
  fest = (await root.c.post('/admin/global-events', { name: 'People Fest', editionYear: 2027 }, { token: root.token })).body;
});
afterAll(async () => {
  await t?.close();
});

/** Pull the raw invite token out of the last invite email to `email`. */
async function inviteToken(email: string) {
  await t.lastOtp(email).catch(() => {}); // drains the email queue
  const mail = [...t.outbox].reverse().find((m) => m.to === email && m.subject.startsWith('Invitation'));
  if (!mail) throw new Error(`no invite email to ${email}`);
  return /accept-invite\/([A-Za-z0-9_-]+)/.exec(mail.text)![1];
}

describe('profile', () => {
  it('updates name/phone/college and keeps search field in sync', async () => {
    const c = client(t.app);
    const { token, user } = await signupVerified(c, t.lastOtp);
    const r = await c.patch('/me/profile', { fullName: 'Divya Raman', phone: '+91 91234 56789' }, { token });
    expect(r.body).toMatchObject({ fullName: 'Divya Raman', phone: '9123456789' });
    expect((await t.conn.collection('users').findOne({ email: user.email }))!.full_name_lc).toBe('divya raman');
    expect((await c.patch('/me/profile', { phone: '123' }, { token })).body.code).toBe('VALIDATION_ERROR');
  });
});

describe('password & sessions', () => {
  it('change password keeps this device signed in and signs out every other one', async () => {
    const laptop = client(t.app);
    const { email, password, token } = await signupVerified(laptop, t.lastOtp);
    const phone = client(t.app);
    await phone.post('/auth/login', { email, password });

    expect((await laptop.post('/auth/change-password', { currentPassword: 'Wrong1234', newPassword: 'Fresh9876' }, { token })).body.details.fields.currentPassword).toBe('Incorrect password');
    const r = await laptop.post('/auth/change-password', { currentPassword: password, newPassword: 'Fresh9876' }, { token });
    expect(r.status).toBe(200);
    expect((await laptop.post('/auth/refresh')).status).toBe(200); // this device continues
    expect((await phone.post('/auth/refresh')).body.code).toBe('SESSION_REVOKED');
    expect((await laptop.post('/auth/login', { email, password })).status).toBe(401);
    expect(await t.conn.collection('audit_logs').countDocuments({ action: 'auth.password_changed' })).toBeGreaterThan(0);
  });

  it('lists sessions, marks the current one, and signs out others', async () => {
    const a = client(t.app);
    const { email, password, token } = await signupVerified(a, t.lastOtp);
    const b = client(t.app);
    await b.post('/auth/login', { email, password });
    const c = client(t.app);
    await c.post('/auth/login', { email, password });

    const list = (await a.get('/auth/sessions', { token })).body;
    expect(list).toHaveLength(3);
    expect(list.filter((s: any) => s.current)).toHaveLength(1);

    const other = list.find((s: any) => !s.current);
    expect((await a.del(`/auth/sessions/${other.id}`, { token })).status).toBe(204);
    expect((await a.post('/auth/sessions/revoke-others', {}, { token })).body.ended).toBe(1);
    expect((await b.post('/auth/refresh')).body.code).toBe('SESSION_REVOKED');
    expect((await c.post('/auth/refresh')).body.code).toBe('SESSION_REVOKED');
    expect((await a.post('/auth/refresh')).status).toBe(200);
  });
});

describe('user directory', () => {
  it('Super Admin searches by email or name prefix; scoped admins get nothing; participants 403', async () => {
    await makeUser(t, [], { email: 'kavya.s@nec.edu.in', name: 'Kavya Sundar' });
    const byEmail = await root.c.get('/admin/users?q=kavya.s@', { token: root.token });
    expect(byEmail.body.items.map((u: any) => u.email)).toEqual(['kavya.s@nec.edu.in']);
    const byName = await root.c.get('/admin/users?q=Kavya Sun', { token: root.token });
    expect(byName.body.items.map((u: any) => u.fullName)).toEqual(['Kavya Sundar']);

    const scoped = await makeUser(t, [['ADMIN', 'GLOBAL_EVENT', fest.id, fest.name]]);
    expect((await scoped.c.get('/admin/users', { token: scoped.token })).body.items).toEqual([]);
    const p = await makeUser(t, []);
    expect((await p.c.get('/admin/users', { token: p.token })).status).toBe(403);
  });

  it('paginates with a cursor', async () => {
    const page1 = await root.c.get('/admin/users?limit=2', { token: root.token });
    expect(page1.body.items).toHaveLength(2);
    const page2 = await root.c.get(`/admin/users?limit=2&cursor=${page1.body.nextCursor}`, { token: root.token });
    expect(page2.body.items[0].id).not.toBe(page1.body.items[1].id);
  });
});

describe('roles', () => {
  it('grants a scoped role with a label; the user sees it on next refresh; duplicates rejected', async () => {
    const u = await makeUser(t, []);
    const grant = { role: 'ADMIN', scopeType: 'DEPARTMENT', scopeId: dept.CSE };
    const r = await root.c.post(`/admin/users/${u.id}/roles`, grant, { token: root.token });
    expect(r.body.roles).toContainEqual({ role: 'ADMIN', scopeType: 'DEPARTMENT', scopeId: dept.CSE, scopeLabel: 'CSE' });
    expect((await root.c.post(`/admin/users/${u.id}/roles`, grant, { token: root.token })).body.code).toBe('ROLE_EXISTS');
    expect((await u.c.post('/auth/refresh')).body.user.roles.map((x: any) => x.role)).toContain('ADMIN');
  });

  it('rejects impossible role/scope combinations', async () => {
    const u = await makeUser(t, []);
    const bad = [
      { role: 'SUPER_ADMIN', scopeType: 'DEPARTMENT', scopeId: dept.CSE },
      { role: 'ADMIN', scopeType: 'GLOBAL_EVENT' }, // missing id
      { role: 'SCANNER', scopeType: 'ORG' },
    ];
    for (const g of bad) expect((await root.c.post(`/admin/users/${u.id}/roles`, g, { token: root.token })).status).toBe(400);
  });

  it('revoking a role signs the user out immediately', async () => {
    const u = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.IT, 'IT']]);
    const r = await root.c.post(`/admin/users/${u.id}/roles/revoke`, { role: 'ADMIN', scopeType: 'DEPARTMENT', scopeId: dept.IT }, { token: root.token });
    expect(r.status).toBe(200);
    expect(r.body.roles.map((x: any) => x.role)).toEqual(['PARTICIPANT']);
    expect((await u.c.post('/auth/refresh')).body.code).toBe('SESSION_REVOKED');
  });

  it('only a Super Admin can change roles', async () => {
    const admin = await makeUser(t, [['ADMIN', 'ORG']]);
    const u = await makeUser(t, []);
    expect((await admin.c.post(`/admin/users/${u.id}/roles`, { role: 'ADMIN', scopeType: 'ORG' }, { token: admin.token })).status).toBe(403);
  });
});

describe('suspension', () => {
  it('suspends (sessions end, login blocked) and reactivates; cannot suspend self', async () => {
    const u = await makeUser(t, []);
    expect((await root.c.post(`/admin/users/${root.id}/suspend`, {}, { token: root.token })).body.code).toBe('CANNOT_SUSPEND_SELF');
    expect((await root.c.post(`/admin/users/${u.id}/suspend`, {}, { token: root.token })).body.status).toBe('SUSPENDED');
    expect((await u.c.post('/auth/refresh')).body.code).toBe('SESSION_REVOKED');
    expect((await u.c.post('/auth/login', { email: u.email, password: u.password })).body.code).toBe('ACCOUNT_SUSPENDED');
    expect((await root.c.post(`/admin/users/${u.id}/reactivate`, {}, { token: root.token })).body.status).toBe('ACTIVE');
    expect((await u.c.post('/auth/login', { email: u.email, password: u.password })).status).toBe(200);
  });
});

describe('invites', () => {
  it('new person: invite → email → preview → accept with password → signed in with the role', async () => {
    const email = uniqueEmail('newstaff');
    const r = await root.c.post('/admin/invites', { email, role: 'ADMIN', scopeType: 'GLOBAL_EVENT', scopeId: fest.id }, { token: root.token });
    expect(r.body).toMatchObject({ email, role: 'ADMIN', scopeLabel: 'People Fest', status: 'PENDING' });
    const tok = await inviteToken(email);

    const anon = client(t.app);
    expect((await anon.get(`/auth/invites/${tok}`)).body).toMatchObject({ email, role: 'ADMIN', scopeLabel: 'People Fest', accountExists: false });
    expect((await anon.post(`/auth/invites/${tok}/accept`, {})).body.details.fields).toHaveProperty('password');
    const acc = await anon.post(`/auth/invites/${tok}/accept`, { fullName: 'Meena Iyer', password: 'Welcome123' });
    expect(acc.body.status).toBe('SIGNED_IN');
    expect(acc.body.user.roles.map((x: any) => `${x.role}:${x.scopeLabel}`)).toEqual(['PARTICIPANT:null', 'ADMIN:People Fest']);
    expect(anon.jar.ems_rt).toBeDefined();

    expect((await client(t.app).post(`/auth/invites/${tok}/accept`, { fullName: 'X Y', password: 'Again1234' })).body.code).toBe('INVITE_USED');
  });

  it('existing account: role added without touching the password or creating a duplicate', async () => {
    const u = await makeUser(t, []);
    await root.c.post('/admin/invites', { email: u.email, role: 'FINANCE', scopeType: 'ORG' }, { token: root.token });
    const tok = await inviteToken(u.email);
    expect((await client(t.app).get(`/auth/invites/${tok}`)).body.accountExists).toBe(true);
    expect((await client(t.app).post(`/auth/invites/${tok}/accept`, {})).body).toEqual({ status: 'ROLE_ADDED', email: u.email });
    expect(await t.conn.collection('users').countDocuments({ email: u.email })).toBe(1);
    expect((await u.c.post('/auth/login', { email: u.email, password: u.password })).body.user.roles.map((x: any) => x.role)).toContain('FINANCE');
  });

  it('an unverified squatter account is taken over by the real invitee (squatter password stops working)', async () => {
    const email = uniqueEmail('victim');
    await client(t.app).post('/auth/signup', { fullName: 'Squatter', email, phone: '9876543210', college: 'X', password: 'Squatter123' });
    await root.c.post('/admin/invites', { email, role: 'ADMIN', scopeType: 'ORG' }, { token: root.token });
    const tok = await inviteToken(email);
    expect((await client(t.app).get(`/auth/invites/${tok}`)).body.accountExists).toBe(false);
    const acc = await client(t.app).post(`/auth/invites/${tok}/accept`, { fullName: 'Real Owner', password: 'RealOwner123' });
    expect(acc.body.status).toBe('SIGNED_IN');
    expect((await client(t.app).post('/auth/login', { email, password: 'Squatter123' })).status).toBe(401);
    expect((await client(t.app).post('/auth/login', { email, password: 'RealOwner123' })).body.user.fullName).toBe('Real Owner');
  });

  it('expired, revoked and unknown links are refused', async () => {
    const email = uniqueEmail('late');
    const inv = (await root.c.post('/admin/invites', { email, role: 'ADMIN', scopeType: 'ORG' }, { token: root.token })).body;
    const tok = await inviteToken(email);
    await t.conn.collection('admin_invites').updateOne({ email }, { $set: { expires_at: new Date(Date.now() - 1000) } });
    expect((await client(t.app).get(`/auth/invites/${tok}`)).body.code).toBe('INVITE_EXPIRED');

    await t.conn.collection('admin_invites').updateOne({ email }, { $set: { expires_at: new Date(Date.now() + 3600_000) } });
    expect((await root.c.del(`/admin/invites/${inv.id}`, { token: root.token })).status).toBe(204);
    expect((await client(t.app).get(`/auth/invites/${tok}`)).body.code).toBe('INVITE_REVOKED');
    expect((await client(t.app).get(`/auth/invites/${'x'.repeat(43)}`)).status).toBe(404);
  });

  it('re-inviting replaces the pending invite (old link dies); resend has a cooldown', async () => {
    const email = uniqueEmail('again');
    const first = (await root.c.post('/admin/invites', { email, role: 'ADMIN', scopeType: 'ORG' }, { token: root.token })).body;
    const oldTok = await inviteToken(email);
    const second = (await root.c.post('/admin/invites', { email, role: 'ADMIN', scopeType: 'ORG' }, { token: root.token })).body;
    expect(second.id).toBe(first.id);
    expect((await client(t.app).get(`/auth/invites/${oldTok}`)).status).toBe(404);
    expect((await root.c.post(`/admin/invites/${first.id}/resend`, {}, { token: root.token })).body.code).toBe('RESEND_COOLDOWN');
  });

  it("scoped admins can only invite ADMIN/SCANNER into their own scope, and see only their invites", async () => {
    const cseAdmin = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);
    const festAdmin = await makeUser(t, [['ADMIN', 'GLOBAL_EVENT', fest.id, fest.name]]);
    const inv = (body: object, who = cseAdmin) => who.c.post('/admin/invites', body, { token: who.token });

    expect((await inv({ email: uniqueEmail('a'), role: 'ADMIN', scopeType: 'DEPARTMENT', scopeId: dept.CSE })).status).toBe(201);
    expect((await inv({ email: uniqueEmail('b'), role: 'ADMIN', scopeType: 'DEPARTMENT', scopeId: dept.MECH })).body.code).toBe('CANNOT_GRANT_ROLE');
    expect((await inv({ email: uniqueEmail('c'), role: 'FINANCE', scopeType: 'ORG' })).body.code).toBe('CANNOT_GRANT_ROLE');
    expect((await inv({ email: uniqueEmail('d'), role: 'SUPER_ADMIN', scopeType: 'ORG' })).body.code).toBe('CANNOT_GRANT_ROLE');
    expect((await inv({ email: uniqueEmail('e'), role: 'SCANNER', scopeType: 'GLOBAL_EVENT', scopeId: fest.id }, festAdmin)).status).toBe(201);

    const mine = (await cseAdmin.c.get('/admin/invites', { token: cseAdmin.token })).body;
    expect(mine.every((i: any) => i.scopeLabel === 'CSE')).toBe(true);
    expect((await root.c.get('/admin/invites', { token: root.token })).body.length).toBeGreaterThan(mine.length);
  });

  it('refuses to invite someone into a role they already hold', async () => {
    const u = await makeUser(t, [['ADMIN', 'ORG']]);
    expect((await root.c.post('/admin/invites', { email: u.email, role: 'ADMIN', scopeType: 'ORG' }, { token: root.token })).body.code).toBe('ROLE_EXISTS');
  });
});

describe('people query plans', () => {
  it('serve directory search + invites from indexes', async () => {
    const U = t.conn.model('User');
    await expectIndexed(U.find({ full_name_lc: /^kav/ }).sort({ _id: -1 }));
    await expectIndexed(U.find({ $or: [{ email: /^kav/ }, { full_name_lc: /^kav/ }] }).sort({ _id: -1 }));
    await expectIndexed(U.find({ 'roles.role': 'ADMIN' }).sort({ _id: -1 }));
    const I = t.conn.model('Invite');
    await expectIndexed(I.findOne({ token_hash: 'x' }), 'token_hash_1');
    await expectIndexed(I.find({ status: 'PENDING' }).sort({ created_at: -1 }), 'status_1_created_at_-1');
    await expectIndexed(I.find({ invited_by: root.id, status: 'PENDING' }).sort({ created_at: -1 }));
  });
});
