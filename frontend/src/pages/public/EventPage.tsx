import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { AppHeader } from '@/components/AppHeader';
import { EmptyState, Skeleton } from '@/components/data';
import { CATEGORY_ICON, ClockIcon, ExpandIcon, GlobeIcon, PhoneIcon } from '@/components/event-icons';
import { SeatsBar } from '@/components/EventTile';
import { ArrowLeftIcon, CalendarIcon, MapPinIcon, TicketIcon, UserIcon, UsersIcon } from '@/components/icons';
import { Badge } from '@/components/layout';
import { Dialog } from '@/components/overlay';
import { Alert, Button } from '@/components/ui';
import { CATEGORY_LABEL, EVENT_STATUS_LABEL, EVENT_STATUS_TONE, payLabel, priceLabel, publicApi, teamLabel, type EventDetail } from '@/lib/ems-api';
import { fmtDateTime, fmtWhen } from '@/lib/format';
import { cardImage } from '@/lib/media';
import { useQuery } from '@/lib/query';

/** Why the Register button is (not) available. Registration itself arrives with Module 4. */
function registerState(e: EventDetail): { label: string; note?: string } {
  if (e.status === 'CANCELLED') return { label: 'Event cancelled', note: e.statusReason ?? undefined };
  if (e.status === 'COMPLETED' || e.fest?.status === 'COMPLETED') return { label: 'This event has ended' };
  if (e.status === 'SUSPENDED' || e.fest?.status === 'SUSPENDED') return { label: 'Registrations paused', note: e.statusReason ?? undefined };
  if (e.registrationClosesAt && new Date(e.registrationClosesAt) < new Date()) return { label: 'Registrations closed' };
  if (e.seatsLeft === 0) return { label: 'Event full' };
  return { label: 'Registration opens soon', note: e.registrationClosesAt ? `Closes ${fmtDateTime(e.registrationClosesAt)}` : undefined };
}

const Fact = ({ icon: I, label, children }: { icon: typeof ClockIcon; label: string; children: ReactNode }) => (
  <div className="flex gap-3 py-3">
    <I className="mt-0.5 size-5 shrink-0 text-subtle" />
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium text-fg">{children}</dd>
    </div>
  </div>
);

function FactsCard({ e }: { e: EventDetail }) {
  const cta = registerState(e);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <dl className="-my-3 divide-y divide-line">
        <Fact icon={ClockIcon} label="When">
          {fmtWhen(e.startsAt, e.endsAt)}
        </Fact>
        <Fact icon={!e.venue && e.online ? GlobeIcon : MapPinIcon} label="Where">
          {e.venue ?? (e.online ? 'Online' : 'Venue to be announced')}
          {e.online && e.venue && <span className="block text-sm font-normal text-muted">Can also be attended online</span>}
        </Fact>
        <Fact icon={UsersIcon} label="Participation">
          {teamLabel(e)}
        </Fact>
        <Fact icon={TicketIcon} label="Entry">
          {priceLabel(e.pricing, e.participation)}
          {e.pricing.type === 'PAID' && <span className="block text-sm font-normal text-muted">{payLabel(e.pricing)}</span>}
        </Fact>
      </dl>
      {e.seatsTotal != null && e.status === 'PUBLISHED' && <SeatsBar className="mt-4" left={e.seatsLeft ?? 0} total={e.seatsTotal} />}
      <Button className="mt-5" disabled>
        {cta.label}
      </Button>
      {cta.note && <p className="mt-2 text-center text-sm text-muted">{cta.note}</p>}
    </section>
  );
}

function People({ e }: { e: EventDetail }) {
  if (!e.coordinators.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="font-bold text-fg">Coordinators</h2>
      <ul className="mt-3 space-y-1">
        {e.coordinators.map((c, i) => (
          <li key={i} className="flex items-center gap-3 rounded-xl py-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
              <UserIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-fg">{c.name}</p>
              <p className="text-xs text-muted">{c.role === 'FACULTY' ? 'Faculty coordinator' : 'Student coordinator'}</p>
            </div>
            {c.phone && (
              <a href={`tel:+91${c.phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-300" aria-label={`Call ${c.name}`}>
                <PhoneIcon className="size-4" />
                <span className="hidden sm:inline">{c.phone.replace(/^(\d{5})/, '$1 ')}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function EventPage() {
  const { fest, slug } = useParams<{ fest: string; slug: string }>();
  const { data: e, loading, error } = useQuery(`public:event:${fest}/${slug}`, () => publicApi.event(fest, slug), { staleMs: 30_000 });
  const I = e ? CATEGORY_ICON[e.category] : CalendarIcon;
  const banner = cardImage(e?.bannerUrl);
  const [poster, setPoster] = useState(false);

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-10">
        <Link href={`/events/${fest}`} className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeftIcon className="size-4" /> {e?.fest?.name ?? 'Back to fest'}
        </Link>

        {error ? (
          <div className="rounded-2xl border border-line bg-surface">
            <EmptyState
              icon={CalendarIcon}
              title={error.status === 404 ? 'Event not found' : "Couldn't load this event"}
              description={error.status === 404 ? 'It may not be published yet, or the link is wrong.' : 'Please try again in a moment.'}
              action={
                <Link href={`/events/${fest}`} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                  See all events
                </Link>
              }
            />
          </div>
        ) : loading || !e ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <Skeleton className="h-36 rounded-2xl" />
              <Skeleton className="h-56 rounded-2xl" />
            </div>
            <Skeleton className="h-80 rounded-2xl" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-6">
              <header className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                {banner && (
                  // The card-sized picture (already cached from the catalogue); the full poster loads only on request.
                  <div className="relative aspect-[16/10] bg-surface-2 sm:aspect-[2/1]">
                    <img src={banner} alt="" decoding="async" width={640} height={400} className="size-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPoster(true)}
                      className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-black/60 px-3 text-sm font-semibold text-white hover:bg-black/75"
                    >
                      <ExpandIcon className="size-4" /> View poster
                    </button>
                  </div>
                )}
                <div className="p-5 sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">
                    <I className="size-3.5" />
                    {CATEGORY_LABEL[e.category]}
                  </Badge>
                  <Badge>{e.department ? e.department.name : 'Fest-wide'}</Badge>
                  {e.status !== 'PUBLISHED' && (
                    <Badge tone={EVENT_STATUS_TONE[e.status]} dot>
                      {EVENT_STATUS_LABEL[e.status]}
                    </Badge>
                  )}
                </div>
                <h1 className="mt-3 text-2xl font-bold tracking-tight text-fg sm:text-3xl">{e.name}</h1>
                {e.tagline && <p className="mt-1.5 text-lg text-muted">{e.tagline}</p>}
                {e.organizer && <p className="mt-3 text-sm text-fg-2">Hosted with {e.organizer}</p>}
                {e.status === 'CANCELLED' && (
                  <div className="mt-4">
                    <Alert>This event was cancelled{e.statusReason ? `: ${e.statusReason}` : ''}.</Alert>
                  </div>
                )}
                {e.tags.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
                    {e.tags.map((t) => (
                      <li key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                        {t}
                      </li>
                    ))}
                  </ul>
                )}
                </div>
              </header>

              {/* On phones the key facts + button come right after the title. */}
              <div className="lg:hidden">
                <FactsCard e={e} />
              </div>

              {e.description && (
                <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
                  <h2 className="text-lg font-bold text-fg">About</h2>
                  {/* Plain text on purpose: rendered as text, so organiser input can never inject markup. */}
                  <p className="mt-3 whitespace-pre-line leading-relaxed text-fg-2">{e.description}</p>
                </section>
              )}

              {e.rules.length > 0 && (
                <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
                  <h2 className="text-lg font-bold text-fg">Rules & format</h2>
                  <ol className="mt-4 space-y-3">
                    {e.rules.map((r, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-500/10 text-xs font-bold text-indigo-600 dark:text-indigo-300">{i + 1}</span>
                        <span className="whitespace-pre-line leading-relaxed text-fg-2">{r}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {e.resourcePerson && (
                <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
                  <h2 className="text-lg font-bold text-fg">Resource person</h2>
                  <p className="mt-3 font-semibold text-fg">{e.resourcePerson.name}</p>
                  {(e.resourcePerson.designation || e.resourcePerson.organization) && (
                    <p className="text-sm text-muted">{[e.resourcePerson.designation, e.resourcePerson.organization].filter(Boolean).join(', ')}</p>
                  )}
                  {e.resourcePerson.bio && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-fg-2">{e.resourcePerson.bio}</p>}
                </section>
              )}

              <div className="lg:hidden">
                <People e={e} />
              </div>
            </div>

            <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block lg:self-start">
              <FactsCard e={e} />
              <People e={e} />
            </aside>

          </div>
        )}

        {e?.bannerUrl && (
          <Dialog open={poster} onClose={() => setPoster(false)} title={`${e.name} poster`} size="lg">
            <img src={e.bannerUrl} alt={`${e.name} poster`} decoding="async" className="mx-auto max-h-[75dvh] w-auto rounded-lg" />
          </Dialog>
        )}
      </main>
    </div>
  );
}
