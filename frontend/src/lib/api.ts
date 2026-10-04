import { useAuth, type SessionPayload } from '@/store/auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: {
      fields?: Record<string, string>;
      retryAfterSec?: number;
      attemptsLeft?: number;
      /** Registration conflicts: who, whether it's the signed-in person, their registration and the other event. */
      email?: string;
      self?: boolean;
      code?: string;
      event?: { name: string | null; startsAt: string; endsAt: string };
      [k: string]: unknown;
    },
  ) {
    super(message);
  }
}

// Access token lives in memory only (never localStorage) — XSS can't lift a persisted token.
let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<boolean> | null = null;

export function applySession(s: SessionPayload) {
  accessToken = s.accessToken;
  useAuth.getState().setUser(s.user);
  // Refresh a minute before expiry so normal requests never hit a 401 round trip.
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshSession(), Math.max(10, s.expiresIn - 60) * 1000);
}

export function clearSession() {
  accessToken = null;
  clearTimeout(refreshTimer);
  useAuth.getState().setUser(null);
}

type Extra = { headers?: Record<string, string> };

async function raw<T>(method: string, path: string, body?: unknown, extra?: Extra): Promise<T> {
  const headers: Record<string, string> = { ...extra?.headers };
  // Files (poster uploads) go as the raw body with their own type; everything else is JSON.
  const file = typeof Blob !== 'undefined' && body instanceof Blob ? body : null;
  if (body !== undefined) headers['Content-Type'] = file ? file.type || 'application/octet-stream' : 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : file ?? JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? 'HTTP_ERROR', data?.message ?? 'Something went wrong', data?.details);
  }
  return data as T;
}

/**
 * Single-flight refresh. Web Locks serialise it across tabs too, so two tabs never present the
 * same refresh token at once (the server also tolerates a short race window).
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    const run = async () => {
      try {
        applySession(await raw<SessionPayload>('POST', '/auth/refresh'));
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) clearSession();
        return false;
      }
    };
    try {
      return navigator.locks ? await navigator.locks.request('ems-refresh', run) : await run();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Authenticated request with one transparent retry after refreshing an expired access token. */
async function request<T>(method: string, path: string, body?: unknown, extra?: Extra): Promise<T> {
  try {
    return await raw<T>(method, path, body, extra);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && accessToken && (await refreshSession())) {
      return raw<T>(method, path, body, extra);
    }
    throw e;
  }
}

/** A file the server streams (CSV export): fetched with the session token, saved by the browser. */
async function download(path: string): Promise<void> {
  const get = () => fetch(`/api/v1${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await get().catch(() => null);
  if (res?.status === 401 && accessToken && (await refreshSession())) res = await get().catch(() => null);
  if (!res) throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.code ?? 'HTTP_ERROR', data?.message ?? 'Download failed');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export.csv';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, extra?: Extra) => request<T>('POST', path, body ?? {}, extra),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: Blob) => request<T>('POST', path, file),
  download,
};
