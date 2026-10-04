import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'wouter';
import { EmptyState, Skeleton } from '@/components/data';
import { EventTile } from '@/components/EventTile';
import { ClockIcon, XIcon } from '@/components/event-icons';
import { SearchIcon, TicketIcon } from '@/components/icons';
import { cx } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { CATEGORY_LABEL, publicApi, type EventCard, type EventCategory, type EventFacets, type EventQuery, type FestDetail } from '@/lib/ems-api';
import { fmtDay, fmtTime } from '@/lib/format';
import { useMyRegistrations } from '@/lib/my-registrations';
import { daysBetween, groupSchedule, istDay, markFor, type MySchedule } from '@/lib/schedule';
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

/** Day switcher: one tab per fest day ("Day 1 · Fri, 12 Mar"), with event counts once known. */
function DayTabs({ tabs, value, onChange, searching }: { tabs: { day: string; n?: number }[]; value: string; onChange: (d: string) => void; searching: boolean }) {
  return (
    <div role="tablist" aria-label="Fest day" className="flex gap-1 rounded-xl bg-surface-2 p-1">
      {tabs.map((t, i) => {
        const on = !searching && t.day === value;
        return (
          <button
            key={t.day}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.day)}
            className={cx(
              'flex h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-2 leading-tight sm:flex-none sm:px-4',
              on ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg',
            )}
          >
            <span className={cx('text-[11px] font-semibold uppercase tracking-wide', on ? 'text-indigo-600 dark:text-indigo-300' : 'text-subtle')}>
              Day {i + 1}
              {t.n !== undefined && <span className="font-medium normal-case tracking-normal"> · {t.n}</span>}
            </span>
            <span className="truncate text-sm font-bold">{fmtDay(t.day)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Start-time heading inside a day; says so when I'm already busy then. */
function SlotHeading({ at, count, mine }: { at: string; count: number; mine: MySchedule }) {
  const t = Date.parse(at);
  const busy = mine.active.find((r) => Date.parse(r.startsAt) <= t && t < Date.parse(r.endsAt));
  return (
    <h3 className="mb-3 flex items-center gap-2.5">
      <span className="inline-flex items-center gap-1.5 text-[15px] font-bold text-fg">
        <ClockIcon className="size-4 text-indigo-500 dark:text-indigo-400" />
        {fmtTime(at)}
      </span>
      {busy && (
        <span className="min-w-0 truncate rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          You're at {busy.event?.name ?? 'another event'}
        </span>
      )}
      <span aria-hidden className="h-px min-w-4 flex-1 bg-line" />
      <span className="shrink-0 text-xs font-medium text-muted">
        {count} {count === 1 ? 'event' : 'events'}
      </span>
    </h3>
  );
}

/**
 * Fest catalogue as a schedule: pick a day, then events by start time, so it's easy to plan one
 * event per slot. Cards say when I'm registered or when an event clashes with one I'm in.
 * Filters are URL-backed (shareable); search covers every day; pages load as you scroll.
 */
export function EventCatalog({ fest }: { fest: FestDetail }) {
  const [params, setParams] = useSearchParams();
  const dept = params.get('dept') ?? '';
  const category = (params.get('cat') ?? '') as EventCategory | '';
  const free = params.get('free') === '1';
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim(), 300);
  const searching = q.length >= 2;

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

  // Day tabs: the fest's own dates right away (so the first request is already for one day), then
  // the days that actually have events, with counts, once the first page arrives.
  // (The feed hook needs the day, so the tabs read the facets the previous render received.)
  const festDays = useMemo(() => (fest.startsAt ? daysBetween(fest.startsAt, fest.endsAt) : []), [fest.startsAt, fest.endsAt]);
  const [facetState, setFacetState] = useState(() => facetCache.get(fest.slug));
  const tabs = useMemo(() => (facetState?.days?.length ? facetState.days.map((d) => ({ day: d.day, n: d.n })) : festDays.map((day) => ({ day }))), [facetState, festDays]);
  const today = istDay(Date.now());
  const defaultDay = tabs.find((t) => t.day === today)?.day ?? festDays.find((d) => tabs.some((t) => t.day === d)) ?? tabs[0]?.day ?? '';
  const requested = params.get('day') ?? '';
  const day = searching ? '' : tabs.some((t) => t.day === requested) ? requested : defaultDay;

  const query: EventQuery = { dept: dept || undefined, category: category || undefined, free: free || undefined, q: searching ? q : undefined, day: day || undefined };
  const feed = useEventFeed(fest.slug, query);
  const { items, loading, error, more, retry, cursor } = feed;
  useEffect(() => {
    if (feed.facets && feed.facets !== facetState) setFacetState(feed.facets);
  }, [feed.facets, facetState]);
  const counts = feed.facets;

  const { schedule } = useMyRegistrations();
  const grouped = useMemo(() => groupSchedule(items), [items]);

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

  const filtered = !!(dept || category || free || searching);
  const clear = () => {
    setText('');
    setParams(day ? new URLSearchParams({ day }) : new URLSearchParams(), { replace: true });
  };
  const showFree = !!counts && counts.paid > 0 && counts.paid < counts.total;
  const href = (e: EventCard) => `/events/${fest.slug}/${e.slug}`;

  return (
    <section aria-labelledby="events-heading" className="mt-8">
      <div>
        <h2 id="events-heading" className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
          Schedule
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          {counts ? `${counts.total} events across ${Object.keys(counts.departments).length} departments · one event per time slot` : 'Competitions, workshops and more'}
        </p>
      </div>

      <div className="mt-4 space-y-3">
        <label className="relative block">
          <span className="sr-only">Search events</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search all days, e.g. coding, robotics, quiz"
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
            All <Count n={counts?.total} on={!category} />
          </Chip>
          {CATEGORIES.filter((c) => !counts || counts.categories[c]).map((c) => (
            <Chip key={c} on={category === c} onClick={() => setParam('cat', category === c ? '' : c)}>
              {CATEGORY_LABEL[c]} <Count n={counts?.categories[c]} on={category === c} />
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
              const n = counts?.departments[d.code];
              return (
                <Chip key={d.id} on={dept === d.code} onClick={() => setParam('dept', dept === d.code ? '' : d.code)} disabled={counts && !n}>
                  <span title={d.name}>{d.code}</span> <Count n={n} on={dept === d.code} />
                </Chip>
              );
            })}
          </div>
        )}
      </div>

      {/* The day switcher stays under the header while scrolling a day. Solid background, no blur (cheap on low-end phones). */}
      {tabs.length > 1 && (
        <div className="sticky top-16 z-10 -mx-4 mt-4 border-b border-line bg-page px-4 py-2 sm:-mx-5 sm:px-5">
          <DayTabs tabs={tabs} value={day} searching={searching} onChange={(d) => { setText(''); setParam('day', d); }} />
        </div>
      )}

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
              description={filtered ? (day ? 'Try another day, department, category or search.' : 'Try another department, category or search.') : 'Competitions, workshops and registrations for this fest will appear here.'}
              action={filtered && <button type="button" onClick={clear} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Clear filters</button>}
            />
          </div>
        ) : (
          <>
            {query.q && !loading && <p className="mb-4 text-sm text-muted">{items.length === 20 ? 'Top 20 matches' : `${items.length} ${items.length === 1 ? 'match' : 'matches'}`} for “{query.q}” across all days</p>}
            <div className="space-y-8">
              {grouped.map((g) => (
                <div key={g.day} className="space-y-7">
                  {/* With one day selected the tab already names it; a search can span days. */}
                  {(searching || !day) && <h3 className="text-lg font-bold text-fg">{fmtDay(g.day)}</h3>}
                  {g.slots.map((s) => (
                    <section key={s.at} aria-label={`${fmtDay(g.day)}, ${fmtTime(s.at)}`}>
                      <SlotHeading at={s.at} count={s.items.length} mine={schedule} />
                      {/* grid-cols-1 = minmax(0, 1fr): without it the column grows to fit a long venue instead of truncating it. */}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                        {s.items.map((e) => (
                          <EventTile key={e.id} e={e} href={href(e)} mark={markFor(e, schedule)} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ))}
            </div>
            {loading && (
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                {Array.from({ length: items.length ? 3 : 6 }, (_, i) => (
                  <Skeleton key={`s${i}`} className="h-44 rounded-2xl" />
                ))}
              </div>
            )}
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
