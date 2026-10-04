import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MediaService } from '../src/media/media.service';
import { createTestApp, type TestApp } from './helpers/app';
import { client } from './helpers/client';
import { makeUser, superAdmin } from './helpers/staff';

let t: TestApp;
let root: Awaited<ReturnType<typeof superAdmin>>;
let cse: string;

beforeAll(async () => {
  t = await createTestApp();
  root = await superAdmin(t);
  cse = (await client(t.app).get('/departments')).body.find((d: any) => d.code === 'CSE').id;
});
afterAll(async () => {
  await t?.close();
});

const poster = (w = 1587, h = 2245, color = '#4f46e5') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

const upload = (body: Buffer, type = 'image/png', token = root.token) =>
  t.app.inject({ method: 'POST', url: '/api/v1/admin/media/posters', payload: body, headers: { 'content-type': type, authorization: `Bearer ${token}` } });

describe('poster upload', () => {
  it('stores a resized copy once and serves it cacheable forever', async () => {
    const img = await poster();
    const r = await upload(img);
    expect(r.statusCode).toBe(201);
    const { url } = r.json();
    expect(url).toMatch(/^\/api\/v1\/media\/p[a-f0-9]{24}\.webp$/);

    const full = await t.app.inject({ method: 'GET', url });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/webp');
    expect(full.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await sharp(full.rawPayload).metadata()).width).toBe(720);

    const card = await t.app.inject({ method: 'GET', url: url.replace('.webp', '-card.webp') });
    expect(await sharp(card.rawPayload).metadata()).toMatchObject({ width: 640, height: 400 });
    expect(card.rawPayload.length).toBeLessThan(30_000);

    // Same poster again → same URL, nothing new stored.
    expect((await upload(img)).json().url).toBe(url);
    expect(await t.conn.collection('media_assets').countDocuments()).toBe(2);
  });

  it('rejects non-images, oversized bodies and unsupported types', async () => {
    const fake = await upload(Buffer.from('definitely not a png'));
    expect(fake.statusCode).toBe(400);
    expect(fake.json().code).toBe('NOT_AN_IMAGE');
    const big = await upload(Buffer.alloc(10 * 1024 * 1024 + 1));
    expect([big.statusCode, big.json().code]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    const pdf = await upload(Buffer.from('%PDF-1.7'), 'application/pdf');
    expect(pdf.statusCode).toBe(415);
  });

  it('only staff who manage events can upload; anyone can view', async () => {
    const p = await makeUser(t, []);
    expect((await upload(await poster(400, 600, '#123456'), 'image/png', p.token)).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/admin/media/posters', payload: Buffer.from('x'), headers: { 'content-type': 'image/png' } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/media/../../etc/passwd' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/media/p000000000000000000000000.webp' })).statusCode).toBe(404);
  });
});

describe('posters from links', () => {
  async function newFest() {
    const r = await root.c.post('/admin/global-events', { name: `Fest ${Math.random().toString(36).slice(2, 7)}`, editionYear: 2027, departmentIds: [cse] }, { token: root.token });
    return r.body;
  }

  it('a link to another site is downloaded once and replaced by our resized copy', async () => {
    const media = t.app.get(MediaService);
    const fetchRemote = vi.spyOn(media, 'fetchRemote').mockResolvedValue(await poster(4419, 6250, '#7c3aed')); // the 27.6 MP poster
    const f = await newFest();
    const r = await root.c.post(
      `/admin/global-events/${f.id}/events`,
      { name: 'Paper Presentation (Mech)', category: 'TECHNICAL', departmentId: cse, bannerUrl: 'https://techfestnec.vercel.app/events/mech/PAPER%20PRESENTATION_MECH.webp' },
      { token: root.token },
    );
    expect(r.status).toBe(201);
    expect(r.body.bannerUrl).toMatch(/^\/api\/v1\/media\/p[a-f0-9]{24}\.webp$/);
    expect(fetchRemote).toHaveBeenCalledOnce();

    // Saving other fields doesn't fetch again.
    await root.c.patch(`/admin/local-events/${r.body.id}`, { tagline: 'x', version: 0 }, { token: root.token });
    expect(fetchRemote).toHaveBeenCalledOnce();
    fetchRemote.mockRestore();
  });

  it('pasting a link compresses it right away (the form gets our URL back)', async () => {
    const media = t.app.get(MediaService);
    const spy = vi.spyOn(media, 'fetchRemote').mockResolvedValue(await poster(2000, 3000, '#0ea5e9'));
    const r = await root.c.post('/admin/media/posters/import', { url: 'https://example.org/poster.jpg' }, { token: root.token });
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/^\/api\/v1\/media\/p[a-f0-9]{24}\.webp$/);
    spy.mockRestore();
    const bad = await root.c.post('/admin/media/posters/import', { url: 'https://10.0.0.5/x.png' }, { token: root.token });
    expect([bad.status, bad.body.details.fields.url]).toEqual([400, 'That address is not allowed']);
    expect((await root.c.post('/admin/media/posters/import', { url: 'http://example.org/x.png' }, { token: root.token })).status).toBe(400);
  });

  it('a link to the private network is refused as a field error (no request is made)', async () => {
    const f = await newFest();
    for (const bannerUrl of ['https://127.0.0.1/x.png', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x.png']) {
      const r = await root.c.post(`/admin/global-events/${f.id}/events`, { name: 'SSRF Try', category: 'TECHNICAL', departmentId: cse, bannerUrl }, { token: root.token });
      expect(r.status, bannerUrl).toBe(400);
      expect(r.body.details.fields.bannerUrl).toMatch(/not allowed/);
    }
  });
});
