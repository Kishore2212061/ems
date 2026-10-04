import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let dept: Record<string, string>;
let fest: any;
let scanner: Awaited<ReturnType<typeof makeUser>>;

type Person = Awaited<ReturnType<typeof makeUser>>;
const as = (u: Person) => ({
  get: (url: string) => u.c.get(url, { token: u.token }),
  post: (url: string, body: unknown = {}) => u.c.post(url, body, { token: u.token }),
});
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
let n = 0;
const register = (u: Person, body: Record<string, unknown>) => u.c.post('/registrations', body, { token: u.token, headers: { 'idempotency-key': `ck-${Date.now().toString(36)}-${++n}-abcdefgh` } });

async function liveEvent(over: Record<string, unknown> = {}) {
  const admin = as(root);
  const r = await admin.post(`/admin/global-events/${fest.id}/events`, {
    name: `Gate ${++n}`,
    category: 'TECHNICAL',
    departmentId: dept.CSE,
    description: 'x',
    startsAt: inMinutes(60), // check-in is open (opens 2 h before); each test uses its own people, so no clashes
    venue: 'Hall',
    ...over,
  });
  await admin.post(`/admin/local-events/${r.body.id}/publish`);
  return r.body;
}

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  dept = Object.fromEntries((await client(t.app).get('/departments')).body.map((d: any) => [d.code, d.id]));
  const admin = as(root);
  fest = (await admin.post('/admin/global-events', { name: 'Gate Fest', editionYear: 2027, departmentIds: [dept.CSE, dept.IT], startsAt: inMinutes(30), endsAt: inMinutes(60 * 24 * 3) })).body;
  await liveEvent();
  await admin.post(`/admin/global-events/${fest.id}/publish`);
  scanner = await makeUser(t, [['SCANNER', 'GLOBAL_EVENT', fest.id, 'Gate Fest']]);
});
afterAll(async () => {
  await t?.close();
});

const scan = (eventId: string, body: Record<string, unknown>, who = scanner) => as(who).post(`/checkins/${eventId}/scan`, { deviceId: 'gate-1', ...body });

describe('scanning', () => {
  it('a valid QR admits once; the same QR again (or on a second phone at the same moment) is ALREADY_USED', async () => {
    const e = await liveEvent();
    const [p, q] = await Promise.all([makeUser(t, [], { name: 'Asha Raman' }), makeUser(t, [])]);
    const tp = (await register(p, { eventId: e.id })).body.ticket;
    const ok = await scan(e.id, { qr: tp.qr });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ result: 'OK', holder: { name: 'Asha Raman', ticketCode: tp.code }, message: 'Welcome, Asha!' });
    const again = await scan(e.id, { qr: tp.qr });
    expect(again.body).toMatchObject({ result: 'ALREADY_USED', usedAt: expect.any(String) });

    const tq = (await register(q, { eventId: e.id })).body.ticket;
    const [a, b] = await Promise.all([scan(e.id, { qr: tq.qr }), scan(e.id, { qr: tq.qr, deviceId: 'gate-2' })]);
    expect([a.body.result, b.body.result].sort()).toEqual(['ALREADY_USED', 'OK']);
    expect((await as(q).get(`/tickets/${tq.code}`)).body.status).toBe('USED');
  });

  it('forged or edited QRs are INVALID_TICKET; a typed ticket code works when the QR will not scan', async () => {
    const e = await liveEvent();
    const p = await makeUser(t, []);
    const tk = (await register(p, { eventId: e.id })).body.ticket;
    const forged = tk.qr.slice(0, -2) + (tk.qr.endsWith('AA') ? 'BB' : 'AA');
    expect((await scan(e.id, { qr: forged })).body.result).toBe('INVALID_TICKET');
    expect((await scan(e.id, { qr: 'https://example.com' })).body.result).toBe('INVALID_TICKET');
    expect((await scan(e.id, { code: 'TCK-ZZZZ-ZZ' })).body.result).toBe('INVALID_TICKET');
    expect((await scan(e.id, { code: tk.code.toLowerCase() })).body.result).toBe('OK');
  });

  it('WRONG_EVENT names the right one; void tickets are refused; check-in opens before the start only', async () => {
    const [e1, e2] = [await liveEvent(), await liveEvent()];
    const p = await makeUser(t, []);
    const t2 = (await register(p, { eventId: e2.id })).body;
    const wrong = await scan(e1.id, { qr: t2.ticket.qr });
    expect(wrong.body.result).toBe('WRONG_EVENT');
    expect(wrong.body.message).toContain(e2.name);

    await as(p).post(`/registrations/${t2.code}/cancel`);
    expect((await scan(e2.id, { qr: t2.ticket.qr })).body).toMatchObject({ result: 'VOID_TICKET', message: 'Registration cancelled' });

    const later = await liveEvent({ startsAt: inMinutes(60 * 30) });
    const q = await makeUser(t, []);
    const tl = (await register(q, { eventId: later.id })).body.ticket;
    expect((await scan(later.id, { qr: tl.qr })).body).toMatchObject({ result: 'NOT_YET_OPEN', opensAt: expect.any(String) });
  });

  it('pay-at-desk tickets: PAYMENT_DUE with the amount; the scanner collects, then the same QR admits', async () => {
    const e = await liveEvent({ pricing: { type: 'PAID', amountPaise: 10_000, per: 'TEAM', modes: ['OFFLINE'] } });
    const p = await makeUser(t, []);
    const reg = (await register(p, { eventId: e.id })).body;
    const due = await scan(e.id, { qr: reg.ticket.qr });
    expect(due.body).toMatchObject({ result: 'PAYMENT_DUE', amountPaise: 10_000, holder: { registrationCode: reg.code } });
    expect((await as(scanner).post(`/admin/registrations/${reg.code}/collect`, { amountPaise: 10_000 })).status).toBe(200);
    expect((await scan(e.id, { qr: reg.ticket.qr })).body.result).toBe('OK');
  });
});

describe('gate access, lookup and summary', () => {
  it('scanners see only their fest; other fests are 404; participants are 403', async () => {
    const e = await liveEvent();
    const list = await as(scanner).get('/checkins/events');
    expect(list.body.fests.map((f: any) => f.id)).toEqual([fest.id]);
    expect(list.body.fests[0].events.some((x: any) => x.id === e.id)).toBe(true);

    const other = await makeUser(t, [['SCANNER', 'GLOBAL_EVENT', new Types.ObjectId().toHexString(), 'Other']]);
    expect((await scan(e.id, { code: 'TCK-AAAA-AA' }, other)).status).toBe(404);
    const p = await makeUser(t, []);
    expect((await scan(e.id, { code: 'TCK-AAAA-AA' }, p)).status).toBe(403);
    const itAdmin = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.IT, 'IT']]);
    expect((await scan(e.id, { code: 'TCK-AAAA-AA' }, itAdmin)).status).toBe(404); // a CSE event
  });

  it('look up by email, phone or registration code; summary counts the gate and this shift', async () => {
    const e = await liveEvent({ participation: 'TEAM', teamMin: 2, teamMax: 2 });
    const [p, q] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    await t.conn.collection('users').updateOne({ email: p.email }, { $set: { phone: '9876501234' } });
    const reg = (await register(p, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] })).body;

    const byEmail = await as(scanner).get(`/checkins/${e.id}/lookup?q=${encodeURIComponent(q.email)}`);
    expect(byEmail.body.items).toEqual([expect.objectContaining({ holder: q.name, status: 'ACTIVE', registrationCode: reg.code })]);
    expect((await as(scanner).get(`/checkins/${e.id}/lookup?q=98765%2001234`)).body.items).toHaveLength(2); // the leader's phone → whole team
    expect((await as(scanner).get(`/checkins/${e.id}/lookup?q=${reg.code}`)).body.items).toHaveLength(2);
    expect((await as(scanner).get(`/checkins/${e.id}/lookup?q=hello`)).body.code).toBe('BAD_LOOKUP');

    await scan(e.id, { code: reg.ticket.code });
    const s = await as(scanner).get(`/checkins/${e.id}/summary`);
    expect(s.body).toMatchObject({ event: { id: e.id }, checkedIn: 1, expected: 2, paymentDue: 0 });
    expect(s.body.shift.scans).toBeGreaterThanOrEqual(1);
    expect(s.body.shift.cashPaise).toBe(10_000); // collected in the previous test, same operator, today
  });

  it('gate logs use indexes', async () => {
    const C = t.conn.models.CheckIn;
    await expectIndexed(C.find({ local_event_id: new Types.ObjectId() }).sort({ scanned_at: -1 }));
    await expectIndexed(C.find({ operator_id: new Types.ObjectId(), scanned_at: { $gte: new Date() } }));
  });
});
