import { Link } from 'wouter';
import { fmtRange } from '@/lib/format';
import { FEST_STATUS_LABEL, FEST_STATUS_TONE, FEST_TYPE_LABEL, type FestSummary } from '@/lib/ems-api';
import { CalendarIcon, MapPinIcon } from './icons';
import { Badge } from './layout';

/** Banner image, or a branded gradient with the fest's initials when there isn't one. */
export function FestBanner({ fest, className = 'h-36' }: { fest: Pick<FestSummary, 'name' | 'bannerUrl'>; className?: string }) {
  if (fest.bannerUrl) {
    return <img src={fest.bannerUrl} alt="" loading="lazy" decoding="async" className={`${className} w-full object-cover`} />;
  }
  const letters = fest.name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className={`${className} relative grid w-full place-items-center overflow-hidden bg-gradient-to-br from-indigo-600 to-indigo-800`}>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(20rem_12rem_at_100%_0%,rgb(255_255_255/.18),transparent_70%)]" />
      <span className="relative text-4xl font-bold tracking-tight text-white/90">{letters}</span>
    </div>
  );
}

export function FestCard({ fest, href }: { fest: FestSummary; href: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20"
    >
      <FestBanner fest={fest} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={FEST_STATUS_TONE[fest.status]} dot>
            {FEST_STATUS_LABEL[fest.status]}
          </Badge>
          <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{FEST_TYPE_LABEL[fest.type]}</span>
        </div>
        <h3 className="mt-3 text-lg font-bold leading-snug text-fg group-hover:text-indigo-600 dark:group-hover:text-indigo-300">{fest.name}</h3>
        {fest.tagline && <p className="mt-1 line-clamp-2 text-sm text-muted">{fest.tagline}</p>}
        <div className="mt-auto space-y-1.5 pt-4 text-sm text-fg-2">
          <div className="flex items-center gap-2">
            <CalendarIcon className="size-4 shrink-0 text-subtle" />
            {fmtRange(fest.startsAt, fest.endsAt)}
          </div>
          {fest.venue && (
            <div className="flex items-center gap-2">
              <MapPinIcon className="size-4 shrink-0 text-subtle" />
              <span className="truncate">{fest.venue}</span>
            </div>
          )}
        </div>
        {fest.departments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {fest.departments.slice(0, 5).map((d) => (
              <span key={d.id} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-2">
                {d.code}
              </span>
            ))}
            {fest.departments.length > 5 && <span className="px-1 text-xs font-semibold text-subtle">+{fest.departments.length - 5}</span>}
          </div>
        )}
      </div>
    </Link>
  );
}
