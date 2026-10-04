import http from 'node:http';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import { MockGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { csvCell } from '../src/reports/exports.service';
import { StatsService } from '../src/stats/stats.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let dept: Record<string, string>;
let gw: MockGateway;
let port: number;

type Person = Awaited<ReturnType<typeof makeUser>>;
const as = (u: Person) => ({
  get: (url: string) => u.c.get(url, { token: u.token }),
  post: (url: string, body: unknown = {}) => u.c.post(url, body, { token: u.token }),
});
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
let n = 0;
const register = (u: Person, body: Record<string, unknown>) => u.c.post('/registrations', body, { token: u.token, headers: { 'idempotency-key': `rp-${Date.now().toString(36)}-${++n}-abcdefgh` } });

async function newFest(name: string, editionYear = 2027) {
  const admin = as(root);
  const f = (await admin.post('/admin/global-events', { name, editionYear, departmentIds: [dept.CSE, dept.IT], startsAt: inMinutes(30), endsAt: inMinutes(60 * 48) })).body;
  await event(f.id);
  await admin.post(`/admin/global-events/${f.id}/publish`);
  return f;
}
async function event(festId: string, over: Record<string, unknown> = {}) {
  const r = await as(root).post(`/admin/global-events/${festId}/events`, {
    name: `Report ${++n}`,
    category: 'TECHNICAL',
    departmentId: dept.CSE,
    description: 'x',
    startsAt: inMinutes(60 + n * 150),
    venue: 'Hall',
    ...over,
  });
  await as(root).post(`/admin/local-events/${r.body.id}/publish`);
  return r.body;
}

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  dept = Object.fromEntries((await client(t.app).get('/departments')).body.map((d: any) => [d.code, d.id]));
  gw = t.app.get(PAYMENT_GATEWAY);
  await t.app.listen(0, '127.0.0.1');
  port = (t.app.getHttpServer().address() as { port: number }).port;
});
afterAll(async () => {
  await t?.close();
});

describe('dashboard counters', () => {
  let fest: any;
  let cseEvent: any;
  let itEvent: any;

  it('registrations, money in/out and check-ins land in the overview; scoped and money-gated', async () => {
    fest = await newFest('Stats Fest 2027');
    cseEvent = await event(fest.id, { participation: 'TEAM', teamMin: 2, teamMax: 2, startsAt: inMinutes(60) }); // check-in open
    itEvent = await event(fest.id, { departmentId: dept.IT, startsAt: inMinutes(60 * 72), pricing: { type: 'PAID', amountPaise: 20_000, per: 'TEAM', modes: ['ONLINE', 'OFFLINE'] } });
    const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map(() => makeUser(t, [])));

    const team = (await register(a, { eventId: cseEvent.id, teammates: [{ name: 'Mate One', email: `mate-${n}@x.io` }] })).body; // 1 reg, 2 people
    const online = (await register(b, { eventId: itEvent.id, paymentMode: 'ONLINE' })).body;
    const o = (await as(b).post(`/registrations/${online.code}/order`)).body;
    await as(b).post(`/orders/${o.orderCode}/verify`, { gatewayOrderId: o.gatewayOrderId, ...gw.pay(o.gatewayOrderId) }); // ₹200 in
    const desk = (await register(c, { eventId: itEvent.id, paymentMode: 'OFFLINE' })).body;
    await as(root).post(`/admin/registrations/${desk.code}/collect`, { amountPaise: 20_000 }); // ₹200 in
    const gone = (await register(d, { eventId: cseEvent.id, teammates: [{ name: 'Mate Two', email: `mate2-${n}@x.io` }] })).body;
    await as(d).post(`/registrations/${gone.code}/cancel`); // a cancellation
    const scanner = await makeUser(t, [['SCANNER', 'GLOBAL_EVENT', fest.id, 'Stats']]);
    await scanner.c.post(`/checkins/${cseEvent.id}/scan`, { code: team.ticket.code }, { token: scanner.token }); // a check-in
    // Refund the desk entry (approved request → cash to hand back → handed back).
    const rf = (await as(c).post(`/registrations/${desk.code}/refund-request`, { reason: 'Cannot come' })).body;
    await as(root).post(`/admin/refunds/${rf.id}/approve`);
    await as(root).post(`/admin/refunds/${rf.id}/mark-paid`, {});
    await t.app.get(JobsService).drain();

    const ov = (await as(root).get(`/reports/overview?festId=${fest.id}`)).body;
    expect(ov.totals).toEqual({ registrations: 4, people: 6, cancellations: 2, checkins: 1, revenuePaise: 40_000, refundsPaise: 20_000, netPaise: 20_000 });
    expect(ov.daily).toHaveLength(1);
    expect(ov.departments.map((x: any) => x.code).sort()).toEqual(['CSE', 'IT']);
    expect(ov.topEvents[0]).toMatchObject({ id: cseEvent.id, people: 4 });

    const cseAdmin = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);
    const scoped = (await as(cseAdmin).get(`/reports/overview?festId=${fest.id}`)).body;
    expect(scoped.totals).toMatchObject({ registrations: 2, people: 4, revenuePaise: null, netPaise: null }); // CSE only, no money
    const finance = await makeUser(t, [['FINANCE', 'ORG']]);
    expect((await as(finance).get(`/reports/overview?festId=${fest.id}`)).body.totals.revenuePaise).toBe(40_000);
    expect((await as(a).get(`/reports/overview?festId=${fest.id}`)).status).toBe(403);
  });

  it('rebuilding from the source collections gives the same numbers', async () => {
    const before = (await as(root).get(`/reports/overview?festId=${fest.id}`)).body.totals;
    await t.conn.collection('daily_stats').deleteMany({ global_event_id: new Types.ObjectId(fest.id) });
    expect((await as(root).get(`/reports/overview?festId=${fest.id}`)).body.totals.registrations).toBe(0);
    const r = await as(root).post(`/reports/rebuild?festId=${fest.id}`);
    expect(r.body.days).toBeGreaterThan(0);
    expect((await as(root).get(`/reports/overview?festId=${fest.id}`)).body.totals).toEqual(before);
  });

  it('compares with the previous edition; lists top colleges', async () => {
    const old = await newFest('Stats Fest 2026', 2026);
    const p = await makeUser(t, []);
    await register(p, { eventId: (await event(old.id)).id });
    const ov = (await as(root).get(`/reports/overview?festId=${fest.id}`)).body;
    expect(ov.previous).toMatchObject({ fest: { id: old.id, editionYear: 2026 }, totals: { registrations: 1 } });
    await t.conn.collection('registrations').updateMany({ global_event_id: new Types.ObjectId(fest.id), 'members.leader': true }, { $set: { 'members.$.college': 'National Engineering College' } });
    const col = (await as(root).get(`/reports/colleges?festId=${fest.id}`)).body;
    expect(col.items[0]).toMatchObject({ college: 'National Engineering College' });
  });

  it('exports CSV: one row per person, masked unless allowed, formulas neutralised, signed with who exported', async () => {
    await t.conn.collection('registrations').updateOne({ global_event_id: new Types.ObjectId(fest.id), status: 'CONFIRMED' }, { $set: { team_name: '=HYPERLINK("http://evil")' } });
    const get = (who: Person) => t.app.inject({ method: 'GET', url: `/api/v1/exports/registrations.csv?festId=${fest.id}`, headers: { authorization: `Bearer ${who.token}` } });
    const full = await get(root);
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toContain('text/csv');
    expect(full.headers['content-disposition']).toContain('registrations.csv');
    const lines = full.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain(`exported by ${root.name}`);
    expect(lines[1]).toContain('Registration,Event,Department');
    expect(lines.length - 2).toBe(6); // every person of every registration (incl. cancelled)
    expect(full.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(full.body).toMatch(/@x\.io/);
    expect(full.body).toContain('yes'); // checked in

    const cseAdmin = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);
    const masked = await get(cseAdmin);
    expect(masked.body).toContain('Emails and phones masked');
    expect(masked.body).not.toMatch(/mate-\d+@x\.io/);
    expect(masked.body).toMatch(/m\*\*\*@x\.io/);
    expect(masked.body).not.toContain(itEvent.name); // CSE scope only
    expect(csvCell('-2+3')).toBe("'-2+3");
  });
});

describe('live updates', () => {
  const open = (path: string) =>
    new Promise<{ res: http.IncomingMessage; req: http.ClientRequest; chunks: string[] }>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
        const chunks: string[] = [];
        res.setEncoding('utf8');
        res.on('data', (c) => chunks.push(c));
        resolve({ res, req, chunks });
      });
      req.on('error', reject);
    });
  const until = async (fn: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('a pass opens the stream; registrations arrive as ticks; disconnecting removes the listener', async () => {
    const fest = await newFest('Live Fest 2027');
    const e = await event(fest.id);
    const bus = t.app.get(StatsService).bus;
    const channel = `fest:${fest.id}`;
    expect((await open(`/api/v1/live/fests/${fest.id}?pass=forged.${fest.id}.zz.abc`)).res.statusCode).toBe(401);

    const { pass } = (await as(root).post(`/live/pass?festId=${fest.id}`)).body;
    const s = await open(`/api/v1/live/fests/${fest.id}?pass=${encodeURIComponent(pass)}`);
    expect(s.res.headers['content-type']).toBe('text/event-stream');
    await until(() => s.chunks.join('').includes('event: hello'));
    expect(bus.listenerCount(channel)).toBe(1);

    const p = await makeUser(t, []);
    await register(p, { eventId: e.id });
    await until(() => s.chunks.join('').includes('event: tick'));
    expect(s.chunks.join('')).toContain('"registrations":1');

    s.req.destroy();
    await until(() => bus.listenerCount(channel) === 0);
    // A pass only works for its own fest.
    const other = await newFest('Other Live 2027');
    expect((await open(`/api/v1/live/fests/${other.id}?pass=${encodeURIComponent(pass)}`)).res.statusCode).toBe(401);
  });

  it('200 connect/disconnect cycles leave no listeners behind', async () => {
    const fest = await newFest('Churn Fest 2027');
    const bus = t.app.get(StatsService).bus;
    const { pass } = (await as(root).post(`/live/pass?festId=${fest.id}`)).body;
    for (let i = 0; i < 200; i++) {
      const s = await open(`/api/v1/live/fests/${fest.id}?pass=${encodeURIComponent(pass)}`);
      s.req.destroy();
    }
    await until(() => bus.listenerCount(`fest:${fest.id}`) === 0, 5000);
  }, 30_000);

  it('dashboard reads use indexes', async () => {
    const S = t.conn.models.DailyStat;
    await expectIndexed(S.find({ global_event_id: new Types.ObjectId() }));
    await expectIndexed(S.find({ local_event_id: new Types.ObjectId(), day: { $gte: '2027-01-01' } }));
  });
});
