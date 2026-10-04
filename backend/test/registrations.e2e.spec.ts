import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenService } from '../src/auth/token.service';
import { JobsService } from '../src/jobs/jobs.service';
import { RegistrationsService } from '../src/registrations/registrations.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client, uniqueEmail } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let dept: Record<string, string>;

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  dept = Object.fromEntries((await client(t.app).get('/departments')).body.map((d: any) => [d.code, d.id]));
});
afterAll(async () => {
  await t?.close();
});

type Person = { id: string; email: string; name: string; token: string; c: ReturnType<typeof client> };

const admin = {
  get: (url: string) => root.c.get(url, { token: root.token }),
  post: (url: string, body: unknown = {}) => root.c.post(url, body, { token: root.token }),
  patch: (url: string, body: unknown) => root.c.patch(url, body, { token: root.token }),
};

const at = (hhmm: string, day = '2027-03-12') => `${day}T${hhmm}:00+05:30`;

/** A published fest (it needs one live event to be published) with CSE + IT. */
async function liveFest() {
  const f = (await admin.post('/admin/global-events', { name: `Fest ${Math.random().toString(36).slice(2, 8)}`, editionYear: 2027, departmentIds: [dept.CSE, dept.IT], startsAt: at('08:00', '2027-03-11'), endsAt: at('18:00', '2027-03-13') })).body;
  await liveEvent(f.id, { name: 'Opening Talk', startsAt: at('08:00', '2027-03-11') });
  const p = await admin.post(`/admin/global-events/${f.id}/publish`);
  if (p.body.status !== 'PUBLISHED') throw new Error(JSON.stringify(p.body));
  return f;
}

async function liveEvent(festId: string, over: Record<string, unknown> = {}) {
  const r = await admin.post(`/admin/global-events/${festId}/events`, {
    name: `Event ${Math.random().toString(36).slice(2, 8)}`,
    category: 'TECHNICAL',
    departmentId: dept.CSE,
    description: 'Something to do.',
    startsAt: at('10:00'),
    venue: 'Lab 1',
    ...over,
  });
  if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  const p = await admin.post(`/admin/local-events/${r.body.id}/publish`);
  if (p.body.status !== 'PUBLISHED') throw new Error(JSON.stringify(p.body));
  return p.body;
}

let seq = 0;
const newKey = () => `k${Date.now().toString(36)}x${(++seq).toString().padStart(8, '0')}`;
const register = (u: Person, body: Record<string, unknown>, key = newKey()) =>
  u.c.post('/registrations', body, { token: u.token, headers: { 'idempotency-key': key } });
const person = () => makeUser(t, []) as Promise<Person>;
const seats = async (eventId: string) => (await admin.get(`/admin/local-events/${eventId}`)).body as { seatsConfirmed: number; seatsHeld: number };
const mailsTo = async (email: string) => {
  await t.app.get(JobsService).drain();
  return t.outbox.filter((m) => m.to === email);
};

/** Many participants fast: inserted directly with a signed token (no password hashing per user). */
async function crowd(n: number): Promise<Person[]> {
  const tokens = t.app.get(TokenService);
  const roles = [{ role: 'PARTICIPANT', scope_type: 'ORG', scope_id: null, scope_label: null, granted_at: new Date(), granted_by: null }];
  const docs = Array.from({ length: n }, (_, i) => ({ _id: new Types.ObjectId(), email: uniqueEmail(`crowd${i}`), full_name: `Crowd ${i}`, status: 'ACTIVE', session_version: 0, roles }));
  await t.conn.collection('users').insertMany(docs.map((d) => ({ ...d, password_hash: 'x', first_login_otp_done: true, email_verified_at: new Date(), failed_login_count: 0 })));
  return docs.map((d) => ({ id: String(d._id), email: d.email, name: d.full_name, token: tokens.signAccess(d as any), c: client(t.app) }));
}

describe('registering', () => {
  it('a free solo event confirms at once, takes a seat and emails a code', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { seatsTotal: 30 });
    const p = await person();
    const r = await register(p, { eventId: e.id });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: 'CONFIRMED',
      role: 'LEADER',
      payment: { mode: 'NONE', status: 'NOT_REQUIRED', amountPaise: 0 },
      event: { id: e.id, name: e.name },
      fest: { slug: f.slug },
      members: [{ email: p.email, leader: true }],
      holdExpiresAt: null,
    });
    expect(r.body.code).toMatch(/^REG-[A-HJ-NP-Z2-9]{6}$/);
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 1, seatsHeld: 0 });
    expect((await client(t.app).get(`/global-events/${f.slug}/events/${e.slug}`)).body.seatsLeft).toBe(29);
    const [mail] = await mailsTo(p.email);
    expect(mail.subject).toContain(r.body.code);
    expect(mail.text).toContain('Free');
  });

  it('teams: the leader counts, sizes are enforced, nobody is in a team twice', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { participation: 'TEAM', teamMin: 2, teamMax: 3 });
    const [p, q] = await Promise.all([person(), person()]);
    const mate = (email: string, name = 'Mate') => ({ name, email });

    expect((await register(p, { eventId: e.id })).body).toMatchObject({ code: 'TEAM_SIZE', details: { min: 2, max: 3 } });
    expect((await register(p, { eventId: e.id, teammates: [mate('a@x.io'), mate('b@x.io'), mate('c@x.io')] })).body.code).toBe('TEAM_SIZE');
    expect((await register(p, { eventId: e.id, teammates: [mate(p.email.toUpperCase())] })).body).toMatchObject({
      code: 'DUPLICATE_MEMBER',
      details: { fields: { 'teammates.0.email': expect.stringContaining("That's you") } },
    });
    expect((await register(p, { eventId: e.id, teammates: [mate('a@x.io'), mate('A@x.io ')] })).body).toMatchObject({
      code: 'DUPLICATE_MEMBER',
      details: { fields: { 'teammates.1.email': 'Already in this team' } },
    });

    const r = await register(p, { eventId: e.id, teamName: 'Byte Busters', teammates: [mate(q.email.toUpperCase(), q.name), mate('Guest@Other.edu', 'Guest')] });
    expect(r.status).toBe(201);
    expect(r.body.members.map((m: any) => m.email)).toEqual([p.email, q.email, 'guest@other.edu']);
    expect(r.body.teamName).toBe('Byte Busters');

    // The teammate sees it (their account email matches), as a member.
    const mine = await q.c.get('/registrations/my', { token: q.token });
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ code: r.body.code, role: 'MEMBER' });
    expect((await q.c.get(`/registrations/${r.body.code}`, { token: q.token })).status).toBe(200);
    const stranger = await person();
    expect((await stranger.c.get(`/registrations/${r.body.code}`, { token: stranger.token })).status).toBe(404);
    // Teammates are told who added them.
    const [added] = await mailsTo('guest@other.edu');
    expect(added.subject).toMatch(/^Added to a team/);
    expect(added.text).toContain(p.name);

    const solo = await liveEvent(f.id, { startsAt: at('16:00') });
    expect((await register(p, { eventId: solo.id, teammates: [mate('z@x.io')] })).body.code).toBe('TEAM_SIZE');
  });

  it('one place per person per event, whoever registered them', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { participation: 'TEAM', teamMin: 1, teamMax: 2 });
    const [p, q, s] = await Promise.all([person(), person(), person()]);
    const first = await register(p, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] });
    expect(first.status).toBe(201);

    const again = await register(s, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'MEMBER_ALREADY_REGISTERED', details: { email: q.email, self: false, fields: { 'teammates.0.email': 'Already registered for this event' } } });
    expect(again.body.details.code).toBeUndefined(); // someone else's registration code isn't revealed

    const twice = await register(q, { eventId: e.id });
    expect(twice.body).toMatchObject({ code: 'MEMBER_ALREADY_REGISTERED', details: { self: true, code: first.body.code } });
  });

  it('missing or malformed Idempotency-Key → 400', async () => {
    const p = await person();
    expect((await p.c.post('/registrations', { eventId: new Types.ObjectId().toHexString() }, { token: p.token })).status).toBe(400);
    expect((await register(p, { eventId: new Types.ObjectId().toHexString() }, 'short')).status).toBe(400);
    expect((await register(p, { eventId: new Types.ObjectId().toHexString() })).status).toBe(404);
  });
});

describe('time clashes', () => {
  it("a person can't be at two events at once; back-to-back is fine; a start-only event counts as 2 h", async () => {
    const f = await liveFest();
    const a = await liveEvent(f.id, { name: 'Blind Coding', startsAt: at('10:00'), endsAt: at('12:00') });
    const b = await liveEvent(f.id, { startsAt: at('11:00') }); // no end → 11:00–13:00
    const c = await liveEvent(f.id, { startsAt: at('12:00'), endsAt: at('13:00') });
    const d = await liveEvent(f.id, { startsAt: at('13:00') });
    const p = await person();

    const ra = await register(p, { eventId: a.id });
    expect(ra.status).toBe(201);
    const clash = await register(p, { eventId: b.id });
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ code: 'TIME_CLASH', details: { self: true, code: ra.body.code, event: { name: 'Blind Coding' } } });
    expect(clash.body.message).toContain('Blind Coding');
    expect((await register(p, { eventId: c.id })).status).toBe(201); // starts as A ends
    expect((await register(p, { eventId: d.id })).status).toBe(201); // starts as C ends

    // The window of an event without an end time is stored as the assumed one.
    const doc = await t.conn.collection('registrations').findOne({ code: (await register(await person(), { eventId: b.id })).body.code });
    expect(doc!.ends_at.getTime() - doc!.starts_at.getTime()).toBe(2 * 3600_000);
  });

  it("a teammate's clash blocks the team, without naming the teammate's other event", async () => {
    const f = await liveFest();
    const a = await liveEvent(f.id, { startsAt: at('10:00'), endsAt: at('12:00') });
    const team = await liveEvent(f.id, { participation: 'TEAM', teamMin: 2, teamMax: 2, startsAt: at('10:30'), endsAt: at('11:30') });
    const [p, q] = await Promise.all([person(), person()]);
    await register(q, { eventId: a.id });
    const r = await register(p, { eventId: team.id, teammates: [{ name: q.name, email: q.email }] });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'TIME_CLASH', details: { email: q.email, self: false, fields: { 'teammates.0.email': 'Busy with another event at this time' } } });
    expect(r.body.details.event).toBeUndefined();
  });

  it('two overlapping registrations sent at the same moment: exactly one wins', async () => {
    const f = await liveFest();
    const [a, b] = await Promise.all([
      liveEvent(f.id, { startsAt: at('14:00'), endsAt: at('15:00') }),
      liveEvent(f.id, { startsAt: at('14:30'), endsAt: at('15:30') }),
    ]);
    const p = await person();
    const [ra, rb] = await Promise.all([register(p, { eventId: a.id }), register(p, { eventId: b.id })]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    expect([ra.body.code, rb.body.code]).toContain('TIME_CLASH');
    expect(await t.conn.collection('registrations').countDocuments({ 'members.email': p.email, active: true })).toBe(1);
  });

  it("when an event moves, its registrants' schedules move with it", async () => {
    const f = await liveFest();
    const x = await liveEvent(f.id, { startsAt: at('09:00'), endsAt: at('10:00') });
    const y = await liveEvent(f.id, { startsAt: at('15:00'), endsAt: at('16:00') });
    const p = await person();
    const rx = await register(p, { eventId: x.id });

    const cur = (await admin.get(`/admin/local-events/${x.id}`)).body;
    expect((await admin.patch(`/admin/local-events/${x.id}`, { startsAt: at('15:30'), endsAt: null, version: cur.version })).status).toBe(200);
    const doc = await t.conn.collection('registrations').findOne({ code: rx.body.code });
    expect(doc!.starts_at.toISOString()).toBe(new Date(at('15:30')).toISOString());
    expect(doc!.ends_at.toISOString()).toBe(new Date(at('17:30')).toISOString()); // assumed 2 h
    expect((await register(p, { eventId: y.id })).body.code).toBe('TIME_CLASH');
  });

  it('a cancelled event frees its registrants for that slot', async () => {
    const f = await liveFest();
    const x = await liveEvent(f.id, { startsAt: at('11:00'), endsAt: at('12:00') });
    const y = await liveEvent(f.id, { startsAt: at('11:00'), endsAt: at('12:00') });
    const p = await person();
    const rx = await register(p, { eventId: x.id });
    expect((await register(p, { eventId: y.id })).status).toBe(409);
    await admin.post(`/admin/local-events/${x.id}/cancel`, { reason: 'Speaker unavailable' });
    expect((await register(p, { eventId: y.id })).status).toBe(201);
    const mine = (await p.c.get('/registrations/my', { token: p.token })).body.items;
    expect(mine.find((r: any) => r.code === rx.body.code).event.status).toBe('CANCELLED');
  });
});

describe('payment modes and seat holds', () => {
  it('pay at the desk: confirmed now, amount due, priced per member', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { participation: 'TEAM', teamMin: 1, teamMax: 4, pricing: { type: 'PAID', amountPaise: 10_000, per: 'MEMBER', modes: ['OFFLINE'] } });
    const p = await person();
    expect((await register(p, { eventId: e.id, paymentMode: 'ONLINE' })).body).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: { paymentMode: expect.stringContaining('desk') } } });
    const r = await register(p, { eventId: e.id, teammates: [{ name: 'Asha', email: 'a1@x.io' }, { name: 'Bala', email: 'b1@x.io' }] });
    expect(r.body).toMatchObject({ status: 'CONFIRMED', payment: { mode: 'OFFLINE', status: 'DUE', amountPaise: 30_000 } });
    const [mail] = await mailsTo(p.email);
    expect(mail.text).toContain('Pay ₹300 at the registration desk');
  });

  it('online or desk: the person has to choose', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { pricing: { type: 'PAID', amountPaise: 50_000, per: 'TEAM', modes: ['ONLINE', 'OFFLINE'] } });
    const p = await person();
    expect((await register(p, { eventId: e.id })).body.details.fields.paymentMode).toBe('Choose how you will pay');
    expect((await register(p, { eventId: e.id, paymentMode: 'OFFLINE' })).body.payment).toMatchObject({ mode: 'OFFLINE', status: 'DUE', amountPaise: 50_000 });
  });

  it('online pay holds the seat for 10 minutes; expired holds give it back (sweeper or lazily)', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { seatsTotal: 1, pricing: { type: 'PAID', amountPaise: 30_000, per: 'MEMBER', modes: ['ONLINE'] } });
    const [p, q, s] = await Promise.all([person(), person(), person()]);

    const before = Date.now();
    const r = await register(p, { eventId: e.id });
    expect(r.body).toMatchObject({ status: 'PAYMENT_PENDING', payment: { mode: 'ONLINE', status: 'PENDING', amountPaise: 30_000 } });
    const hold = new Date(r.body.holdExpiresAt).getTime();
    expect(hold - before).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(hold - before).toBeLessThanOrEqual(10 * 60_000 + 5000);
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 0, seatsHeld: 1 });
    expect((await mailsTo(p.email)).length).toBe(0); // the confirmation goes out once paid
    expect((await register(q, { eventId: e.id })).body.code).toBe('SEATS_UNAVAILABLE');

    const sweeper = t.app.get(RegistrationsService);
    expect(await sweeper.releaseExpired({}, new Date(Date.now() + 5 * 60_000))).toBe(0); // not yet
    expect(await sweeper.releaseExpired({}, new Date(Date.now() + 11 * 60_000))).toBe(1);
    expect(await sweeper.releaseExpired({}, new Date(Date.now() + 11 * 60_000))).toBe(0); // once
    expect((await p.c.get(`/registrations/${r.body.code}`, { token: p.token })).body.status).toBe('EXPIRED');
    expect(await seats(e.id)).toMatchObject({ seatsHeld: 0 });

    // q takes the seat; their hold lapses but no sweep has run yet → s still gets it (lazy release).
    const rq = await register(q, { eventId: e.id });
    expect(rq.status).toBe(201);
    await t.conn.collection('registrations').updateOne({ code: rq.body.code }, { $set: { hold_expires_at: new Date(Date.now() - 1000) } });
    expect((await register(s, { eventId: e.id })).status).toBe(201);
    expect((await q.c.get(`/registrations/${rq.body.code}`, { token: q.token })).body.status).toBe('EXPIRED');
    expect(await seats(e.id)).toMatchObject({ seatsHeld: 1 });
  });

  it('50 people race for the last seat: exactly one gets it', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { seatsTotal: 1, startsAt: at('10:00', '2027-03-13') });
    const people = await crowd(50);
    const results = await Promise.all(people.map((u) => register(u, { eventId: e.id })));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'SEATS_UNAVAILABLE')).toBe(true);
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 1, seatsHeld: 0 });
    expect(await t.conn.collection('registrations').countDocuments({ local_event_id: new Types.ObjectId(e.id) })).toBe(1);
  }, 30_000);

  it('a double click (same Idempotency-Key) returns the first registration and takes one seat', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { seatsTotal: 10, startsAt: at('12:00', '2027-03-13') });
    const p = await person();
    const key = newKey();
    const [a, b] = await Promise.all([register(p, { eventId: e.id }, key), register(p, { eventId: e.id }, key)]);
    const c = await register(p, { eventId: e.id }, key);
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(new Set([a.body.code, b.body.code, c.body.code]).size).toBe(1);
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 1 });
  });
});

describe('cancelling', () => {
  it('the leader cancels, the seat comes back and teammates are told; teammates cannot cancel', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { participation: 'TEAM', teamMin: 2, teamMax: 2, seatsTotal: 5 });
    const [p, q] = await Promise.all([person(), person()]);
    const r = await register(p, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] });
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 1 });

    const byMate = await q.c.post(`/registrations/${r.body.code}/cancel`, {}, { token: q.token });
    expect([byMate.status, byMate.body.code]).toEqual([403, 'LEADER_ONLY']);

    const done = await p.c.post(`/registrations/${r.body.code}/cancel`, { reason: 'Exam clash' }, { token: p.token });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Exam clash' });
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 0 });
    expect((await mailsTo(q.email)).some((m) => m.subject.startsWith('Cancelled'))).toBe(true);
    expect((await p.c.post(`/registrations/${r.body.code}/cancel`, {}, { token: p.token })).body.code).toBe('NOT_ACTIVE');
    // The slot is free again for both of them.
    expect((await register(p, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] })).status).toBe(201);
  });

  it('no self-service cancelling once the event has started', async () => {
    const f = await liveFest();
    const e = await liveEvent(f.id, { startsAt: at('17:00') });
    const p = await person();
    const r = await register(p, { eventId: e.id });
    await t.conn.collection('registrations').updateOne({ code: r.body.code }, { $set: { starts_at: new Date(Date.now() - 60_000) } });
    expect((await p.c.post(`/registrations/${r.body.code}/cancel`, {}, { token: p.token })).body.code).toBe('EVENT_STARTED');
  });
});

describe('registration windows', () => {
  it('not open yet, closed, paused, or not published', async () => {
    const f = await liveFest();
    const p = await person();
    const soon = await liveEvent(f.id, { registrationOpensAt: '2027-01-01T09:00:00+05:30' });
    expect((await register(p, { eventId: soon.id })).body).toMatchObject({ code: 'REGISTRATION_NOT_OPEN', details: { opensAt: expect.any(String) } });
    const closed = await liveEvent(f.id, { registrationClosesAt: '2026-01-01T09:00:00+05:30' });
    expect((await register(p, { eventId: closed.id })).body.code).toBe('REGISTRATION_CLOSED');
    const paused = await liveEvent(f.id, { startsAt: at('18:00') });
    await admin.post(`/admin/local-events/${paused.id}/suspend`, { reason: 'Venue change' });
    expect((await register(p, { eventId: paused.id })).body.code).toBe('REGISTRATION_PAUSED');
    const draft = (await admin.post(`/admin/global-events/${f.id}/events`, { name: 'Draft Thing', category: 'TECHNICAL', departmentId: dept.CSE })).body;
    expect((await register(p, { eventId: draft.id })).status).toBe(404);
  });
});

describe('organisers', () => {
  it('department admins see and cancel registrations of their own events only', async () => {
    const f = await liveFest();
    const cseEvent = await liveEvent(f.id, { startsAt: at('10:00', '2027-03-13'), seatsTotal: 20 });
    const [p, q] = await Promise.all([person(), person()]);
    const rp = await register(p, { eventId: cseEvent.id });
    const rq = await register(q, { eventId: cseEvent.id });
    const cseAdmin = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);
    const itAdmin = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.IT, 'IT']]);

    const list = await cseAdmin.c.get(`/admin/local-events/${cseEvent.id}/registrations`, { token: cseAdmin.token });
    expect(list.status).toBe(200);
    expect(list.body.items.map((r: any) => r.code)).toEqual([rq.body.code, rp.body.code]); // newest first
    expect(list.body).toMatchObject({ counts: { CONFIRMED: 2 }, people: 2, seats: { total: 20, confirmed: 2, held: 0 } });
    expect(list.body.items[0].members[0]).toHaveProperty('phone');
    expect((await cseAdmin.c.get(`/admin/local-events/${cseEvent.id}/registrations?q=${rp.body.code.toLowerCase()}`, { token: cseAdmin.token })).body.items).toHaveLength(1);
    expect((await cseAdmin.c.get(`/admin/local-events/${cseEvent.id}/registrations?q=${encodeURIComponent(q.email)}`, { token: cseAdmin.token })).body.items[0].code).toBe(rq.body.code);

    expect((await itAdmin.c.get(`/admin/local-events/${cseEvent.id}/registrations`, { token: itAdmin.token })).status).toBe(404);
    expect((await itAdmin.c.get(`/admin/registrations/${rp.body.code}`, { token: itAdmin.token })).status).toBe(404);
    expect((await p.c.get(`/admin/local-events/${cseEvent.id}/registrations`, { token: p.token })).status).toBe(403);

    expect((await cseAdmin.c.post(`/admin/registrations/${rp.body.code}/cancel`, {}, { token: cseAdmin.token })).status).toBe(400); // reason required
    const cancelled = await cseAdmin.c.post(`/admin/registrations/${rp.body.code}/cancel`, { reason: 'Duplicate entry' }, { token: cseAdmin.token });
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Duplicate entry' });
    expect((await mailsTo(p.email)).some((m) => m.text.includes('the organisers'))).toBe(true);
    expect(await seats(cseEvent.id)).toMatchObject({ seatsConfirmed: 1 });
  });
});

describe('fest catalogue by day', () => {
  it('day tabs count events per college-time day; ?day= filters (midnight edge in IST)', async () => {
    const f = await liveFest();
    await liveEvent(f.id, { startsAt: '2027-03-12T23:30:00+05:30' });
    const late = await liveEvent(f.id, { startsAt: '2027-03-13T00:30:00+05:30' }); // still 12 March in UTC
    const pub = client(t.app);
    const first = await pub.get(`/global-events/${f.slug}/events`);
    expect(first.body.facets.days).toEqual([
      { day: '2027-03-11', n: 1 },
      { day: '2027-03-12', n: 1 },
      { day: '2027-03-13', n: 1 },
    ]);
    const d13 = await pub.get(`/global-events/${f.slug}/events?day=2027-03-13`);
    expect(d13.body.items.map((e: any) => e.id)).toEqual([late.id]);
    expect((await pub.get(`/global-events/${f.slug}/events?day=13-03-2027`)).status).toBe(400);
  });
});

describe('rate limits are per person, not per campus IP', () => {
  it("one student hammering register doesn't block another on the same network", async () => {
    const [p, q] = await crowd(2);
    const bad = { eventId: 'nope' };
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await register(p, bad)).status;
    expect(last).toBe(429);
    expect((await register(q, bad)).status).toBe(400); // q's own bucket
  });
});

describe('index plans', () => {
  it('my list, the clash check, the organiser list and the sweeper all use indexes', async () => {
    const Reg = t.conn.models.Registration;
    const LocalEvent = t.conn.models.LocalEvent;
    const id = new Types.ObjectId();
    await expectIndexed(Reg.find({ 'members.email': 'a@b.c' }).sort({ starts_at: 1 }), 'person_schedule');
    await expectIndexed(Reg.find({ 'members.email': { $in: ['a@b.c', 'd@e.f'] }, starts_at: { $lt: new Date() }, ends_at: { $gt: new Date() }, active: true }));
    await expectIndexed(Reg.find({ local_event_id: id, status: { $in: ['CONFIRMED', 'CANCELLED'] } }).sort({ _id: -1 }));
    await expectIndexed(Reg.find({ status: 'PAYMENT_PENDING', hold_expires_at: { $lt: new Date() } }), 'pending_holds');
    await expectIndexed(Reg.find({ leader_user_id: id, idempotency_key: 'x' }), 'idempotency');
    await expectIndexed(LocalEvent.find({ global_event_id: id, status: { $in: ['PUBLISHED'] }, starts_at: { $gte: new Date(), $lt: new Date() } }).sort({ starts_at: 1, _id: 1 }));
  });
});
