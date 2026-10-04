import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import { MockGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { parseTicketToken, signTicket, verifyTicketToken } from '../src/tickets/qr';
import { TicketsService } from '../src/tickets/tickets.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let dept: Record<string, string>;
let fest: any;

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  dept = Object.fromEntries((await client(t.app).get('/departments')).body.map((d: any) => [d.code, d.id]));
});
afterAll(async () => {
  await t?.close();
});

type Person = Awaited<ReturnType<typeof makeUser>>;
const as = (u: Person) => ({
  get: (url: string) => u.c.get(url, { token: u.token }),
  post: (url: string, body: unknown = {}) => u.c.post(url, body, { token: u.token }),
});
const at = (hhmm: string, day = '2027-03-12') => `${day}T${hhmm}:00+05:30`;
let n = 0;
const register = (u: Person, body: Record<string, unknown>) => u.c.post('/registrations', body, { token: u.token, headers: { 'idempotency-key': `tk-${Date.now().toString(36)}-${++n}-abcdefgh` } });
const drain = () => t.app.get(JobsService).drain();

async function liveEvent(over: Record<string, unknown> = {}) {
  const admin = as(root);
  if (!fest) {
    fest = (await admin.post('/admin/global-events', { name: 'Ticket Fest', editionYear: 2027, departmentIds: [dept.CSE], startsAt: at('08:00'), endsAt: at('18:00', '2027-03-13') })).body;
    const o = await admin.post(`/admin/global-events/${fest.id}/events`, { name: 'Opening', category: 'TECHNICAL', departmentId: dept.CSE, description: 'x', startsAt: at('08:00'), venue: 'Hall' });
    await admin.post(`/admin/local-events/${o.body.id}/publish`);
    await admin.post(`/admin/global-events/${fest.id}/publish`);
  }
  const hour = String(9 + (++n % 9)).padStart(2, '0');
  const r = await admin.post(`/admin/global-events/${fest.id}/events`, {
    name: `Event ${n}`,
    category: 'TECHNICAL',
    departmentId: dept.CSE,
    description: 'x',
    startsAt: at(`${hour}:00`, n % 2 ? '2027-03-12' : '2027-03-13'),
    venue: 'Lab 2',
    ...over,
  });
  await admin.post(`/admin/local-events/${r.body.id}/publish`);
  return r.body;
}

describe('tickets', () => {
  it('one ticket per member with its own QR; emails embed that QR as an image (no plain code needed)', async () => {
    const e = await liveEvent({ participation: 'TEAM', teamMin: 2, teamMax: 2 });
    const [p, q] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    const r = await register(p, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] });
    expect(r.status).toBe(201);
    expect(r.body.ticket).toMatchObject({ status: 'ACTIVE', holder: p.name, leader: true });
    expect(r.body.ticket.code).toMatch(/^TCK-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    expect(r.body.ticket.qr.length).toBeLessThanOrEqual(50); // short payload → low-density QR
    expect(parseTicketToken(r.body.ticket.qr)?.code).toBe(r.body.ticket.code);

    const mate = (await as(q).get(`/registrations/${r.body.code}`)).body.ticket;
    expect(mate.code).not.toBe(r.body.ticket.code);
    expect(mate.holder).toBe(q.name);

    await drain();
    for (const [who, tk] of [[p, r.body.ticket], [q, mate]] as const) {
      const mail = t.outbox.filter((m: any) => m.to === who.email).at(-1) as any;
      const img = mail.inline?.[0];
      expect(img).toMatchObject({ contentType: 'image/png', cid: `qr-${tk.code}@ems` });
      expect(mail.html).toContain(`src="cid:qr-${tk.code}@ems"`);
      expect(mail.html).not.toMatch(/>Code</);
      const png = Buffer.from(img.content, 'base64');
      expect(png.length).toBeLessThan(3_000);
      expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 264, height: 264 });
    }
  });

  it('pay at the desk: "pay first" tickets that become entry passes once collected', async () => {
    const e = await liveEvent({ pricing: { type: 'PAID', amountPaise: 10_000, per: 'TEAM', modes: ['OFFLINE'] } });
    const p = await makeUser(t, []);
    const r = await register(p, { eventId: e.id });
    expect(r.body.ticket.status).toBe('PAYMENT_PENDING');
    await drain();
    expect((t.outbox.filter((m) => m.to === p.email).at(-1) as any).html).toContain('Pay at the registration desk, then show this QR');
    await as(root).post(`/admin/registrations/${r.body.code}/collect`, { amountPaise: 10_000 });
    expect((await as(p).get(`/tickets/${r.body.ticket.code}`)).body.status).toBe('ACTIVE');
  });

  it('online: no ticket while the seat is only held; issued (once) when paid', async () => {
    const e = await liveEvent({ pricing: { type: 'PAID', amountPaise: 30_000, per: 'MEMBER', modes: ['ONLINE'] } });
    const p = await makeUser(t, []);
    const r = await register(p, { eventId: e.id });
    expect(r.body.ticket).toBeNull();
    const o = (await as(p).post(`/registrations/${r.body.code}/order`)).body;
    const gw: MockGateway = t.app.get(PAYMENT_GATEWAY);
    const pay = gw.pay(o.gatewayOrderId);
    await as(p).post(`/orders/${o.orderCode}/verify`, { gatewayOrderId: o.gatewayOrderId, ...pay });
    await as(p).post(`/orders/${o.orderCode}/verify`, { gatewayOrderId: o.gatewayOrderId, ...pay });
    const after = (await as(p).get(`/registrations/${r.body.code}`)).body;
    expect(after.ticket.status).toBe('ACTIVE');
    await drain();
    expect(t.outbox.filter((m: any) => m.to === p.email && m.inline?.length)).toHaveLength(1);
    expect(await t.conn.collection('tickets').countDocuments({ registration_code: r.body.code })).toBe(1);
  });

  it('cancelling (the registration or the whole event) voids tickets and hides their QR', async () => {
    const e = await liveEvent();
    const [p, q] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    const rp = await register(p, { eventId: e.id });
    await as(p).post(`/registrations/${rp.body.code}/cancel`);
    const tp = (await as(p).get(`/tickets/${rp.body.ticket.code}`)).body;
    expect(tp.status).toBe('VOID');
    expect(tp.qr).toBeUndefined();

    const rq = await register(q, { eventId: e.id });
    await as(root).post(`/admin/local-events/${e.id}/cancel`, { reason: 'Rain' });
    expect((await as(q).get(`/tickets/${rq.body.ticket.code}`)).body.status).toBe('VOID');
  });

  it('issuing twice changes nothing (retries are safe)', async () => {
    const e = await liveEvent();
    const p = await makeUser(t, []);
    const r = await register(p, { eventId: e.id });
    const reg = await t.conn.collection('registrations').findOne({ code: r.body.code });
    const conn = t.app.get<Connection>(getConnectionToken());
    const session = await conn.startSession();
    await session.withTransaction(() => t.app.get(TicketsService).issue(reg as any, 'confirmed', session));
    await session.endSession();
    expect(await t.conn.collection('tickets').countDocuments({ registration_code: r.body.code })).toBe(1);
  });
});

describe('QR signature', () => {
  it('verifies only the latest copy of a ticket; edited or forged codes fail', () => {
    const tk = { code: 'TCK-ABCD-EF', jti: 'jti-one' };
    const token = signTicket(tk.code, tk.jti);
    expect(verifyTicketToken(token, tk)).toBe(true);
    expect(verifyTicketToken(token, { ...tk, jti: 'reissued' })).toBe(false); // old screenshot after a reissue
    expect(verifyTicketToken(token.replace('TCK-ABCD-EF', 'TCK-ABCD-EG'), { ...tk, code: 'TCK-ABCD-EG' })).toBe(false);
    expect(verifyTicketToken(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), tk)).toBe(false);
    expect(verifyTicketToken(token.replace('.k1.', '.k9.'), tk)).toBe(false); // unknown key
    expect(parseTicketToken('hello')).toBeNull();
  });
});

describe('holder endpoints', () => {
  it('my tickets, owner-only details, resend to just me (3 per hour), public check with initials only', async () => {
    const e = await liveEvent({ participation: 'TEAM', teamMin: 2, teamMax: 2 });
    const [p, q, s] = await Promise.all([makeUser(t, [], { name: 'Asha Raman' }), makeUser(t, []), makeUser(t, [])]);
    const r = await register(p, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] });
    const code = r.body.ticket.code;

    const mine = await as(p).get('/tickets/my');
    expect(mine.body.items[0]).toMatchObject({ code, status: 'ACTIVE', event: { name: e.name } });
    expect(mine.body.items[0].qr).toBeUndefined(); // the list never carries QR payloads
    const one = await as(p).get(`/tickets/${code}`);
    expect(one.body).toMatchObject({ code, fest: { slug: fest.slug }, event: { name: e.name } });
    expect(one.headers['cache-control']).toBe('private, no-store');
    expect((await as(s).get(`/tickets/${code}`)).status).toBe(404);

    await drain();
    const before = t.outbox.length;
    expect((await as(p).post(`/tickets/${code}/resend`)).status).toBe(200);
    await drain();
    expect(t.outbox.slice(before).map((m) => m.to)).toEqual([p.email]);
    await as(p).post(`/tickets/${code}/resend`);
    await as(p).post(`/tickets/${code}/resend`);
    expect((await as(p).post(`/tickets/${code}/resend`)).status).toBe(429);

    const pub = await client(t.app).get(`/verify/${code.toLowerCase()}`);
    expect(pub.body).toEqual({ code, status: 'ACTIVE', holder: 'A. R.', event: e.name, startsAt: expect.any(String), fest: fest.name, usedAt: null });
    expect(JSON.stringify(pub.body)).not.toContain(p.email);
    expect((await client(t.app).get('/verify/TCK-ZZZZ-ZZ')).status).toBe(404);
  });

  it('ticket lookups use indexes', async () => {
    const T = t.conn.models.Ticket;
    await expectIndexed(T.find({ member_email: 'a@b.c' }).sort({ issued_at: -1 }));
    await expectIndexed(T.find({ registration_id: new Types.ObjectId(), member_email: 'a@b.c' }));
    await expectIndexed(T.find({ local_event_id: new Types.ObjectId(), status: { $in: ['ACTIVE', 'PAYMENT_PENDING'] } }));
  });
});

describe('job queue', () => {
  it('the in-transaction idempotency lookup uses the partial index', async () => {
    await expectIndexed(t.conn.models.Job.find({ idempotency_key: { $eq: 'tickets:x:confirmed', $type: 'string' } }));
  });
});
