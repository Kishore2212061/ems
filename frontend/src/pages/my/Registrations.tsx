import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { AppHeader } from '@/components/AppHeader';
import { EmptyState, Skeleton } from '@/components/data';
import { TicketIcon } from '@/components/icons';
import { PageHeader, Tabs } from '@/components/layout';
import { RegistrationRow } from '@/components/RegistrationRow';
import { Alert } from '@/components/ui';
import { fmtDay } from '@/lib/format';
import { useMyRegistrations } from '@/lib/my-registrations';
import { useMyNav } from '@/lib/nav';
import { groupSchedule, isActive, selfClashes } from '@/lib/schedule';

type Tab = 'upcoming' | 'past' | 'cancelled';

/** My registrations as a schedule: upcoming by day and time, then past and cancelled ones. */
export default function Registrations() {
  const nav = useMyNav();
  const { items, loading, error, refetch } = useMyRegistrations();
  const [tab, setTab] = useState<Tab>('upcoming');

  const { upcoming, past, cancelled, clashes } = useMemo(() => {
    const now = Date.now();
    const active = items.filter((r) => isActive(r, now));
    const up = active.filter((r) => Date.parse(r.endsAt) > now);
    return {
      upcoming: up,
      past: items.filter((r) => r.status === 'CONFIRMED' && r.event?.status !== 'CANCELLED' && Date.parse(r.endsAt) <= now).reverse(),
      cancelled: items.filter((r) => !isActive(r, now) && !(r.status === 'CONFIRMED' && r.event?.status !== 'CANCELLED')).reverse(),
      clashes: selfClashes(up),
    };
  }, [items]);

  const list = tab === 'upcoming' ? upcoming : tab === 'past' ? past : cancelled;
  const days = useMemo(() => groupSchedule(upcoming), [upcoming]);

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader nav={nav} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-10">
        <PageHeader title="My registrations" description="Your events by day and time. Show the code at the registration desk." />

        <div className="mt-2">
          <Tabs<Tab>
            label="Registrations"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
              { value: 'past', label: 'Past', count: past.length },
              { value: 'cancelled', label: 'Cancelled', count: cancelled.length },
            ]}
          />
        </div>

        <div className="mt-5">
          {error ? (
            <Alert>
              Couldn't load your registrations.{' '}
              <button type="button" onClick={() => refetch()} className="font-semibold underline">
                Try again
              </button>
            </Alert>
          ) : loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : !list.length ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface">
              <EmptyState
                icon={TicketIcon}
                title={tab === 'upcoming' ? 'Nothing booked yet' : tab === 'past' ? 'No past events yet' : 'Nothing cancelled'}
                description={tab === 'upcoming' ? 'Pick a fest, choose a day, and register for one event per time slot.' : undefined}
                action={
                  tab === 'upcoming' && (
                    <Link href="/" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                      Browse events
                    </Link>
                  )
                }
              />
            </div>
          ) : tab === 'upcoming' ? (
            <div className="space-y-7">
              {days.map((d) => (
                <section key={d.day} aria-labelledby={`day-${d.day}`}>
                  <h2 id={`day-${d.day}`} className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">
                    {fmtDay(d.day)}
                  </h2>
                  <div className="space-y-2.5">
                    {d.slots.flatMap((s) => s.items).map((r) => (
                      <RegistrationRow key={r.code} r={r} clash={clashes.has(r.code)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {list.map((r) => (
                <RegistrationRow key={r.code} r={r} showDay />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
