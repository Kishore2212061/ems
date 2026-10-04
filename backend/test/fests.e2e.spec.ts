import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let dept: Record<string, string>; // code → id

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  const r = await client(t.app).get('/departments');
  dept = Object.fromEntries(r.body.map((d: any) => [d.code, d.id]));
});
afterAll(async () => {
  await t?.close();
});

const year = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 4, 30)).toISOString();

/** A fest (plus one live fest-wide event, since a fest can only be published once it has one). */
async function createFest(over: Record<string, unknown> = {}) {
  const r = await root.c.post(
    '/admin/global-events',
    { name: `Fest ${Math.random().toString(36).slice(2, 7)}`, editionYear: 2025, departmentIds: [dept.CSE], startsAt: year(2027, 3, 14), endsAt: year(2027, 3, 15), ...over },
    { token: root.token },
  );
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  await t.conn.collection('local_events').insertOne({
    global_event_id: new Types.ObjectId(r.body.id),
    department_id: null,
    slug: 'opening-ceremony',
    name: 'Opening Ceremony',
    category: 'NON_TECHNICAL',
    status: 'PUBLISHED',
    starts_at: new Date(year(2027, 3, 14)),
  });
  return r.body;
}

describe('departments', () => {
  it('seeds the 9 NEC associations and serves them cacheably', async () => {
    const r = await client(t.app).get('/departments');
    expect(r.body.map((d: any) => d.code)).toEqual(['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL', 'AIDS', 'MBA', 'SH']);
    expect(r.headers['cache-control']).toBe('public, max-age=60');
  });

  it('returns 304 for an unchanged list (ETag)', async () => {
    const first = await client(t.app).get('/departments');
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/departments', headers: { 'if-none-match': first.headers.etag as string } });
    expect(res.statusCode).toBe(304);
  });

  it('only a Super Admin manages the catalogue; duplicate codes are rejected', async () => {
    const admin = await makeUser(t, [['ADMIN', 'ORG']]);
    expect((await admin.c.post('/admin/departments', { code: 'BIO', name: 'Biotech' }, { token: admin.token })).status).toBe(403);
    expect((await root.c.post('/admin/departments', { code: 'bio', name: 'Biotechnology' }, { token: root.token })).body.code).toBe('BIO');
    expect((await root.c.post('/admin/departments', { code: 'BIO', name: 'Again' }, { token: root.token })).body.code).toBe('CODE_TAKEN');
  });

  it('renaming a department updates every fest that embeds it and role labels', async () => {
    const d = (await root.c.post('/admin/departments', { code: 'ARCH', name: 'Architecture' }, { token: root.token })).body;
    const f = await createFest({ departmentIds: [d.id] });
    const deptAdmin = await makeUser(t, [['ADMIN', 'DEPARTMENT', d.id, 'ARCH']]);
    await root.c.patch(`/admin/departments/${d.id}`, { code: 'ARC', name: 'School of Architecture' }, { token: root.token });

    const after = (await root.c.get(`/admin/global-events/${f.id}`, { token: root.token })).body;
    expect(after.departments).toEqual([{ id: d.id, code: 'ARC', name: 'School of Architecture' }]);
    const me = (await deptAdmin.c.post('/auth/refresh')).body.user;
    expect(me.roles.find((r: any) => r.role === 'ADMIN').scopeLabel).toBe('ARC');
  });
});

describe('fests: create & edit', () => {
  it('creates a draft with a slug from name + year and embedded departments', async () => {
    const r = await root.c.post('/admin/global-events', { name: "NEC Tech Fest '25", editionYear: 2025, departmentIds: [dept.CSE, dept.IT] }, { token: root.token });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ slug: 'nec-tech-fest-25', status: 'DRAFT', version: 0 });
    expect(r.body.departments.map((d: any) => d.code)).toEqual(['CSE', 'IT']);
    expect(await t.conn.collection('audit_logs').countDocuments({ action: 'global_event.created', entity_id: r.body.id })).toBe(1);
  });

  it('rejects a duplicate slug, unknown departments and backwards dates', async () => {
    expect((await root.c.post('/admin/global-events', { name: "NEC Tech Fest '25", editionYear: 2025 }, { token: root.token })).body.code).toBe('SLUG_TAKEN');
    expect((await root.c.post('/admin/global-events', { name: 'Ghost Fest', editionYear: 2025, departmentIds: ['0'.repeat(24)] }, { token: root.token })).body.code).toBe('UNKNOWN_DEPARTMENT');
    const r = await root.c.post('/admin/global-events', { name: 'Backwards', editionYear: 2025, startsAt: year(2027, 3, 15), endsAt: year(2027, 3, 14) }, { token: root.token });
    expect(r.body.details.fields.endsAt).toBe('End must be after start');
  });

  it('optimistic locking: a stale save is refused, a fresh one bumps the version', async () => {
    const f = await createFest();
    const ok = await root.c.patch(`/admin/global-events/${f.id}`, { tagline: 'Innovate', version: 0 }, { token: root.token });
    expect(ok.body).toMatchObject({ tagline: 'Innovate', version: 1 });
    const stale = await root.c.patch(`/admin/global-events/${f.id}`, { tagline: 'Overwrite', version: 0 }, { token: root.token });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
  });
});

describe('fests: lifecycle', () => {
  it('cannot publish without departments and dates', async () => {
    const f = await createFest({ departmentIds: [], startsAt: null, endsAt: null });
    const r = await root.c.post(`/admin/global-events/${f.id}/publish`, {}, { token: root.token });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'PUBLISH_REQUIREMENTS', details: { missing: ['departments', 'startsAt', 'endsAt'] } });
  });

  it('several fests can be live at once; drafts stay private', async () => {
    const a = await createFest({ name: 'Tech Fest Live', editionYear: 2027 });
    const b = await createFest({ name: 'Spandana Live', editionYear: 2027, type: 'CULTURAL' });
    const draft = await createFest({ name: 'Secret Draft', editionYear: 2027 });
    for (const f of [a, b]) expect((await root.c.post(`/admin/global-events/${f.id}/publish`, {}, { token: root.token })).body.status).toBe('PUBLISHED');

    const list = (await client(t.app).get('/global-events')).body.map((f: any) => f.slug);
    expect(list).toEqual(expect.arrayContaining([a.slug, b.slug]));
    expect(list).not.toContain(draft.slug);
    expect((await client(t.app).get(`/global-events/${a.slug}`)).body.name).toBe('Tech Fest Live');
    expect((await client(t.app).get(`/global-events/${draft.slug}`)).status).toBe(404);
  });

  it('enforces the state machine', async () => {
    const f = await createFest();
    const go = (action: string, body: object = {}) => root.c.post(`/admin/global-events/${f.id}/${action}`, body, { token: root.token });
    expect((await go('reactivate')).body.code).toBe('INVALID_TRANSITION'); // draft can't be reactivated
    await go('publish');
    expect((await go('suspend', {})).body.code).toBe('VALIDATION_ERROR'); // reason required
    expect((await go('suspend', { reason: 'Venue repair' })).body).toMatchObject({ status: 'SUSPENDED', suspendReason: 'Venue repair' });
    expect((await client(t.app).get(`/global-events/${f.slug}`)).body.suspendReason).toBe('Venue repair'); // still public, with notice
    expect((await go('reactivate')).body).toMatchObject({ status: 'PUBLISHED', suspendReason: null });
    expect((await go('complete')).body.code).toBe('EVENT_NOT_OVER');
  });

  it('a publish can only happen once even if clicked twice', async () => {
    const f = await createFest();
    const [a, b] = await Promise.all([
      root.c.post(`/admin/global-events/${f.id}/publish`, {}, { token: root.token }),
      root.c.post(`/admin/global-events/${f.id}/publish`, {}, { token: root.token }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await t.conn.collection('audit_logs').countDocuments({ action: 'global_event.published', entity_id: f.id })).toBe(1);
  });

  it("clones last year's edition as a draft with shifted dates", async () => {
    const src = await createFest({ name: 'Ideathon 2026', editionYear: 2026, startsAt: year(2026, 3, 14), endsAt: year(2026, 3, 15), departmentIds: [dept.CSE, dept.ECE] });
    const r = await root.c.post(`/admin/global-events/${src.id}/clone`, { editionYear: 2027 }, { token: root.token });
    expect(r.body).toMatchObject({ name: 'Ideathon 2027', slug: 'ideathon-2027', status: 'DRAFT', editionYear: 2027 });
    expect(r.body.startsAt.slice(0, 10)).toBe('2027-03-14');
    expect(r.body.departments.map((d: any) => d.code)).toEqual(['CSE', 'ECE']);
  });
});

describe('fests: scoped access', () => {
  it('a fest-scoped admin sees and edits only their fest; other fests look missing', async () => {
    const mine = await createFest({ name: 'Mine Fest' });
    const other = await createFest({ name: 'Other Fest' });
    const admin = await makeUser(t, [['ADMIN', 'GLOBAL_EVENT', mine.id, 'Mine Fest']]);

    const list = await admin.c.get('/admin/global-events', { token: admin.token });
    expect(list.body.items.map((f: any) => f.id)).toEqual([mine.id]);
    expect(list.body.counts).toEqual({ DRAFT: 1 });
    expect((await admin.c.get(`/admin/global-events/${other.id}`, { token: admin.token })).status).toBe(404);
    expect((await admin.c.patch(`/admin/global-events/${other.id}`, { tagline: 'x', version: 0 }, { token: admin.token })).status).toBe(404);
    expect((await admin.c.patch(`/admin/global-events/${mine.id}`, { tagline: 'Ours', version: 0 }, { token: admin.token })).status).toBe(200);
    // Publishing / creating is Super Admin only.
    expect((await admin.c.post(`/admin/global-events/${mine.id}/publish`, {}, { token: admin.token })).status).toBe(403);
    expect((await admin.c.post('/admin/global-events', { name: 'Nope', editionYear: 2025 }, { token: admin.token })).status).toBe(403);
  });

  it('participants cannot reach the admin API; malformed ids are 404 not 500', async () => {
    const p = await makeUser(t, []);
    expect((await p.c.get('/admin/global-events', { token: p.token })).status).toBe(403);
    expect((await root.c.get('/admin/global-events/not-an-id', { token: root.token })).status).toBe(404);
  });
});

describe('fest query plans', () => {
  it('serve public + admin reads from indexes', async () => {
    const m = t.conn.model('GlobalEvent');
    await expectIndexed(m.find({ status: { $in: ['PUBLISHED', 'SUSPENDED', 'COMPLETED'] } }).sort({ status: 1, starts_at: 1 }), 'status_1_starts_at_1');
    await expectIndexed(m.findOne({ slug: 'x', status: { $in: ['PUBLISHED'] } }), 'slug_1');
    await expectIndexed(m.find({ 'departments.department_id': t.conn.base.Types.ObjectId.createFromHexString(dept.CSE) }));
    await expectIndexed(t.conn.model('Department').find({ active: true }).sort({ active: 1, sort_order: 1 }), 'active_1_sort_order_1');
  });
});

describe('fests: department admins', () => {
  it('see (read-only) every fest their department takes part in', async () => {
    const withCse = await createFest({ name: 'Has CSE', departmentIds: [dept.CSE, dept.IT] });
    const withoutCse = await createFest({ name: 'No CSE', departmentIds: [dept.MECH] });
    const cseAdmin = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);

    const ids = (await cseAdmin.c.get('/admin/global-events', { token: cseAdmin.token })).body.items.map((f: any) => f.id);
    expect(ids).toContain(withCse.id);
    expect(ids).not.toContain(withoutCse.id);
    expect((await cseAdmin.c.get(`/admin/global-events/${withCse.id}`, { token: cseAdmin.token })).status).toBe(200);
    expect((await cseAdmin.c.get(`/admin/global-events/${withoutCse.id}`, { token: cseAdmin.token })).status).toBe(404);
    // Reading the fest doesn't mean editing it.
    expect((await cseAdmin.c.patch(`/admin/global-events/${withCse.id}`, { tagline: 'x', version: 0 }, { token: cseAdmin.token })).status).toBe(404);
  });
});
