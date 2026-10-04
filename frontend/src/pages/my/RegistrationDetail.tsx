import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { AppHeader } from '@/components/AppHeader';
import { EmptyState, Skeleton } from '@/components/data';
import { ClockIcon, GlobeIcon } from '@/components/event-icons';
import { AlertIcon, ArrowLeftIcon, CheckIcon, CopyIcon, MapPinIcon, TicketIcon, UserIcon } from '@/components/icons';
import { Badge } from '@/components/layout';
import { ConfirmDialog } from '@/components/overlay';
import { payNote, regBadge } from '@/components/RegistrationRow';
import { toast } from '@/components/toast';
import { Alert, Button } from '@/components/ui';
import { regApi, rupees, type Registration } from '@/lib/ems-api';
import { fmtCountdown, fmtWhen } from '@/lib/format';
import { refreshAfterRegistrationChange } from '@/lib/my-registrations';
import { useMyNav } from '@/lib/nav';
import { setQueryData, useQuery } from '@/lib/query';
import { useAuth } from '@/store/auth';

/** Re-renders every second while `on` (the hold countdown). */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function StatusPanel({ r, now }: { r: Registration; now: number }) {
  const holdLeft = r.holdExpiresAt ? Date.parse(r.holdExpiresAt) - now : 0;
  if (r.event?.status === 'CANCELLED' && r.status !== 'CANCELLED') {
    return <Alert>This event was cancelled by the organisers.{r.payment.status === 'PAID' ? ' Your refund will be processed automatically.' : ''}</Alert>;
  }
  if (r.status === 'PAYMENT_PENDING' && holdLeft > 0) {
    const urgent = holdLeft < 2 * 60_000;
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-fg">Complete payment to confirm your seat</p>
            <p className="mt-1 text-sm text-muted">Your seat is held for you until the timer runs out.</p>
          </div>
          <p className={`shrink-0 font-mono text-2xl font-bold tabular-nums ${urgent ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'}`} aria-live="off">
            {fmtCountdown(holdLeft)}
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-amber-500/20 pt-4 text-sm">
          <span className="text-muted">Amount</span>
          <span className="text-lg font-bold text-fg tabular-nums">{rupees(r.payment.amountPaise)}</span>
        </div>
        <Button className="mt-4" disabled>
          Pay {rupees(r.payment.amountPaise)}
        </Button>
        <p className="mt-2 text-center text-xs text-muted">Online payment isn't switched on yet. If the timer runs out, the seat is released and you can register again.</p>
      </div>
    );
  }
  if (r.status === 'PAYMENT_PENDING' || r.status === 'EXPIRED') {
    return (
      <Alert tone="info">
        The seat hold ran out before payment, so the seat was released.{' '}
        {r.event && r.fest && (
          <Link href={`/events/${r.fest.slug}/${r.event.slug}`} className="font-semibold underline">
            Register again
          </Link>
        )}
      </Alert>
    );
  }
  if (r.status === 'CANCELLED') return <Alert tone="info">This registration was cancelled{r.cancelReason ? `: ${r.cancelReason}` : '.'}</Alert>;
  const due = r.payment.status === 'DUE';
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${due ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
      <p className={`flex items-center gap-2 font-semibold ${due ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
        {due ? <AlertIcon className="size-5" /> : <CheckIcon className="size-5" />}
        {due ? payNote(r) : "You're registered"}
      </p>
      <p className="mt-1 text-sm text-muted">{due ? 'Your place is confirmed. Pay at the desk before the event starts and show this code.' : 'Show this code at the registration desk on the day.'}</p>
    </div>
  );
}

/** One registration: code to show at the desk, status (with the hold countdown), event and team. */
export default function RegistrationDetail() {
  const { code } = useParams<{ code: string }>();
  const nav = useMyNav();
  const me = useAuth((s) => s.user);
  const key = `my:registration:${code}`;
  const { data: r, loading, error, refetch } = useQuery(key, () => regApi.get(code), { staleMs: 15_000 });
  const pending = r?.status === 'PAYMENT_PENDING';
  const now = useNow(!!pending);
  const [confirm, setConfirm] = useState(false);

  // When the hold runs out, ask the server for the final word (it releases the seat).
  const expired = pending && r?.holdExpiresAt && Date.parse(r.holdExpiresAt) <= now;
  useEffect(() => {
    if (expired) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  const leader = r?.members.find((m) => m.leader);
  const cancellable =
    !!r && r.role === 'LEADER' && (r.status === 'CONFIRMED' || (r.status === 'PAYMENT_PENDING' && !expired)) && r.payment.status !== 'PAID' && r.event?.status !== 'CANCELLED' && Date.parse(r.startsAt) > now;

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader nav={nav} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5 sm:py-10">
        <Link href="/my/registrations" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeftIcon className="size-4" /> My registrations
        </Link>

        {error ? (
          <div className="rounded-2xl border border-line bg-surface">
            <EmptyState icon={TicketIcon} title={error.status === 404 ? 'Registration not found' : "Couldn't load this registration"} description={error.status === 404 ? 'Check the code, or sign in with the email it was made for.' : 'Please try again in a moment.'} />
          </div>
        ) : loading || !r ? (
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={regBadge(r, now).tone} dot>
                  {regBadge(r, now).label}
                </Badge>
                {r.fest && <span className="text-sm text-muted">{r.fest.name}</span>}
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-fg">
                {r.event && r.fest ? (
                  <Link href={`/events/${r.fest.slug}/${r.event.slug}`} className="hover:text-indigo-600 dark:hover:text-indigo-300">
                    {r.event.name}
                  </Link>
                ) : (
                  'Event'
                )}
              </h1>
              <dl className="mt-4 space-y-2 text-sm text-fg-2">
                <div className="flex items-center gap-2">
                  <ClockIcon className="size-4 shrink-0 text-subtle" />
                  <dt className="sr-only">When</dt>
                  <dd>{fmtWhen(r.event?.startsAt ?? r.startsAt, r.event?.endsAt ?? null)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  {r.event?.venue || !r.event?.online ? <MapPinIcon className="size-4 shrink-0 text-subtle" /> : <GlobeIcon className="size-4 shrink-0 text-subtle" />}
                  <dt className="sr-only">Where</dt>
                  <dd>{r.event?.venue ?? (r.event?.online ? 'Online' : 'Venue to be announced')}</dd>
                </div>
              </dl>

              <div className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Registration code</p>
                  <p className="font-mono text-xl font-bold tracking-widest text-fg">{r.code}</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(r.code).then(() => toast.success('Code copied'))}
                  className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface hover:text-fg"
                  aria-label="Copy code"
                >
                  <CopyIcon className="size-4" />
                </button>
              </div>
            </section>

            <StatusPanel r={r} now={now} />

            <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <h2 className="font-bold text-fg">{r.members.length > 1 ? (r.teamName ? `Team ${r.teamName}` : 'Team') : 'Participant'}</h2>
              <ul className="mt-3 divide-y divide-line">
                {r.members.map((m) => (
                  <li key={m.email} className="flex items-center gap-3 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                      <UserIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">
                        {m.name}
                        {m.email === me?.email && <span className="font-normal text-muted"> (you)</span>}
                      </p>
                      <p className="truncate text-xs text-muted">{m.email}</p>
                    </div>
                    {m.leader && r.members.length > 1 && <Badge tone="brand">Leader</Badge>}
                  </li>
                ))}
              </ul>
              {r.role === 'MEMBER' && <p className="mt-3 text-sm text-muted">Only {leader?.name ?? 'the team leader'} can cancel this registration.</p>}
            </section>

            {cancellable && (
              <div className="pt-2 text-center">
                <Button variant="ghost" block={false} className="text-red-600 hover:text-red-700 dark:text-red-400" onClick={() => setConfirm(true)}>
                  Cancel registration
                </Button>
              </div>
            )}
          </div>
        )}

        {r && (
          <ConfirmDialog
            open={confirm}
            onClose={() => setConfirm(false)}
            tone="danger"
            title="Cancel this registration?"
            message={`Your ${r.members.length > 1 ? "team's " : ''}place in ${r.event?.name ?? 'the event'} is released${r.members.length > 1 ? ' and your teammates are emailed' : ''}. You can register again while seats are left.`}
            confirmLabel="Cancel registration"
            onConfirm={async () => {
              const updated = await regApi.cancel(r.code);
              setQueryData(key, updated);
              refreshAfterRegistrationChange();
              toast.success('Registration cancelled');
            }}
          />
        )}
      </main>
    </div>
  );
}
