import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'wouter';
import { EmptyState, Skeleton } from '@/components/data';
import { EventTile } from '@/components/EventTile';
import { XIcon } from '@/components/event-icons';
import { SearchIcon, TicketIcon } from '@/components/icons';
import { cx } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { CATEGORY_LABEL, publicApi, type EventCard, type EventCategory, type EventFacets, type EventQuery, type FestDetail } from '@/lib/ems-api';
import { useDebounced } from '@/lib/use-debounced';

interface Feed {
  items: EventCard[];
  cursor: string | null;
  loading: boolean;
  error: string | null;
}

// Feeds survive navigation (open an event, come back → same list, no refetch, no skeleton).
const feeds = new Map<string, Feed>();
const facetCache = new Map<string, EventFacets>();
const EMPTY: Feed = { items: [], cursor: null, loading: true, error: null };

/** Keyset-paged event list for one fest + filter combination. */
function useEventFeed(fest: string, query: EventQuery) {
  const key = `${fest}?${JSON.stringify(query)}`;
  const [feed, setFeed] = useState<Feed>(() => feeds.get(key) ?? EMPTY);
  const [facets, setFacets] = useState(() => facetCache.get(fest));
  const latest = useRef(key);
  latest.current = key;

  const load = useCallback(
    async (cursor: string | null) => {
      const update = (f: Feed) => {
        feeds.set(key, f);
        if (latest.current === key) setFeed(f); // a newer filter may have taken over meanwhile
      };
      const prev = cursor ? (feeds.get(key) ?? EMPTY) : EMPTY;
      update({ ...prev, loading: true, error: null });
      try {
        const page = await publicApi.events(fest, { ...query, cursor: cursor ?? undefined });
        if (page.facets) {
          facetCache.set(fest, page.facets);
          setFacets(page.facets);
        }
        update({ items: [...prev.items, ...page.items], cursor: page.nextCursor, loading: false, error: null });
      } catch (e) {
        update({ ...prev, loading: false, error: e instanceof ApiError ? e.message : "Couldn't load events" });
      }
    },
    // `query` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    const cached = feeds.get(key);
    if (cached && !cached.error) setFeed(cached);
    else void load(null);
  }, [key, load]);

  return { ...feed, facets, more: () => feed.cursor && !feed.loading && load(feed.cursor), retry: () => load(feed.items.length ? feed.cursor : null) };
}

function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors disabled:opacity-40',
        on ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
      )}
    >
      {children}
    </button>
  );
}
const Count = ({ n, on }: { n?: number; on: boolean }) => (n === undefined ? null : <span className={cx('text-xs tabular-nums', on ? 'text-white/80' : 'text-subtle')}>{n}</span>);

const CATEGORIES = Object.keys(CATEGORY_LABEL) as EventCategory[];

/** Fest catalogue: sticky filters (URL-backed, shareable), debounced search, infinite scroll. */
export function EventCatalog({ fest }: { fest: FestDetail }) {
  const [params, setParams] = useSearchParams();
  const dept = params.get('dept') ?? '';
  const category = (params.get('cat') ?? '') as EventCategory | '';
  const free = params.get('free') === '1';
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim(), 300);

  const setParam = useCallback(
    (k: string, v: string) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (v) p.set(k, v);
          else p.delete(k);
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  useEffect(() => {
    if ((params.get('q') ?? '') !== q) setParam('q', q);
  }, [q, params, setParam]);

  const query: EventQuery = { dept: dept || undefined, category: category || undefined, free: free || undefined, q: q.length >= 2 ? q : undefined };
  const { items, loading, error, facets, more, retry, cursor } = useEventFeed(fest.slug, query);

  // Infinite scroll: load the next page when the sentinel comes within ~2 screens. Re-observed per
  // page, so a short page that doesn't fill the screen still triggers the next one.
  const sentinel = useRef<HTMLDivElement>(null);
  const moreRef = useRef(more);
  moreRef.current = more;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && moreRef.current(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor]);

  const filtered = !!(dept || category || free || query.q);
  const clear = () => {
    setText('');
    setParams(new URLSearchParams(), { replace: true });
  };
  const showFree = !!facets && facets.paid > 0 && facets.paid < facets.total;
  const href = (e: EventCard) => `/events/${fest.slug}/${e.slug}`;

  return (
    <section aria-labelledby="events-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="events-heading" className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
            Events
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {facets ? `${facets.total} events across ${Object.keys(facets.departments).length} departments` : 'Competitions, workshops and more'}
          </p>
        </div>
      </div>

      {/* Filters: sticky under the header; chip rows scroll sideways on phones. Solid background, no blur (cheap on low-end phones). */}
      <div className="sticky top-16 z-10 -mx-4 mt-4 space-y-3 border-b border-line bg-page px-4 py-3 sm:-mx-5 sm:px-5">
        <label className="relative block">
          <span className="sr-only">Search events</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search events, e.g. coding, robotics, quiz"
            maxLength={60}
            className="h-11 w-full rounded-xl border border-line bg-surface pl-11 pr-10 text-[15px] text-fg placeholder:text-subtle focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
          />
          {text && (
            <button type="button" onClick={() => setText('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-subtle hover:text-fg">
              <XIcon className="size-4" />
            </button>
          )}
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Category">
          <Chip on={!category} onClick={() => setParam('cat', '')}>
            All <Count n={facets?.total} on={!category} />
          </Chip>
          {CATEGORIES.filter((c) => !facets || facets.categories[c]).map((c) => (
            <Chip key={c} on={category === c} onClick={() => setParam('cat', category === c ? '' : c)}>
              {CATEGORY_LABEL[c]} <Count n={facets?.categories[c]} on={category === c} />
            </Chip>
          ))}
          {showFree && (
            <Chip on={free} onClick={() => setParam('free', free ? '' : '1')}>
              Free only
            </Chip>
          )}
        </div>
        {fest.departments.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Department">
            <Chip on={!dept} onClick={() => setParam('dept', '')}>
              All departments
            </Chip>
            {fest.departments.map((d) => {
              const n = facets?.departments[d.code];
              return (
                <Chip key={d.id} on={dept === d.code} onClick={() => setParam('dept', dept === d.code ? '' : d.code)} disabled={facets && !n}>
                  <span title={d.name}>{d.code}</span> <Count n={n} on={dept === d.code} />
                </Chip>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5">
        {error && !items.length ? (
          <div className="rounded-2xl border border-line bg-surface">
            <EmptyState icon={TicketIcon} title="Couldn't load events" description={error} action={<button type="button" onClick={retry} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Try again</button>} />
          </div>
        ) : !loading && !items.length ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface">
            <EmptyState
              icon={TicketIcon}
              title={filtered ? 'No events match' : 'Events open soon'}
              description={filtered ? 'Try another department, category or search.' : 'Competitions, workshops and registrations for this fest will appear here.'}
              action={filtered && <button type="button" onClick={clear} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Clear filters</button>}
            />
          </div>
        ) : (
          <>
            {query.q && !loading && <p className="mb-3 text-sm text-muted">{items.length === 20 ? 'Top 20 matches' : `${items.length} ${items.length === 1 ? 'match' : 'matches'}`} for “{query.q}”</p>}
            {/* grid-cols-1 = minmax(0, 1fr): without it the column grows to fit a long venue instead of truncating it. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {items.map((e) => (
                <EventTile key={e.id} e={e} href={href(e)} />
              ))}
              {loading && Array.from({ length: items.length ? 3 : 6 }, (_, i) => <Skeleton key={`s${i}`} className="h-44 rounded-2xl" />)}
            </div>
            {cursor && !loading && !error && (
              // Scrolling loads more automatically; the button is there for keyboards, screen readers
              // and any browser where the observer doesn't fire.
              <div className="mt-6 text-center">
                <button type="button" onClick={() => more()} className="inline-flex h-10 items-center rounded-xl border border-line bg-surface px-5 text-sm font-semibold text-fg-2 hover:border-line-strong hover:text-fg">
                  Show more events
                </button>
              </div>
            )}
            {error && items.length > 0 && (
              <p className="mt-4 text-center text-sm text-muted">
                {error}.{' '}
                <button type="button" onClick={retry} className="font-semibold text-indigo-600 dark:text-indigo-400">
                  Try again
                </button>
              </p>
            )}
          </>
        )}
        <div ref={sentinel} aria-hidden className="h-px" />
      </div>
    </section>
  );
}
