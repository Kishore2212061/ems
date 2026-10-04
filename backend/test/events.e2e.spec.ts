import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventSeedService } from '../src/local-events/event-seed.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { expectIndexed } from './helpers/explain';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let dept: Record<string, string>; // code → id

const SEED = JSON.parse(readFileSync(resolve(__dirname, '../seed/techfest-2025.json'), 'utf8'));
const LIVE_FEST = 'nec-tech-fest-25';

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  const r = await client(t.app).get('/departments');
  dept = Object.fromEntries(r.body.map((d: any) => [d.code, d.id]));
});
afterAll(async () => {
  await t?.close();
});

const START = '2027-03-14T10:00:00+05:30';
const as = (u: { token: string; c: any }) => ({
  get: (url: string) => u.c.get(url, { token: u.token }),
  post: (url: string, body: unknown = {}) => u.c.post(url, body, { token: u.token }),
  patch: (url: string, body: unknown) => u.c.patch(url, body, { token: u.token }),
  del: (url: string) => u.c.del(url, { token: u.token }),
});
let api: ReturnType<typeof as>;
beforeAll(() => {
  api = as(root);
});

async function newFest(over: Record<string, unknown> = {}) {
  const r = await api.post('/admin/global-events', {
    name: `Fest ${Math.random().toString(36).slice(2, 7)}`,
    editionYear: 2027,
    departmentIds: [dept.CSE, dept.IT],
    startsAt: '2027-03-14T09:00:00+05:30',
    endsAt: '2027-03-15T17:00:00+05:30',
    ...over,
  });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body;
}

async function newEvent(festId: string, over: Record<string, unknown> = {}, who = api) {
  const r = await who.post(`/admin/global-events/${festId}/events`, {
    name: 'Blind Coding',
    category: 'TECHNICAL',
    departmentId: dept.CSE,
    description: 'Code with the monitor off.',
    startsAt: START,
    venue: 'CSE Lab 1',
    ...over,
  });
  if (r.status !== 201) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

describe("seed import: NEC Tech Fest '25", () => {
  it('imports the real catalogue once; running it again changes nothing', async () => {
    const seed = t.app.get(EventSeedService);
    const first = await seed.importFile(SEED);
    expect(first).toMatchObject({ festSlug: LIVE_FEST, festCreated: true, inserted: 123, existing: 0 });

    const sample = await t.conn.collection('local_events').findOne({ slug: 'blind-coding' });
    const again = await seed.importFile(SEED);
    expect(again).toMatchObject({ festCreated: false, inserted: 0, existing: 123, departmentsAdded: 0 });
    expect((await t.conn.collection('local_events').findOne({ slug: 'blind-coding' }))!.updated_at).toEqual(sample!.updated_at);

    const fest = (await client(t.app).get(`/global-events/${LIVE_FEST}`)).body;
    expect(fest).toMatchObject({ name: "NEC Tech Fest '25", status: 'COMPLETED' });
    expect(fest.departments.map((d: any) => d.code)).toEqual(['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL', 'AIDS', 'SH']);
  });

  it('re-running swaps old hotlinked posters for the self-hosted copies, never an organiser-set image', async () => {
    const col = t.conn.collection('local_events');
    const fest = await t.conn.collection('global_events').findOne({ slug: LIVE_FEST });
    const at = (slug: string) => ({ global_event_id: fest!._id, slug });
    await col.updateOne(at('blind-coding'), { $set: { banner_url: 'https://techfestnec.vercel.app/events/it/blind-coding.webp' } });
    await col.updateOne(at('code-relay'), { $set: { banner_url: 'https://techfestnec.vercel.app/events/it/Code%20Relay.webp' } });
    await col.updateOne(at('sql-treasure-hunt'), { $set: { banner_url: 'https://cdn.example.com/organiser-upload.webp' } });

    const r = await t.app.get(EventSeedService).importFile(SEED);
    expect(r).toMatchObject({ inserted: 0, imagesUpdated: 2 });
    expect((await col.findOne(at('blind-coding')))!.banner_url).toBe('/media/tf25/blind-coding.webp');
    expect((await col.findOne(at('code-relay')))!.banner_url).toBe('/media/tf25/code-relay.webp');
    expect((await col.findOne(at('sql-treasure-hunt')))!.banner_url).toBe('https://cdn.example.com/organiser-upload.webp');
  });

  it('rejects a malformed seed file with readable reasons', async () => {
    const bad = { ...SEED, events: [{ ...SEED.events[0], teamMin: 3, teamMax: 2 }] };
    await expect(t.app.get(EventSeedService).importFile(bad)).rejects.toThrow(/events\.0\.teamMax/);
  });
});

describe('public catalogue', () => {
  it('pages through every event in time order with a cursor, plus chip counts', async () => {
    const seen: any[] = [];
    let cursor: string | null = null;
    let facets: any;
    do {
      const r: any = await client(t.app).get(`/global-events/${LIVE_FEST}/events?limit=50${cursor ? `&cursor=${cursor}` : ''}`);
      expect(r.status).toBe(200);
      if (!cursor) {
        facets = r.body.facets;
        expect(r.headers['cache-control']).toBe('public, max-age=60');
      } else expect(r.body.facets).toBeUndefined();
      seen.push(...r.body.items);
      cursor = r.body.nextCursor;
    } while (cursor);

    expect(new Set(seen.map((e) => e.id)).size).toBe(123);
    const times = seen.map((e) => e.startsAt);
    expect(times).toEqual([...times].sort());

    const count = (key: string) => SEED.events.reduce((m: Record<string, number>, e: any) => (e[key] ? ((m[e[key]] = (m[e[key]] ?? 0) + 1), m) : m), {});
    // Seed times carry +05:30, so their first 10 characters are the college-time day.
    const days = Object.entries(SEED.events.reduce((m: Record<string, number>, e: any) => ((m[e.startsAt.slice(0, 10)] = (m[e.startsAt.slice(0, 10)] ?? 0) + 1), m), {})).map(([day, n]) => ({ day, n }));
    expect(days).toHaveLength(2);
    expect(facets).toEqual({ total: 123, departments: count('department'), categories: count('category'), paid: 0, days });
  });

  it('list cards are small: no description, rules or people', async () => {
    const r = await client(t.app).get(`/global-events/${LIVE_FEST}/events?limit=50`);
    for (const e of r.body.items) {
      expect(e).not.toHaveProperty('description');
      expect(e).not.toHaveProperty('rules');
      expect(e).not.toHaveProperty('coordinators');
      expect(JSON.stringify(e).length).toBeLessThan(1024);
    }
  });

  it('filters by department, category and price', async () => {
    const get = async (qs: string) => (await client(t.app).get(`/global-events/${LIVE_FEST}/events?limit=50&${qs}`)).body.items;
    const it_ = await get('dept=it');
    expect(it_).toHaveLength(SEED.events.filter((e: any) => e.department === 'IT').length);
    expect(it_.every((e: any) => e.department.code === 'IT')).toBe(true);

    const workshops = await get('category=WORKSHOP');
    expect(workshops.every((e: any) => e.category === 'WORKSHOP' && e.seatsTotal === 30 && e.seatsLeft === 30)).toBe(true);
    expect(await get('dept=XYZ')).toEqual([]);
    expect((await client(t.app).get(`/global-events/${LIVE_FEST}/events?free=1`)).body.facets.total).toBe(123);
  });

  it('searches by relevance; regex characters are just text', async () => {
    const r = await client(t.app).get(`/global-events/${LIVE_FEST}/events?q=blind%20coding`);
    expect(r.body.items[0].slug).toBe('blind-coding');
    const weird = await client(t.app).get(`/global-events/${LIVE_FEST}/events?q=${encodeURIComponent('(.*+?[')}`);
    expect(weird.status).toBe(200);
    expect(Array.isArray(weird.body.items)).toBe(true);
    expect((await client(t.app).get(`/global-events/${LIVE_FEST}/events?cursor=garbage`)).status).toBe(400);
  });

  it('event page has the full story; unknown events are 404', async () => {
    const r = await client(t.app).get(`/global-events/${LIVE_FEST}/events/blind-coding`);
    expect(r.headers['cache-control']).toBe('public, max-age=30');
    expect(r.body).toMatchObject({
      name: 'Blind Coding',
      department: { code: 'IT' },
      participation: 'TEAM',
      teamMin: 2,
      teamMax: 2,
      status: 'COMPLETED',
      fest: { slug: LIVE_FEST, status: 'COMPLETED' },
    });
    expect(r.body.rules).toHaveLength(2);
    // Sample people from the seed file (made up, not the real coordinators).
    const sample = SEED.events.find((x: any) => x.slug === 'blind-coding').coordinators[1];
    expect(r.body.coordinators[1]).toEqual({ name: sample.name, phone: sample.phone, role: 'STUDENT' });
    expect(sample.name).not.toBe('Manoj Kumar B');
    expect((await client(t.app).get(`/global-events/${LIVE_FEST}/events/nope`)).status).toBe(404);
  });
});

describe('authoring', () => {
  it('drafts stay private; events show publicly once both they and the fest are live', async () => {
    const f = await newFest();
    const e = await newEvent(f.id, { name: 'Code Relay' });
    expect(e).toMatchObject({ slug: 'code-relay', status: 'DRAFT', department: { code: 'CSE' }, version: 0 });

    // A fest needs a live event before it can go public.
    expect((await api.post(`/admin/global-events/${f.id}/publish`)).body).toMatchObject({ code: 'PUBLISH_REQUIREMENTS', details: { missing: ['events'] } });
    expect((await api.post(`/admin/local-events/${e.id}/publish`)).body.status).toBe('PUBLISHED');
    expect((await client(t.app).get(`/global-events/${f.slug}/events`)).status).toBe(404); // fest still a draft
    expect((await api.post(`/admin/global-events/${f.id}/publish`)).body.status).toBe('PUBLISHED');
    expect((await client(t.app).get(`/global-events/${f.slug}/events`)).body.items.map((x: any) => x.slug)).toEqual(['code-relay']);

    const draft = await newEvent(f.id, { name: 'Secret Draft' });
    expect((await client(t.app).get(`/global-events/${f.slug}/events/${draft.slug}`)).status).toBe(404);
  });

  it('validates team sizes, dates and price', async () => {
    const f = await newFest();
    const bad = async (over: Record<string, unknown>) => (await api.post(`/admin/global-events/${f.id}/events`, { name: 'X Event', category: 'TECHNICAL', departmentId: dept.CSE, ...over })).body;
    expect((await bad({ participation: 'TEAM', teamMin: 3, teamMax: 2 })).details.fields).toHaveProperty('teamMax');
    expect((await bad({ participation: 'INDIVIDUAL', teamMax: 2 })).details.fields).toHaveProperty('teamMax');
    expect((await bad({ startsAt: START, endsAt: '2027-03-14T09:00:00+05:30' })).details.fields).toHaveProperty('endsAt');
    expect((await bad({ startsAt: START, registrationClosesAt: '2027-03-14T11:00:00+05:30' })).details.fields).toHaveProperty('registrationClosesAt');
    expect((await bad({ pricing: { type: 'PAID', amountPaise: 0, modes: ['ONLINE'] } })).details.fields).toHaveProperty(['pricing.amountPaise']);
    expect((await bad({ pricing: { type: 'PAID', amountPaise: 15000 } })).details.fields).toHaveProperty(['pricing.modes']); // how to pay is required
    expect((await bad({ departmentId: dept.MECH })).code).toBe('DEPARTMENT_NOT_IN_FEST');

    const free = await newEvent(f.id, { name: 'Free One', pricing: { type: 'FREE', amountPaise: 5000, modes: ['ONLINE'] } });
    expect(free.pricing).toEqual({ type: 'FREE', amountPaise: 0, per: 'TEAM', modes: [] });
    const both = await newEvent(f.id, { name: 'Either Way', pricing: { type: 'PAID', amountPaise: 10000, modes: ['OFFLINE', 'ONLINE'] } });
    expect(both.pricing.modes).toEqual(['OFFLINE', 'ONLINE']);

    // Patches are checked together with what's stored.
    const team = await newEvent(f.id, { name: 'Team One', participation: 'TEAM', teamMin: 2, teamMax: 4 });
    const r = await api.patch(`/admin/local-events/${team.id}`, { teamMin: 5, version: team.version });
    expect(r.status).toBe(400);
    expect(r.body.details.fields.teamMax).toMatch(/at least the minimum/);
  });

  it('posters are https URLs or files shipped under /media/, nothing else', async () => {
    const f = await newFest();
    const poster = async (bannerUrl: string) => (await api.post(`/admin/global-events/${f.id}/events`, { name: `P ${Math.random()}`, category: 'TECHNICAL', departmentId: dept.CSE, bannerUrl })).status;
    expect(await poster('/media/tf25/blind-coding.webp')).toBe(201);
    expect(await poster('https://res.cloudinary.com/demo/image/upload/sample.jpg')).toBe(201);
    for (const bad of ['/etc/passwd', '/media/../.env', '/media/x.svg', 'javascript:alert(1)', 'http://example.com/a.png', '//evil.com/a.png', 'data:image/png;base64,AAAA']) {
      expect(await poster(bad), bad).toBe(400);
    }
  });

  it('stores descriptions as plain text (the UI renders text, never HTML)', async () => {
    const f = await newFest();
    const e = await newEvent(f.id, { name: 'Text Only', description: '<script>alert(1)</script> Bring a laptop.' });
    expect(e.description).toBe('<script>alert(1)</script> Bring a laptop.');
    expect(e).not.toHaveProperty('descriptionHtml');
  });

  it('gives readable addresses that are unique per fest', async () => {
    const f = await newFest();
    const a = await newEvent(f.id, { name: 'Paper Presentation' });
    const b = await newEvent(f.id, { name: 'Paper Presentation', departmentId: dept.IT });
    const c = await newEvent((await newFest()).id, { name: 'Paper Presentation' });
    expect([a.slug, b.slug, c.slug]).toEqual(['paper-presentation', 'paper-presentation-it', 'paper-presentation']);
    expect((await api.post(`/admin/global-events/${f.id}/events`, { name: 'Again', category: 'TECHNICAL', slug: 'paper-presentation' })).body.code).toBe('SLUG_TAKEN');
  });

  it('a partial save changes only what it sends (no defaults filled in)', async () => {
    const e = await newEvent((await newFest()).id, {
      participation: 'TEAM',
      teamMin: 2,
      teamMax: 3,
      tags: ['Coding'],
      rules: ['Bring a laptop'],
      online: true,
      seatsTotal: 60,
      pricing: { type: 'PAID', amountPaise: 10000, per: 'TEAM', modes: ['OFFLINE'] },
      coordinators: [{ name: 'Suguna P', role: 'FACULTY' }],
    });
    const r = await api.patch(`/admin/local-events/${e.id}`, { tagline: 'Now with a tagline', version: 0 });
    expect(r.body).toMatchObject({
      tagline: 'Now with a tagline',
      participation: 'TEAM',
      teamMin: 2,
      teamMax: 3,
      tags: ['Coding'],
      rules: ['Bring a laptop'],
      online: true,
      seatsTotal: 60,
      pricing: { type: 'PAID', amountPaise: 10000, modes: ['OFFLINE'] },
      description: e.description,
      priceVersion: 0,
    });
    expect(r.body.coordinators).toHaveLength(1);
  });

  it('rejects a save based on an old version', async () => {
    const e = await newEvent((await newFest()).id);
    expect((await api.patch(`/admin/local-events/${e.id}`, { tagline: 'One', version: 0 })).status).toBe(200);
    expect((await api.patch(`/admin/local-events/${e.id}`, { tagline: 'Two', version: 0 })).body.code).toBe('STALE_VERSION');
  });

  it("capacity can't drop below seats taken; price changes bump the price version", async () => {
    const e = await newEvent((await newFest()).id, { seatsTotal: 50 });
    await t.conn.collection('local_events').updateOne({ _id: new Types.ObjectId(e.id) }, { $set: { seats_confirmed: 8, seats_held: 2 } });
    const low = await api.patch(`/admin/local-events/${e.id}`, { seatsTotal: 9, version: 0 });
    expect(low.status).toBe(409);
    expect(low.body).toMatchObject({ code: 'CAPACITY_BELOW_BOOKED', details: { taken: 10 } });
    const ok = await api.patch(`/admin/local-events/${e.id}`, { seatsTotal: 10, version: 0 });
    expect(ok.body).toMatchObject({ seatsTotal: 10, seatsLeft: 0, version: 1 });

    const paid = await api.patch(`/admin/local-events/${e.id}`, { pricing: { type: 'PAID', amountPaise: 15000, per: 'TEAM', modes: ['ONLINE'] }, version: 1 });
    expect(paid.body).toMatchObject({ priceVersion: 1, pricing: { type: 'PAID', amountPaise: 15000 } });
    const same = await api.patch(`/admin/local-events/${e.id}`, { pricing: { type: 'PAID', amountPaise: 15000, per: 'TEAM', modes: ['ONLINE', 'OFFLINE'] }, version: 2 });
    expect(same.body.priceVersion).toBe(1); // accepting desk payments too isn't a price change
    expect(same.body.pricing.modes).toEqual(['ONLINE', 'OFFLINE']);
  });
});

describe('lifecycle', () => {
  it('lists what is missing before publishing', async () => {
    const f = await newFest();
    const r = await api.post(`/admin/global-events/${f.id}/events`, { name: 'Bare Draft', category: 'TECHNICAL', departmentId: dept.CSE });
    const p = await api.post(`/admin/local-events/${r.body.id}/publish`);
    expect(p.status).toBe(422);
    expect(p.body.details.missing).toEqual(['startsAt', 'venue', 'description']);
    // An online event needs no venue.
    const online = await newEvent(f.id, { name: 'Online Quiz', venue: null, online: true });
    expect((await api.post(`/admin/local-events/${online.id}/publish`)).status).toBe(201);
  });

  it('runs the state machine; each transition happens once', async () => {
    const f = await newFest();
    const e = await newEvent(f.id);
    const go = (action: string, body: object = {}) => api.post(`/admin/local-events/${e.id}/${action}`, body);
    const [a, b] = await Promise.all([go('publish'), go('publish')]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await go('suspend')).body.code).toBe('VALIDATION_ERROR');
    expect((await go('suspend', { reason: 'Lab maintenance' })).body).toMatchObject({ status: 'SUSPENDED', statusReason: 'Lab maintenance' });
    expect((await go('reactivate')).body).toMatchObject({ status: 'PUBLISHED', statusReason: null });
    expect((await go('complete')).body.code).toBe('EVENT_NOT_OVER');
    expect((await go('cancel', { reason: 'Speaker unavailable' })).body).toMatchObject({ status: 'CANCELLED', statusReason: 'Speaker unavailable' });
    expect((await api.patch(`/admin/local-events/${e.id}`, { tagline: 'x', version: 4 })).body.code).toBe('EVENT_CLOSED');
  });

  it('only never-published drafts can be deleted', async () => {
    const f = await newFest();
    const draft = await newEvent(f.id, { name: 'Throwaway' });
    expect((await api.del(`/admin/local-events/${draft.id}`)).status).toBe(204);
    const live = await newEvent(f.id, { name: 'Went Live' });
    await api.post(`/admin/local-events/${live.id}/publish`);
    expect((await api.del(`/admin/local-events/${live.id}`)).body.code).toBe('NOT_A_DRAFT');
  });

  it('duplicates an event as a draft in the same fest', async () => {
    const e = await newEvent((await newFest()).id, { name: 'Tech Quiz', seatsTotal: 40 });
    await api.post(`/admin/local-events/${e.id}/publish`);
    const copy = (await api.post(`/admin/local-events/${e.id}/clone`)).body;
    expect(copy).toMatchObject({ name: 'Tech Quiz (copy)', slug: 'tech-quiz-copy', status: 'DRAFT', seatsTotal: 40, seatsLeft: 40, publishedAt: null });
  });

  it('events of a completed fest are frozen', async () => {
    const fest = (await client(t.app).get(`/global-events/${LIVE_FEST}`)).body;
    const r = await api.post(`/admin/global-events/${fest.id}/events`, { name: 'Late Entry', category: 'TECHNICAL' });
    expect(r.body.code).toBe('FEST_CLOSED');
  });
});

describe('fest ↔ events', () => {
  it('cloning a fest brings its events along as drafts, a year later', async () => {
    const f = await newFest({ name: 'Ideathon 2027', editionYear: 2027 });
    const kept = await newEvent(f.id, { name: 'Pitch Round', registrationClosesAt: '2027-03-10T18:00:00+05:30' });
    await api.post(`/admin/local-events/${kept.id}/publish`);
    const dropped = await newEvent(f.id, { name: 'Called Off' });
    await api.post(`/admin/local-events/${dropped.id}/cancel`, { reason: 'No sponsor' });

    const next = (await api.post(`/admin/global-events/${f.id}/clone`, { editionYear: 2028 })).body;
    const list = (await api.get(`/admin/global-events/${next.id}/events`)).body;
    expect(list.counts).toEqual({ DRAFT: 1 });
    expect(list.items[0]).toMatchObject({ slug: 'pitch-round', status: 'DRAFT' });
    expect(list.items[0].startsAt.slice(0, 10)).toBe('2028-03-14');
    expect(list.items[0].registrationClosesAt.slice(0, 10)).toBe('2028-03-10');
  });

  it("a department can't leave a fest while it still has events there", async () => {
    const f = await newFest();
    await newEvent(f.id, { departmentId: dept.IT, name: 'IT Event' });
    const r = await api.patch(`/admin/global-events/${f.id}`, { departmentIds: [dept.CSE], version: 0 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'DEPARTMENT_HAS_EVENTS', details: { department: 'IT' } });
  });

  it('renaming a department updates the events that show it', async () => {
    const d = (await api.post('/admin/departments', { code: 'BIO', name: 'Biotech' })).body;
    const f = await newFest({ departmentIds: [d.id] });
    const e = await newEvent(f.id, { departmentId: d.id, name: 'Gene Quiz' });
    await api.patch(`/admin/departments/${d.id}`, { code: 'BT', name: 'Biotechnology' });
    expect((await api.get(`/admin/local-events/${e.id}`)).body.department).toEqual({ id: d.id, code: 'BT', name: 'Biotechnology' });
  });
});

describe('scope', () => {
  it("department admins manage only their own department's events", async () => {
    const f = await newFest();
    const itEvent = await newEvent(f.id, { departmentId: dept.IT, name: 'IT Only' });
    const cse = await makeUser(t, [['ADMIN', 'DEPARTMENT', dept.CSE, 'CSE']]);
    const me = as(cse);

    const mine = await newEvent(f.id, { name: 'CSE Own' }, me);
    expect((await me.post(`/admin/global-events/${f.id}/events`, { name: 'Sneaky', category: 'TECHNICAL', departmentId: dept.IT })).status).toBe(403);
    expect((await me.post(`/admin/global-events/${f.id}/events`, { name: 'Fest Wide', category: 'TECHNICAL', departmentId: null })).status).toBe(403);

    expect((await me.get(`/admin/global-events/${f.id}/events`)).body.items.map((e: any) => e.id)).toEqual([mine.id]);
    expect((await me.get(`/admin/local-events/${itEvent.id}`)).status).toBe(404);
    expect((await me.patch(`/admin/local-events/${itEvent.id}`, { tagline: 'x', version: 0 })).status).toBe(404);
    expect((await me.patch(`/admin/local-events/${mine.id}`, { departmentId: dept.IT, version: 0 })).status).toBe(403);
    expect((await me.post(`/admin/local-events/${mine.id}/publish`)).body.status).toBe('PUBLISHED');
  });

  it('fest admins run every event in their fest; finance has no event access', async () => {
    const f = await newFest();
    const festAdmin = as(await makeUser(t, [['ADMIN', 'GLOBAL_EVENT', f.id, 'Fest']]));
    const wide = await newEvent(f.id, { name: 'Ideathon', departmentId: null }, festAdmin);
    expect(wide.department).toBeNull();
    await newEvent(f.id, { name: 'IT Thing', departmentId: dept.IT });
    expect((await festAdmin.get(`/admin/global-events/${f.id}/events`)).body.items).toHaveLength(2);

    const finance = as(await makeUser(t, [['FINANCE', 'ORG']]));
    expect((await finance.get(`/admin/global-events/${f.id}/events`)).status).toBe(403);
  });
});

describe('event query plans', () => {
  it('serve every list shape from an index', async () => {
    const m = t.conn.model('LocalEvent');
    const gid = new Types.ObjectId();
    const listed = { $in: ['PUBLISHED', 'SUSPENDED', 'COMPLETED'] };
    const order = { starts_at: 1, _id: 1 } as const;
    await expectIndexed(m.find({ global_event_id: gid, status: listed }).sort(order), 'global_event_id_1_status_1_starts_at_1__id_1');
    await expectIndexed(m.find({ global_event_id: gid, status: listed, department_id: gid }).sort(order), 'global_event_id_1_department_id_1_status_1_starts_at_1__id_1');
    await expectIndexed(m.find({ global_event_id: gid, status: listed, category: 'WORKSHOP' }).sort(order), 'global_event_id_1_status_1_category_1_starts_at_1__id_1');
    await expectIndexed(
      m.find({ global_event_id: gid, status: listed, $or: [{ starts_at: { $gt: new Date() } }, { starts_at: new Date(), _id: { $gt: gid } }] }).sort(order),
    );
    await expectIndexed(m.find({ global_event_id: gid, status: listed, $text: { $search: 'coding' } }), 'event_search');
    await expectIndexed(m.findOne({ global_event_id: gid, slug: 'blind-coding' }), 'global_event_id_1_slug_1');
    await expectIndexed(m.find({ global_event_id: { $in: [gid] }, department_id: gid })); // department rename
    await expectIndexed(m.findOne({ global_event_id: gid, department_id: { $nin: [gid, null] }, status: { $ne: 'CANCELLED' } })); // leave-fest guard
  });
});

describe('live edition (npm run seed:live)', () => {
  it('publishes next March with the same events, open registration and a free / online / desk mix', async () => {
    const { buildLiveEdition } = await import('../src/local-events/live-edition');
    const live = buildLiveEdition(SEED, 2027);
    const r = await t.app.get(EventSeedService).importFile(live);
    expect(r).toMatchObject({ festSlug: 'nec-tech-fest-27', festCreated: true, inserted: 123 });

    const fest = (await client(t.app).get('/global-events/nec-tech-fest-27')).body;
    expect(fest).toMatchObject({ name: "NEC Tech Fest '27", status: 'PUBLISHED', editionYear: 2027 });
    expect(fest.startsAt.slice(0, 10)).toBe('2027-03-12');

    const first = (await client(t.app).get('/global-events/nec-tech-fest-27/events?limit=50')).body;
    expect(first.facets).toMatchObject({ total: 122, paid: 88 }); // one workshop has no venue yet → stays a draft
    expect(first.items.every((e: any) => e.status === 'PUBLISHED' && new Date(e.registrationClosesAt) < new Date(e.startsAt))).toBe(true);
    expect((await client(t.app).get('/global-events/nec-tech-fest-27/events?free=1&limit=50')).body.items).toHaveLength(34);

    const blind = (await client(t.app).get('/global-events/nec-tech-fest-27/events/blind-coding')).body;
    expect(blind).toMatchObject({ startsAt: '2027-03-12T08:00:00.000Z', pricing: { type: 'PAID', amountPaise: 10000, per: 'TEAM', modes: ['OFFLINE'] } });
    const workshop = (await client(t.app).get('/global-events/nec-tech-fest-27/events/machine-learning-made-easy')).body;
    expect(workshop).toMatchObject({ seatsTotal: 30, seatsLeft: 30, pricing: { amountPaise: 30000, per: 'MEMBER', modes: ['ONLINE'] } });
    expect((await client(t.app).get('/global-events/nec-tech-fest-27/events/ideathon')).body.pricing.modes).toEqual(['ONLINE', 'OFFLINE']);
  });
});
