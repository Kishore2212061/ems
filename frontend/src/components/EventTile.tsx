import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { CATEGORY_LABEL, EVENT_STATUS_LABEL, EVENT_STATUS_TONE, payLabel, priceLabel, teamLabel, type EventCard } from '@/lib/ems-api';
import { fmtTimeRange } from '@/lib/format';
import { cardImage } from '@/lib/media';
import type { Mark } from '@/lib/schedule';
import { CardIcon, CATEGORY_ICON, ClockIcon, GlobeIcon } from './event-icons';
import { AlertIcon, CheckIcon, MapPinIcon, UsersIcon } from './icons';
import { Badge } from './layout';
import { cx } from './ui';

/** Seats left as a bar: amber under 20 %, red under 5 %. */
export function SeatsBar({ left, total, className }: { left: number; total: number; className?: string }) {
  const pct = total ? left / total : 0;
  const tone = pct < 0.05 ? 'bg-red-500' : pct < 0.2 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div className={className}>
      <div className="flex items-center justify-between text-xs font-medium">
        <span className={cx(pct < 0.05 ? 'text-red-600 dark:text-red-400' : pct < 0.2 ? 'text-amber-600 dark:text-amber-400' : 'text-muted')}>
          {left === 0 ? 'Full' : `${left} of ${total} seats left`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={left} aria-label="Seats left">
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.max(pct * 100, left > 0 ? 3 : 0)}%` }} />
      </div>
    </div>
  );
}

const Fact = ({ icon: I, children }: { icon: typeof ClockIcon; children: ReactNode }) => (
  <div className="flex min-w-0 items-center gap-2">
    <I className="size-4 shrink-0 text-subtle" />
    <span className="truncate">{children}</span>
  </div>
);

/** Where I stand with this event: in it, paying for it, or busy elsewhere at that time. */
function MarkPill({ mark }: { mark: Mark }) {
  if (mark.kind === 'clash') {
    return (
      <span className="absolute left-3 top-3 inline-flex max-w-[calc(100%-6.5rem)] items-center gap-1 rounded-full bg-black/75 px-2.5 py-1 text-xs font-semibold text-white">
        <AlertIcon className="size-3.5 shrink-0 text-amber-300" />
        <span className="truncate">Clashes with {mark.reg.event?.name ?? 'your event'}</span>
      </span>
    );
  }
  return (
    <span
      className={cx(
        'absolute left-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold',
        mark.kind === 'registered' ? 'bg-emerald-600 text-white' : 'bg-amber-400 text-amber-950',
      )}
    >
      {mark.kind === 'registered' && <CheckIcon className="size-3.5" />}
      {mark.kind === 'registered' ? 'Registered' : 'Payment pending'}
    </span>
  );
}

/**
 * Catalogue card. The picture is the 640×400 card variant of the poster (~20 KB), lazy-loaded in a
 * fixed 16:10 box so nothing shifts while it arrives; events without a poster get a quiet placeholder.
 */
export function EventTile({ e, href, mark }: { e: EventCard; href: string; mark?: Mark | null }) {
  const I = CATEGORY_ICON[e.category];
  const img = cardImage(e.bannerUrl);
  return (
    // Kept deliberately cheap to scroll past (measured in Chrome at 4× CPU slowdown): no shadow,
    // no hover transitions (cards sliding under the pointer would animate repaints), and no
    // content-visibility (its per-card visibility tracking cost more than it saved here).
    <Link href={href} className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface hover:border-indigo-500/50">
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
        {img ? (
          // No hover zoom: animating a transform on an image re-rasterises it every frame while scrolling.
          <img src={img} alt="" loading="lazy" decoding="async" width={640} height={400} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center bg-gradient-to-br from-indigo-500/15 to-indigo-700/25 text-indigo-500 dark:text-indigo-300">
            <I className="size-10" />
          </div>
        )}
        <span
          className={cx(
            'absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold shadow-sm ring-1 ring-black/5',
            e.pricing.type === 'FREE' ? 'bg-emerald-500 text-white' : 'bg-surface text-fg',
          )}
        >
          {priceLabel(e.pricing, e.participation).replace(/ per (team|member)$/, '')}
        </span>
        {mark && <MarkPill mark={mark} />}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
          <I className="size-3.5 shrink-0" />
          <span className="truncate">
            {CATEGORY_LABEL[e.category]}
            {e.department ? ` · ${e.department.code}` : ' · Fest-wide'}
          </span>
        </p>
        <h3 className="mt-1 line-clamp-2 font-bold leading-snug text-fg group-hover:text-indigo-600 dark:group-hover:text-indigo-300">{e.name}</h3>
        {e.tagline && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{e.tagline}</p>}

        <div className="mt-3 space-y-1.5 text-sm text-fg-2">
          {/* The day is the tab/section the card sits in, so only the time is shown. */}
          <Fact icon={ClockIcon}>{fmtTimeRange(e.startsAt, e.endsAt)}</Fact>
          <Fact icon={!e.venue && e.online ? GlobeIcon : MapPinIcon}>
            {e.venue ?? (e.online ? 'Online' : 'Venue TBA')}
            {e.online && e.venue && <span className="text-subtle"> · also online</span>}
          </Fact>
          <Fact icon={UsersIcon}>{teamLabel(e)}</Fact>
          {e.pricing.type === 'PAID' && (
            <Fact icon={CardIcon}>
              {priceLabel(e.pricing, e.participation)} · {payLabel(e.pricing)}
            </Fact>
          )}
        </div>

        {(e.seatsTotal != null || e.status !== 'PUBLISHED') && (
          <div className="mt-auto pt-4">
            {e.status !== 'PUBLISHED' ? (
              <Badge tone={EVENT_STATUS_TONE[e.status]} dot>
                {EVENT_STATUS_LABEL[e.status]}
              </Badge>
            ) : (
              <SeatsBar left={e.seatsLeft ?? 0} total={e.seatsTotal!} />
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
