import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import { GatewayError, MockGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { RefundsService } from '../src/payments/refunds.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let finance: Awaited<ReturnType<typeof makeUser>>;
let dept: Record<string, string>;
let gw: MockGateway;

type Person = Awaited<ReturnType<typeof makeUser>>;
const as = (u: Person) => ({
  get: (url: string) => u.c.get(url, { token: u.token }),
  post: (url: string, body: unknown = {}) => u.c.post(url, body, { token: u.token }),
});
const at = (hhmm: string, day = '2027-03-12') => `${day}T${hhmm}:00+05:30`;
let n = 0;
const register = (u: Person, body: Record<string, unknown>) => u.c.post('/registrations', body, { token: u.token, headers: { 'idempotency-key': `rf-${Date.now().toString(36)}-${++n}-abcdefgh` } });
const drain = () => t.app.get(JobsService).drain();

async function newFest() {
  const admin = as(root);
  const f = (await admin.post('/admin/global-events', { name: `Refund Fest ${++n}`, editionYear: 2027, departmentIds: [dept.CSE], startsAt: at('08:00'), endsAt: at('18:00', '2027-03-13') })).body;
  const o = await admin.post(`/admin/global-events/${f.id}/events`, { name: 'Opening', category: 'TECHNICAL', departmentId: dept.CSE, description: 'x', startsAt: at('08:00'), venue: 'Hall' });
  await admin.post(`/admin/local-events/${o.body.id}/publish`);
  await admin.post(`/admin/global-events/${f.id}/publish`);
  return f;
}
async function liveEvent(festId: string, over: Record<string, unknown> = {}) {
  const r = await as(root).post(`/admin/global-events/${festId}/events`, {
    name: `Paid ${++n}`,
    category: 'WORKSHOP',
    departmentId: dept.CSE,
    description: 'x',
    startsAt: at(`${String(9 + (n % 9)).padStart(2, '0')}:00`, n % 2 ? '2027-03-12' : '2027-03-13'),
    venue: 'Lab',
    pricing: { type: 'PAID', amountPaise: 30_000, per: 'MEMBER', modes: ['ONLINE'] },
    ...over,
  });
  await as(root).post(`/admin/local-events/${r.body.id}/publish`);
  return r.body;
}
/** Register and pay online through the simulated gateway. */
async function paid(u: Person, eventId: string) {
  const reg = (await register(u, { eventId, paymentMode: 'ONLINE' })).body;
  const o = (await as(u).post(`/registrations/${reg.code}/order`)).body;
  const pay = gw.pay(o.gatewayOrderId);
  await as(u).post(`/orders/${o.orderCode}/verify`, { gatewayOrderId: o.gatewayOrderId, ...pay });
  return { reg, order: o, paymentId: pay.paymentId };
}

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  finance = await makeUser(t, [['FINANCE', 'ORG']]);
  dept = Object.fromEntries((await client(t.app).get('/departments')).body.map((d: any) => [d.code, d.id]));
  gw = t.app.get(PAYMENT_GATEWAY);
});
afterAll(async () => {
  await t?.close();
});

describe('refund requests', () => {
  it('leader asks → finance approves → seat back, tickets void, money back once, emails sent', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id, { seatsTotal: 5 });
    const p = await makeUser(t, []);
    const { reg, paymentId } = await paid(p, e.id);

    const r = await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Exam moved to that day' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'REQUESTED', amountPaise: 30_000, source: 'REQUEST', mode: 'ONLINE' });
    expect((await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Again please' })).body.code).toBe('ALREADY_REQUESTED');
    expect((await as(p).get('/refunds/my')).body.items[0]).toMatchObject({ id: r.body.id, registrationCode: reg.code });

    const list = await as(finance).get(`/admin/refunds?festId=${f.id}&status=REQUESTED`);
    expect(list.body.items.map((x: any) => x.id)).toEqual([r.body.id]);
    expect(list.body.counts).toMatchObject({ REQUESTED: 1 });

    const ok = await as(finance).post(`/admin/refunds/${r.body.id}/approve`);
    expect(ok.body.status).toBe('QUEUED');
    expect((await as(finance).post(`/admin/refunds/${r.body.id}/approve`)).body.code).toBe('NOT_PENDING');
    const after = (await as(p).get(`/registrations/${reg.code}`)).body;
    expect(after.status).toBe('CANCELLED');
    expect(after.ticket.status).toBe('VOID');

    await drain();
    expect(gw.refunds.filter((x) => x.paymentId === paymentId)).toEqual([{ paymentId, amountPaise: 30_000 }]);
    expect((await as(p).get('/refunds/my')).body.items[0].status).toBe('SUCCEEDED');
    expect((await as(p).get(`/registrations/${reg.code}`)).body.payment.status).toBe('REFUNDED');
    expect((await as(root).get(`/admin/local-events/${e.id}`)).body).toMatchObject({ seatsConfirmed: 0 });
    expect(t.outbox.some((m) => m.to === p.email && m.subject.startsWith('Refund on its way'))).toBe(true);

    // A retried job (timeout after the gateway already refunded) changes nothing and pays nothing twice.
    await t.app.get(RefundsService).process(new Types.ObjectId(r.body.id));
    expect(gw.refunds.filter((x) => x.paymentId === paymentId)).toHaveLength(1);
  });

  it('a refund the gateway refused can be tried again on its own, once however many clicks', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id);
    const p = await makeUser(t, []);
    const { reg, paymentId } = await paid(p, e.id);
    const r = (await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Clash with my exam' })).body;
    gw.failNextRefund = 'The payment is not captured yet';
    await as(finance).post(`/admin/refunds/${r.id}/approve`);
    await drain();
    expect((await as(finance).get(`/admin/refunds?festId=${f.id}&status=FAILED`)).body.items[0]).toMatchObject({ id: r.id, failure: 'The payment is not captured yet' });

    expect((await as(p).post(`/admin/refunds/${r.id}/retry`)).status).toBe(403);
    const tries = await Promise.all([1, 2].map(() => as(finance).post(`/admin/refunds/${r.id}/retry`)));
    expect(tries.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(tries.find((x) => x.status === 409)!.body.code).toBe('NOT_FAILED');
    await drain();
    expect((await as(p).get('/refunds/my')).body.items[0]).toMatchObject({ status: 'SUCCEEDED', failure: null });
    expect(gw.refunds.filter((x) => x.paymentId === paymentId)).toHaveLength(1);
  });

  it('who can ask, and when', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id, { participation: 'TEAM', teamMin: 2, teamMax: 2 });
    const [p, q] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    const reg = (await register(p, { eventId: e.id, teammates: [{ name: q.name, email: q.email }] })).body;
    expect((await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Changed plans' })).body.code).toBe('NOT_REFUNDABLE'); // not paid yet
    const o = (await as(p).post(`/registrations/${reg.code}/order`)).body;
    await as(p).post(`/orders/${o.orderCode}/verify`, { gatewayOrderId: o.gatewayOrderId, ...gw.pay(o.gatewayOrderId) });
    expect((await as(q).post(`/registrations/${reg.code}/refund-request`, { reason: 'Changed plans' })).body.code).toBe('LEADER_ONLY');

    await t.conn.collection('tickets').updateOne({ registration_code: reg.code, member_email: q.email }, { $set: { status: 'USED' } });
    expect((await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Changed plans' })).body.code).toBe('TICKET_USED');
    await t.conn.collection('registrations').updateOne({ code: reg.code }, { $set: { starts_at: new Date(Date.now() + 3_600_000) } });
    expect((await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Changed plans' })).body.code).toBe('REFUND_WINDOW_CLOSED');

    const free = await liveEvent(f.id, { pricing: { type: 'FREE' } });
    const solo = await makeUser(t, []); // own person: p's schedule may clash with the free event's slot
    const rf = (await register(solo, { eventId: free.id })).body;
    expect((await as(solo).post(`/registrations/${rf.code}/refund-request`, { reason: 'Changed plans' })).body.code).toBe('NOT_REFUNDABLE');
  });

  it('a rejected request keeps the registration and can be asked again', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id);
    const p = await makeUser(t, []);
    const { reg } = await paid(p, e.id);
    const r = (await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Not sure I can come' })).body;
    expect((await as(finance).post(`/admin/refunds/${r.id}/reject`, {})).status).toBe(400); // note required
    const no = await as(finance).post(`/admin/refunds/${r.id}/reject`, { note: 'Ask again 2 days before if still unsure' });
    expect(no.body).toMatchObject({ status: 'REJECTED', note: 'Ask again 2 days before if still unsure' });
    expect((await as(p).get(`/registrations/${reg.code}`)).body.status).toBe('CONFIRMED');
    expect((await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Definitely cannot come now' })).status).toBe(201);
  });

  it('only finance (or a Super Admin) decides, within scope', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id);
    const p = await makeUser(t, []);
    const { reg } = await paid(p, e.id);
    const r = (await as(p).post(`/registrations/${reg.code}/refund-request`, { reason: 'Cannot attend' })).body;
    const cse = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);
    const otherFinance = await makeUser(t, [['FINANCE', 'GLOBAL_EVENT', new Types.ObjectId().toHexString(), 'Other']]);
    expect((await as(cse).post(`/admin/refunds/${r.id}/approve`)).status).toBe(403);
    expect((await as(otherFinance).post(`/admin/refunds/${r.id}/approve`)).status).toBe(404);
    expect((await as(p).post(`/admin/refunds/${r.id}/approve`)).status).toBe(403);
  });
});

describe('cancelled events', () => {
  it('cancelling an event refunds every paid entry: online automatically, cash listed for the desk', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id, { pricing: { type: 'PAID', amountPaise: 20_000, per: 'TEAM', modes: ['ONLINE', 'OFFLINE'] } });
    const people = await Promise.all([1, 2, 3, 4].map(() => makeUser(t, [])));
    for (const u of people.slice(0, 2)) await paid(u, e.id);
    const cash = (await register(people[2], { eventId: e.id, paymentMode: 'OFFLINE' })).body;
    await as(root).post(`/admin/registrations/${cash.code}/collect`, { amountPaise: 20_000 });
    const unpaid = (await register(people[3], { eventId: e.id, paymentMode: 'OFFLINE' })).body; // owes money: nothing to refund

    const c = await as(root).post(`/admin/local-events/${e.id}/cancel`, { reason: 'Speaker unavailable' });
    expect(c.body.status).toBe('CANCELLED');
    await drain();

    const [batch] = (await as(finance).get(`/admin/refund-batches?festId=${f.id}`)).body.items;
    expect(batch).toMatchObject({ eventName: e.name, total: 3, succeeded: 2, manual: 0, status: 'RUNNING' });
    const manual = (await as(finance).get(`/admin/refunds?festId=${f.id}&status=MANUAL_PENDING`)).body.items;
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ registrationCode: cash.code, mode: 'OFFLINE', source: 'EVENT_CANCELLED' });
    await as(finance).post(`/admin/refunds/${manual[0].id}/mark-paid`, { note: 'Handed back at the CSE desk' });
    expect((await as(finance).get(`/admin/refund-batches?festId=${f.id}`)).body.items[0]).toMatchObject({ manual: 1, status: 'COMPLETED' });

    expect((await as(people[3]).get(`/registrations/${unpaid.code}`)).body).toMatchObject({ status: 'CANCELLED', payment: { status: 'DUE' } });
    expect((await as(people[0]).get('/refunds/my')).body.items[0]).toMatchObject({ status: 'SUCCEEDED', source: 'EVENT_CANCELLED' });
    // The cancel job running again creates nothing new.
    await t.app.get(RefundsService).refundCancelledEvent(new Types.ObjectId(e.id), 'again', null);
    expect(await t.conn.collection('refunds').countDocuments({ local_event_id: new Types.ObjectId(e.id) })).toBe(3);
  });

  it('low gateway balance pauses the batch; "resume" finishes it', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id);
    const [p, q] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    await paid(p, e.id);
    await paid(q, e.id);
    gw.failNextRefund = 'Your account does not have sufficient balance to carry out the refund operation (insufficient balance)';
    await as(root).post(`/admin/local-events/${e.id}/cancel`, { reason: 'Venue flooded' });
    await drain();
    let [batch] = (await as(finance).get(`/admin/refund-batches?festId=${f.id}`)).body.items;
    expect(batch).toMatchObject({ status: 'PAUSED', failed: 1, succeeded: 1, pausedReason: expect.stringContaining('balance') });
    const failed = (await as(finance).get(`/admin/refunds?festId=${f.id}&status=FAILED`)).body.items;
    expect(failed[0].failure).toBe('GATEWAY_INSUFFICIENT_FUNDS');

    expect((await as(finance).post(`/admin/refund-batches/${batch.id}/resume`)).body).toEqual({ requeued: 1 });
    await drain();
    [batch] = (await as(finance).get(`/admin/refund-batches?festId=${f.id}`)).body.items;
    expect(batch).toMatchObject({ status: 'COMPLETED', succeeded: 2, failed: 0 });
  });

  it('a Super Admin can cancel a whole fest: every event cancelled and refunded; twice → ALREADY_CANCELLED', async () => {
    const f = await newFest();
    const [e1, e2] = [await liveEvent(f.id), await liveEvent(f.id)];
    const [p, q] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    await paid(p, e1.id);
    await paid(q, e2.id);
    expect((await as(finance).post(`/admin/global-events/${f.id}/cancel`, { reason: 'Rain' })).status).toBe(403);
    const c = await as(root).post(`/admin/global-events/${f.id}/cancel`, { reason: 'Cyclone warning' });
    expect(c.body).toMatchObject({ status: 'CANCELLED', eventsCancelled: 3 });
    expect((await as(root).post(`/admin/global-events/${f.id}/cancel`, { reason: 'Cyclone warning' })).body.code).toBe('ALREADY_CANCELLED');
    await drain();
    const batches = (await as(finance).get(`/admin/refund-batches?festId=${f.id}`)).body.items;
    expect(batches).toHaveLength(3);
    expect(batches.reduce((s: number, b: any) => s + b.succeeded, 0)).toBe(2);
  });

  it('a refund that later fails at the bank (webhook) is flagged and the batch paused', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id);
    const p = await makeUser(t, []);
    await paid(p, e.id);
    await as(root).post(`/admin/local-events/${e.id}/cancel`, { reason: 'Clash with exams' });
    await drain();
    const r = await t.conn.collection('refunds').findOne({ local_event_id: new Types.ObjectId(e.id) });
    const raw = JSON.stringify({ event: 'refund.failed', payload: { refund: { entity: { id: r!.gateway_refund_id, status: 'failed', error_description: 'Bank account closed' } } } });
    const hook = await t.app.inject({ method: 'POST', url: '/api/v1/webhooks/razorpay', payload: raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': gw.signWebhook(raw), 'x-razorpay-event-id': `evt_${r!._id}` } });
    expect(hook.statusCode).toBe(200);
    expect((await as(p).get('/refunds/my')).body.items[0]).toMatchObject({ status: 'FAILED', failure: 'Bank account closed' });
    expect((await as(finance).get(`/admin/refund-batches?festId=${f.id}`)).body.items[0]).toMatchObject({ status: 'PAUSED', failed: 1, succeeded: 0 });
  });

  it('an event restored after a cancel and cancelled again refunds its new paid entries too', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id);
    const [a, b] = await Promise.all([makeUser(t, []), makeUser(t, [])]);
    await paid(a, e.id);
    await as(root).post(`/admin/local-events/${e.id}/cancel`, { reason: 'Clash with exams' });
    await drain();
    // Restored by hand (there's no "un-cancel" in the app): live again, seats free.
    await t.conn.collection('local_events').updateOne({ _id: new Types.ObjectId(e.id) }, { $set: { status: 'PUBLISHED', status_reason: null, seats_confirmed: 0 }, $inc: { version: 1 } });
    const second = await paid(b, e.id);
    expect((await as(root).post(`/admin/local-events/${e.id}/cancel`, { reason: 'Clash again' })).body.status).toBe('CANCELLED');
    await drain();
    expect(gw.refunds.filter((x) => x.paymentId === second.paymentId)).toHaveLength(1);
    expect((await as(b).get('/refunds/my')).body.items[0]).toMatchObject({ status: 'SUCCEEDED', source: 'EVENT_CANCELLED' });
    expect((await as(finance).get(`/admin/refund-batches?festId=${f.id}`)).body.items[0]).toMatchObject({ total: 2, succeeded: 2, status: 'COMPLETED' });
  });

  it('payments taken by the simulator (before the Razorpay keys were set) refund locally, without calling Razorpay', async () => {
    const f = await newFest();
    const e = await liveEvent(f.id);
    const p = await makeUser(t, []);
    const { paymentId } = await paid(p, e.id);
    const svc = t.app.get(RefundsService) as unknown as { gateway: unknown };
    const calls: string[] = [];
    svc.gateway = {
      name: 'razorpay',
      refund: async (id: string) => {
        calls.push(id);
        throw new GatewayError(`${id.slice(4)} is not a valid id`, 400);
      },
    };
    try {
      await as(root).post(`/admin/local-events/${e.id}/cancel`, { reason: 'Judges unavailable' });
      await drain();
    } finally {
      svc.gateway = gw;
    }
    expect(calls).toEqual([]);
    expect(gw.refunds.some((x) => x.paymentId === paymentId)).toBe(false);
    expect((await as(p).get('/refunds/my')).body.items[0]).toMatchObject({ status: 'SUCCEEDED', source: 'EVENT_CANCELLED' });
    expect((await as(finance).get(`/admin/refund-batches?festId=${f.id}`)).body.items[0]).toMatchObject({ status: 'COMPLETED', succeeded: 1, failed: 0 });
  });

  it('refund lookups use indexes', async () => {
    const R = t.conn.models.Refund;
    const id = new Types.ObjectId();
    await expectIndexed(R.find({ global_event_id: id, status: 'REQUESTED' }).sort({ _id: -1 }));
    await expectIndexed(R.find({ leader_user_id: id }).sort({ _id: -1 }));
    await expectIndexed(R.find({ batch_id: id, status: 'FAILED' }));
    await expectIndexed(R.find({ key: 'pay:x' }));
  });
});
