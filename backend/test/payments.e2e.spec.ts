import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import { MockGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { RegistrationsService } from '../src/registrations/registrations.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let dept: Record<string, string>;
let gw: MockGateway;

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  dept = Object.fromEntries((await client(t.app).get('/departments')).body.map((d: any) => [d.code, d.id]));
  gw = t.app.get(PAYMENT_GATEWAY);
});
afterAll(async () => {
  await t?.close();
});

type Person = Awaited<ReturnType<typeof makeUser>>;
const as = (u: Person) => ({
  get: (url: string) => u.c.get(url, { token: u.token }),
  post: (url: string, body: unknown = {}) => u.c.post(url, body, { token: u.token }),
  put: (url: string, body: unknown) => t.app.inject({ method: 'PUT', url: `/api/v1${url}`, payload: body as any, headers: { authorization: `Bearer ${u.token}` } }),
});
const at = (hhmm: string, day = '2027-03-12') => `${day}T${hhmm}:00+05:30`;
let n = 0;
const key = () => `pay-key-${Date.now().toString(36)}-${++n}-abcdef`;
const register = (u: Person, body: Record<string, unknown>) => u.c.post('/registrations', body, { token: u.token, headers: { 'idempotency-key': key() } });

let fest: any;
async function liveEvent(over: Record<string, unknown> = {}) {
  const admin = as(root);
  if (!fest) {
    fest = (await admin.post('/admin/global-events', { name: 'Pay Fest', editionYear: 2027, departmentIds: [dept.CSE], startsAt: at('08:00'), endsAt: at('18:00', '2027-03-13') })).body;
    const opener = await admin.post(`/admin/global-events/${fest.id}/events`, { name: 'Opening', category: 'TECHNICAL', departmentId: dept.CSE, description: 'x', startsAt: at('08:00'), venue: 'Hall' });
    await admin.post(`/admin/local-events/${opener.body.id}/publish`);
    await admin.post(`/admin/global-events/${fest.id}/publish`);
  }
  const r = await admin.post(`/admin/global-events/${fest.id}/events`, {
    name: `Paid ${++n}`,
    category: 'WORKSHOP',
    departmentId: dept.CSE,
    description: 'Hands-on.',
    startsAt: at(`${String(9 + (n % 9)).padStart(2, '0')}:00`, n % 2 ? '2027-03-12' : '2027-03-13'),
    venue: 'Lab',
    pricing: { type: 'PAID', amountPaise: 30_000, per: 'MEMBER', modes: ['ONLINE'] },
    ...over,
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  await admin.post(`/admin/local-events/${r.body.id}/publish`);
  return r.body;
}
const seats = async (id: string) => (await as(root).get(`/admin/local-events/${id}`)).body as { seatsConfirmed: number; seatsHeld: number };
const webhook = (body: unknown, sign = true, eventId = `evt_${Math.random().toString(36).slice(2)}`) => {
  // Deliberately odd spacing: the signature must be checked over the raw bytes, not re-serialised JSON.
  const raw = JSON.stringify(body, null, 3);
  return t.app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/razorpay',
    payload: raw,
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign ? gw.signWebhook(raw) : 'bad', 'x-razorpay-event-id': eventId },
  });
};
const captured = (orderId: string, paymentId: string, amount: number) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } } },
});

describe('fee settings', () => {
  it('default to no fees; a Super Admin can set them and new registrations are priced with them', async () => {
    expect((await client(t.app).get('/fees')).body).toEqual({ platformFeeBps: 0, platformFeeFlatPaise: 0, gstBps: 0, feeBearer: 'PARTICIPANT' });
    const cse = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);
    expect((await as(cse).put('/admin/settings/fees', { platformFeeBps: 200, platformFeeFlatPaise: 0, gstBps: 1800, feeBearer: 'PARTICIPANT' })).statusCode).toBe(403);
    expect((await as(root).put('/admin/settings/fees', { platformFeeBps: 200, platformFeeFlatPaise: 0, gstBps: 1800, feeBearer: 'PARTICIPANT' })).statusCode).toBe(200);

    const e = await liveEvent({ participation: 'TEAM', teamMin: 1, teamMax: 4 });
    const p = await makeUser(t, []);
    const team = [1, 2, 3].map((i) => ({ name: `Mate ${i}`, email: `mate${i}-${n}@x.io` }));
    const r = await register(p, { eventId: e.id, teammates: team });
    // The documented example: 4 × ₹100… here 4 × ₹300 = ₹1,200 + 2 % + 18 % GST on both.
    expect(r.body.payment).toMatchObject({ amountPaise: 144_432, breakdown: { basePaise: 120_000, platformFeePaise: 2_400, gstPaise: 22_032, cgstPaise: 11_016, sgstPaise: 11_016, totalPaise: 144_432 } });
    await as(root).put('/admin/settings/fees', { platformFeeBps: 0, platformFeeFlatPaise: 0, gstBps: 0, feeBearer: 'PARTICIPANT' });
  });
});

describe('online checkout', () => {
  it('order → pay → verify confirms the seat, once; the amount comes from the server', async () => {
    const e = await liveEvent({ seatsTotal: 5 });
    const p = await makeUser(t, []);
    const reg = (await register(p, { eventId: e.id })).body;
    expect(reg.status).toBe('PAYMENT_PENDING');

    const o = await as(p).post(`/registrations/${reg.code}/order`);
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ gateway: 'mock', amountPaise: 30_000, currency: 'INR', description: e.name, prefill: { email: p.email } });
    expect(o.body.orderCode).toMatch(/^ORD-[A-Z0-9]{8}$/);
    // Starting checkout again reuses the open order.
    expect((await as(p).post(`/registrations/${reg.code}/order`)).body.gatewayOrderId).toBe(o.body.gatewayOrderId);

    const bad = await as(p).post(`/orders/${o.body.orderCode}/verify`, { gatewayOrderId: o.body.gatewayOrderId, paymentId: 'pay_x', signature: 'a'.repeat(64) });
    expect([bad.status, bad.body.code]).toEqual([400, 'SIGNATURE_INVALID']);

    const paid = gw.pay(o.body.gatewayOrderId);
    const v = await as(p).post(`/orders/${o.body.orderCode}/verify`, { gatewayOrderId: o.body.gatewayOrderId, ...paid });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ status: 'PAID', registrationStatus: 'CONFIRMED', amountPaise: 30_000 });
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 1, seatsHeld: 0 });
    expect((await as(p).get(`/registrations/${reg.code}`)).body.payment.status).toBe('PAID');

    // Verify again + the webhook for the same payment: no change, no second seat.
    expect((await as(p).post(`/orders/${o.body.orderCode}/verify`, { gatewayOrderId: o.body.gatewayOrderId, ...paid })).status).toBe(200);
    expect((await webhook(captured(o.body.gatewayOrderId, paid.paymentId, 30_000))).statusCode).toBe(200);
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 1, seatsHeld: 0 });
    await t.app.get(JobsService).drain();
    expect(t.outbox.filter((m) => m.to === p.email && m.text.includes('₹300 paid'))).toHaveLength(1);
    expect((await as(p).post(`/registrations/${reg.code}/order`)).body.code).toBe('ALREADY_PAID');
  });

  it('the webhook alone settles it (browser closed); duplicate deliveries count once; bad signatures are refused', async () => {
    const e = await liveEvent();
    const p = await makeUser(t, []);
    const reg = (await register(p, { eventId: e.id })).body;
    const o = (await as(p).post(`/registrations/${reg.code}/order`)).body;
    const pay = gw.pay(o.gatewayOrderId);

    expect((await webhook(captured(o.gatewayOrderId, pay.paymentId, 30_000), false)).statusCode).toBe(400);
    const id = 'evt_same_delivery';
    const [a, b] = [await webhook(captured(o.gatewayOrderId, pay.paymentId, 30_000), true, id), await webhook(captured(o.gatewayOrderId, pay.paymentId, 30_000), true, id)];
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(b.json()).toEqual({ ok: true, duplicate: true });
    expect((await as(p).get(`/orders/${o.orderCode}`)).body).toMatchObject({ status: 'PAID', registrationStatus: 'CONFIRMED' });
    // The browser's verify arriving afterwards just sees it paid.
    expect((await as(p).post(`/orders/${o.orderCode}/verify`, { gatewayOrderId: o.gatewayOrderId, ...pay })).body.status).toBe('PAID');
  });

  it('paid twice for one order → the second payment is refunded', async () => {
    const e = await liveEvent();
    const p = await makeUser(t, []);
    const reg = (await register(p, { eventId: e.id })).body;
    const o = (await as(p).post(`/registrations/${reg.code}/order`)).body;
    await webhook(captured(o.gatewayOrderId, gw.pay(o.gatewayOrderId).paymentId, 30_000));
    const second = gw.pay(o.gatewayOrderId).paymentId;
    await webhook(captured(o.gatewayOrderId, second, 30_000));
    await t.app.get(JobsService).drain();
    expect(gw.refunds).toContainEqual({ paymentId: second, amountPaise: 30_000 });
  });

  it('payment after the hold ran out: seat still free → confirmed; event full → full refund', async () => {
    const sweeper = t.app.get(RegistrationsService);
    const e = await liveEvent({ seatsTotal: 1 });
    const [p, q] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    const rp = (await register(p, { eventId: e.id })).body;
    const op = (await as(p).post(`/registrations/${rp.code}/order`)).body;
    await sweeper.releaseExpired({}, new Date(Date.now() + 11 * 60_000)); // hold lapses mid-checkout
    expect(await seats(e.id)).toMatchObject({ seatsHeld: 0 });
    await webhook(captured(op.gatewayOrderId, gw.pay(op.gatewayOrderId).paymentId, 30_000));
    expect((await as(p).get(`/registrations/${rp.code}`)).body).toMatchObject({ status: 'CONFIRMED', payment: { status: 'PAID' } });
    expect(await seats(e.id)).toMatchObject({ seatsConfirmed: 1, seatsHeld: 0 });

    // Same story for q, but p now holds the only seat.
    await t.conn.collection('local_events').updateOne({ _id: new Types.ObjectId(e.id) }, { $set: { seats_total: 2 } });
    const rq = (await register(q, { eventId: e.id })).body;
    const oq = (await as(q).post(`/registrations/${rq.code}/order`)).body;
    await sweeper.releaseExpired({}, new Date(Date.now() + 11 * 60_000));
    await t.conn.collection('local_events').updateOne({ _id: new Types.ObjectId(e.id) }, { $set: { seats_total: 1 } });
    const payQ = gw.pay(oq.gatewayOrderId).paymentId;
    await webhook(captured(oq.gatewayOrderId, payQ, 30_000));
    await t.app.get(JobsService).drain();
    expect((await as(q).get(`/orders/${oq.orderCode}`)).body).toMatchObject({ status: 'PAID', refundStatus: 'DONE', registrationStatus: 'EXPIRED' });
    expect(gw.refunds).toContainEqual({ paymentId: payQ, amountPaise: 30_000 });
    expect(t.outbox.some((m) => m.to === q.email && m.text.includes('full refund'))).toBe(true);
  });

  it('only the leader pays; an expired hold can’t start checkout', async () => {
    const e = await liveEvent({ participation: 'TEAM', teamMin: 2, teamMax: 2 });
    const [p, q] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    const reg = (await register(p, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] })).body;
    expect((await as(q).post(`/registrations/${reg.code}/order`)).body.code).toBe('LEADER_ONLY');
    await t.conn.collection('registrations').updateOne({ code: reg.code }, { $set: { hold_expires_at: new Date(Date.now() - 1000) } });
    const r = await as(p).post(`/registrations/${reg.code}/order`);
    expect([r.status, r.body.code]).toEqual([410, 'HOLD_EXPIRED']);
  });
});

describe('registration desk', () => {
  it('collects exactly the amount due, once, within scope', async () => {
    const e = await liveEvent({ pricing: { type: 'PAID', amountPaise: 10_000, per: 'TEAM', modes: ['OFFLINE'] } });
    const p = await makeUser(t, []);
    const reg = (await register(p, { eventId: e.id })).body;
    expect(reg.payment).toMatchObject({ status: 'DUE', amountPaise: 10_000 });

    const cse = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);
    const it_ = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.IT, 'IT']]);
    expect((await as(p).post(`/admin/registrations/${reg.code}/collect`, { amountPaise: 10_000 })).status).toBe(403);
    expect((await as(it_).post(`/admin/registrations/${reg.code}/collect`, { amountPaise: 10_000 })).status).toBe(404);
    const wrong = await as(cse).post(`/admin/registrations/${reg.code}/collect`, { amountPaise: 5_000 });
    expect([wrong.status, wrong.body.code, wrong.body.details.expectedPaise]).toEqual([400, 'AMOUNT_MISMATCH', 10_000]);
    const ok = await as(cse).post(`/admin/registrations/${reg.code}/collect`, { amountPaise: 10_000 });
    expect(ok.body).toMatchObject({ mode: 'OFFLINE', status: 'PAID', amountPaise: 10_000 });
    expect((await as(cse).post(`/admin/registrations/${reg.code}/collect`, { amountPaise: 10_000 })).body.code).toBe('ALREADY_PAID');
    expect((await as(p).get(`/registrations/${reg.code}`)).body.payment.status).toBe('PAID');
    // Paid entries need a refund to cancel (refunds module).
    expect((await as(p).post(`/registrations/${reg.code}/cancel`)).body.code).toBe('REFUND_REQUIRED');
  });
});

describe('finance', () => {
  it('lists a fest’s orders with totals by mode; finance only', async () => {
    const fin = await makeUser(t, [['FINANCE', 'ORG']]);
    const r = await as(fin).get(`/admin/orders?festId=${fest.id}`);
    expect(r.status).toBe(200);
    expect(r.body.totals.onlineCount).toBeGreaterThanOrEqual(4);
    expect(r.body.totals.deskCount).toBe(1);
    expect(r.body.totals.deskPaise).toBe(10_000);
    expect(r.body.items[0]).toHaveProperty('eventName');
    const p = await makeUser(t, []);
    expect((await as(p).get(`/admin/orders?festId=${fest.id}`)).status).toBe(403);
  });

  it('order lookups use indexes', async () => {
    const O = t.conn.models.Order;
    const id = new Types.ObjectId();
    await expectIndexed(O.find({ gateway_order_id: 'order_x' }));
    await expectIndexed(O.find({ registration_id: id, status: 'CREATED' }));
    await expectIndexed(O.find({ global_event_id: id, status: { $in: ['CREATED', 'PAID'] } }).sort({ _id: -1 }));
  });
});
