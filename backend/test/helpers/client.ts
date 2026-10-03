import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
  setCookies: { name: string; value: string; path?: string; httpOnly?: boolean; sameSite?: string }[];
}

/**
 * Tiny HTTP client over Fastify inject (no network). Keeps a cookie jar like a browser tab,
 * so refresh-cookie flows behave exactly as in production.
 */
export function client(app: NestFastifyApplication, opts: { ip?: string } = {}) {
  const jar: Record<string, string> = {};

  async function req<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    o: { body?: unknown; token?: string; cookies?: Record<string, string>; ip?: string } = {},
  ): Promise<Res<T>> {
    const cookies = o.cookies ?? jar;
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      payload: o.body as any,
      remoteAddress: o.ip ?? opts.ip ?? '10.0.0.1',
      headers: {
        ...(o.token && { authorization: `Bearer ${o.token}` }),
        ...(cookieHeader && { cookie: cookieHeader }),
      },
    });
    const setCookies = res.cookies as Res['setCookies'];
    if (!o.cookies) {
      for (const c of setCookies) {
        if (c.value) jar[c.name] = c.value;
        else delete jar[c.name];
      }
    }
    return {
      status: res.statusCode,
      body: (res.body ? res.json() : null) as T,
      headers: res.headers as Record<string, unknown>,
      setCookies,
    };
  }

  return {
    jar,
    get: <T = any>(url: string, o?: Parameters<typeof req>[2]) => req<T>('GET', url, o),
    post: <T = any>(url: string, body?: unknown, o?: Parameters<typeof req>[2]) => req<T>('POST', url, { ...o, body: body ?? {} }),
    patch: <T = any>(url: string, body?: unknown, o?: Parameters<typeof req>[2]) => req<T>('PATCH', url, { ...o, body }),
    del: <T = any>(url: string, o?: Parameters<typeof req>[2]) => req<T>('DELETE', url, o),
  };
}

export type Client = ReturnType<typeof client>;

let seq = 0;
/** Unique, valid email per call so tests never collide (and never share rate-limit buckets). */
export const uniqueEmail = (tag = 'user') => `${tag}-${Date.now().toString(36)}-${++seq}@test.local`;

/** Full signup → OTP → session. Returns the access token. */
export async function signupVerified(
  c: Client,
  lastOtp: (email: string) => Promise<string>,
  over: Partial<{ email: string; password: string; fullName: string }> = {},
) {
  const email = over.email ?? uniqueEmail();
  const password = over.password ?? 'Passw0rd123';
  const s = await c.post('/auth/signup', {
    fullName: over.fullName ?? 'Test User',
    email,
    phone: '9876543210',
    college: 'NEC',
    password,
  });
  if (s.status !== 201) throw new Error(`signup failed: ${JSON.stringify(s.body)}`);
  const v = await c.post('/auth/verify-otp', { otpToken: s.body.otpToken, code: await lastOtp(email) });
  if (v.status !== 200) throw new Error(`verify failed: ${JSON.stringify(v.body)}`);
  return { email, password, token: v.body.accessToken as string, user: v.body.user };
}
