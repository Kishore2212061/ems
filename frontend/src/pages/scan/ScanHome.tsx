import { useEffect } from 'react';
import { Link, Redirect } from 'wouter';
import { AppHeader } from '@/components/AppHeader';
import { EmptyState, Skeleton } from '@/components/data';
import { ScanIcon } from '@/components/icons';
import { PageHeader } from '@/components/layout';
import { Alert } from '@/components/ui';
import { checkinApi } from '@/lib/ems-api';
import { fmtDay, fmtTimeRange } from '@/lib/format';
import { useMyNav } from '@/lib/nav';
import { can } from '@/lib/permissions';
import { useQuery } from '@/lib/query';
import { istDay } from '@/lib/schedule';
import { activeRoleName, currentHome, roleKey, useAuth } from '@/store/auth';

/** Check-in home: pick the event whose gate you're running (only events you're allowed to scan). */
export default function ScanHome() {
  const user = useAuth((s) => s.user)!;
  const active = useAuth((s) => s.activeRole);
  const setActive = useAuth((s) => s.setActiveRole);
  const nav = useMyNav();
  const scannerRole = user.roles.find((r) => r.role === 'SCANNER');
  const allowed = can(user, 'checkin.scan');
  const { data, loading, error, refetch } = useQuery(allowed ? 'gate:events' : null, checkinApi.events, { staleMs: 15_000 });

  // A scanner who opened /scan in another role context is switched to the scanner role.
  useEffect(() => {
    if (scannerRole && activeRoleName(active) === 'PARTICIPANT') setActive(roleKey(scannerRole));
  }, [active, scannerRole, setActive]);

  if (!allowed) return <Redirect to={currentHome()} replace />;
  const fests = data?.fests ?? [];

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader nav={nav} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-5 sm:py-10">
        <PageHeader title="Check-in" description="Pick the event at your gate, then scan participants' QR passes." />
        {error ? (
          <Alert>
            Couldn't load your events.{' '}
            <button type="button" className="font-semibold underline" onClick={() => refetch()}>
              Try again
            </button>
          </Alert>
        ) : loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : !fests.length ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface">
            <EmptyState icon={ScanIcon} title="No events to check in" description="Live events you're assigned to appear here." />
          </div>
        ) : (
          <div className="space-y-8">
            {fests.map((f) => (
              <section key={f.id}>
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">{f.name}</h2>
                <ul className="space-y-2.5">
                  {f.events.map((e) => {
                    const pct = e.expected ? Math.round((e.checkedIn / e.expected) * 100) : 0;
                    return (
                      <li key={e.id}>
                        <Link href={`/scan/${e.id}`} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 hover:border-indigo-500/50">
                          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                            <ScanIcon className="size-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-fg">{e.name}</span>
                            <span className="block truncate text-sm text-muted">
                              {e.startsAt ? `${fmtDay(istDay(e.startsAt))} · ${fmtTimeRange(e.startsAt, e.endsAt)}` : 'Time TBA'}
                              {e.venue && ` · ${e.venue}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-lg font-bold tabular-nums text-fg">
                              {e.checkedIn}
                              <span className="text-sm font-medium text-muted">/{e.expected}</span>
                            </span>
                            <span className="block text-xs text-muted">{pct}% in</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
