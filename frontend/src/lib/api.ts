import { useAuth, type SessionPayload } from '@/store/auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { fields?: Record<string, string>; retryAfterSec?: number; attemptsLeft?: number },
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

async function raw<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await raw<T>(method, path, body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && accessToken && (await refreshSession())) {
      return raw<T>(method, path, body);
    }
    throw e;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
};
