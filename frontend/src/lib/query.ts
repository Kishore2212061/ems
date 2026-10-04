import { useEffect, useReducer, useRef } from 'react';
import { ApiError } from './api';

/**
 * ~1 KB stand-in for TanStack Query: shared cache, request de-duplication,
 * stale-while-revalidate and prefix invalidation after mutations.
 */
interface Entry {
  data?: unknown;
  error?: ApiError;
  at: number;
  inflight?: Promise<unknown>;
}

const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();
const fetchers = new Map<string, () => Promise<unknown>>();

const notify = (key: string) => subs.get(key)?.forEach((f) => f());

function load(key: string, staleMs: number) {
  const e = cache.get(key) ?? { at: 0 };
  if (e.inflight || (e.data !== undefined && Date.now() - e.at < staleMs)) return;
  const fn = fetchers.get(key);
  if (!fn) return;
  e.inflight = fn()
    .then(
      (data) => Object.assign(e, { data, error: undefined, at: Date.now() }),
      (err) => Object.assign(e, { error: err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', String(err)), at: Date.now() }),
    )
    .finally(() => {
      e.inflight = undefined;
      notify(key);
    });
  cache.set(key, e);
}

export function useQuery<T>(key: string | null, fn: () => Promise<T>, { staleMs = 30_000 } = {}) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!key) return;
    fetchers.set(key, () => fnRef.current());
    const set = subs.get(key) ?? new Set();
    set.add(rerender);
    subs.set(key, set);
    load(key, staleMs);
    rerender();
    return () => {
      set.delete(rerender);
    };
  }, [key, staleMs]);

  const e = key ? cache.get(key) : undefined;
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: !!key && e?.data === undefined && !e?.error,
    refetch: () => key && (Object.assign(cache.get(key) ?? {}, { at: 0 }), load(key, 0)),
  };
}

/** Put a fresh value straight into the cache (e.g. the response of a save). */
export function setQueryData<T>(key: string, data: T) {
  cache.set(key, { data, at: Date.now() });
  notify(key);
}

/** Mark every key starting with `prefix` stale and refetch the ones on screen. */
export function invalidate(prefix: string) {
  for (const [key, e] of cache) {
    if (!key.startsWith(prefix)) continue;
    e.at = 0;
    if (subs.get(key)?.size) load(key, 0);
  }
}

/** Test helper / logout: forget everything. */
export function clearQueryCache() {
  cache.clear();
}
