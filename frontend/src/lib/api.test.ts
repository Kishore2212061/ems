import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/store/auth';
import { ApiError, api, applySession, clearSession, refreshSession } from './api';

const user = {
  id: 'u1',
  email: 'a@b.c',
  fullName: 'A B',
  phone: null,
  college: null,
  status: 'ACTIVE' as const,
  emailVerified: true,
  roles: [{ role: 'PARTICIPANT' as const, scopeType: 'ORG' as const, scopeId: null, scopeLabel: null }],
  createdAt: '2026-01-01',
};

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearSession();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('api client', () => {
  it('sends the in-memory access token as a Bearer header', async () => {
    applySession({ accessToken: 'tok-1', expiresIn: 900, user });
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await api.get('/auth/me');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/auth/me');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(localStorage.length + sessionStorage.length).toBe(0); // token never persisted
  });

  it('uploads a file as the raw body with its own type (not JSON)', async () => {
    applySession({ accessToken: 'tok-1', expiresIn: 900, user });
    fetchMock.mockResolvedValue(json(201, { url: '/api/v1/media/p1.webp' }));
    const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    expect(await api.upload('/admin/media/posters', file)).toEqual({ url: '/api/v1/media/p1.webp' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('image/png');
    expect(init.body).toBe(file);
  });

  it('maps error bodies to ApiError with code and details', async () => {
    fetchMock.mockResolvedValue(json(400, { code: 'VALIDATION_ERROR', message: 'bad', details: { fields: { email: 'x' } } }));
    const err = await api.post('/auth/login', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: { fields: { email: 'x' } } });
  });

  it('reports network failures as a friendly NETWORK error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('on 401 refreshes once and retries — even when many requests expire together', async () => {
    applySession({ accessToken: 'old', expiresIn: 900, user });
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (url === '/api/v1/auth/refresh') {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 'new', expiresIn: 900, user });
      }
      return init.headers.Authorization === 'Bearer new' ? json(200, { ok: true }) : json(401, { code: 'TOKEN_EXPIRED' });
    });

    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1); // single-flight
  });

  it('a failed refresh signs the user out locally', async () => {
    applySession({ accessToken: 'old', expiresIn: 900, user });
    fetchMock.mockResolvedValue(json(401, { code: 'SESSION_REVOKED' }));
    expect(await refreshSession()).toBe(false);
    expect(useAuth.getState()).toMatchObject({ status: 'guest', user: null });
  });
});
