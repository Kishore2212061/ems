import { useMemo } from 'react';
import { Link } from 'wouter';
import { AppHeader, initials } from '@/components/AppHeader';
import { Skeleton } from '@/components/data';
import { CalendarIcon, MailIcon, ShieldIcon, TicketIcon, WalletIcon } from '@/components/icons';
import { RegistrationRow } from '@/components/RegistrationRow';
import { useMyRegistrations } from '@/lib/my-registrations';
import { useMyNav } from '@/lib/nav';
import { isActive } from '@/lib/schedule';
import { useAuth } from '@/store/auth';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard() {
  const user = useAuth((s) => s.user)!;
  const nav = useMyNav();
  const firstName = user.fullName.split(' ')[0];
  const { items, loading } = useMyRegistrations();

  const { upcoming, due, past } = useMemo(() => {
    const now = Date.now();
    const active = items.filter((r) => isActive(r, now));
    return {
      upcoming: active.filter((r) => Date.parse(r.endsAt) > now),
      due: active.filter((r) => r.payment.status === 'DUE' || r.payment.status === 'PENDING').length,
      past: active.filter((r) => Date.parse(r.endsAt) <= now).length,
    };
  }, [items]);

  const stats = [
    { label: 'Upcoming', value: upcoming.length, icon: CalendarIcon, tint: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
    { label: 'Payment due', value: due, icon: WalletIcon, tint: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
    { label: 'Past events', value: past, icon: ShieldIcon, tint: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  ];

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader nav={nav} />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-10">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 px-5 py-7 text-white sm:rounded-3xl shadow-lg shadow-indigo-600/15 dark:from-indigo-600/90 dark:to-indigo-800/90 dark:shadow-none sm:px-10 sm:py-10">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-[radial-gradient(26rem_18rem_at_100%_0%,rgb(255_255_255/.16),transparent_70%)]" />
          </div>
          <div className="relative">
            <p className="text-sm font-medium text-indigo-100">{greeting()},</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{firstName} 👋</h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-indigo-100 sm:text-[15px]">
              {upcoming.length
                ? `You have ${upcoming.length} event${upcoming.length === 1 ? '' : 's'} coming up. Your schedule is below.`
                : 'Pick a fest, choose a day and register for one event per time slot. Your schedule shows up here.'}
            </p>
          </div>
        </section>

        {/* Stats */}
        <section className="mt-4 grid grid-cols-3 gap-3 sm:mt-6 sm:gap-4">
          {stats.map(({ label, value, icon: I, tint }) => (
            <div key={label} className="flex flex-col gap-3 rounded-2xl border border-line/80 bg-surface p-3 shadow-sm min-[360px]:p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
              <div className={`grid size-10 shrink-0 place-items-center rounded-xl sm:size-12 ${tint}`}>
                <I className="size-5 sm:size-6" />
              </div>
              <div>
                <div className="text-xl font-bold text-fg sm:text-2xl">{value}</div>
                <div className="text-xs font-medium leading-snug text-muted sm:text-sm">{label}</div>
              </div>
            </div>
          ))}
        </section>

        <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-3">
          {/* Registrations */}
          <section className="rounded-2xl border border-line/80 bg-surface p-5 shadow-sm sm:p-6 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-fg">Coming up</h2>
              {items.length > 0 && (
                <Link href="/my/registrations" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                  View all
                </Link>
              )}
            </div>
            {loading ? (
              <div className="mt-5 space-y-2.5">
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-20 rounded-xl" />
              </div>
            ) : upcoming.length ? (
              <div className="mt-5 space-y-2.5">
                {upcoming.slice(0, 5).map((r) => (
                  <RegistrationRow key={r.code} r={r} showDay />
                ))}
              </div>
            ) : (
            <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-line bg-page/50 px-6 py-14 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25">
                <TicketIcon className="size-7" />
              </div>
              <p className="mt-5 text-base font-bold text-fg">Nothing booked yet</p>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                Browse the fests, pick your events by day and time, and book your spot in a few taps.
              </p>
              <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500">
                Browse events
              </Link>
            </div>
            )}
          </section>

          {/* Profile */}
          <section className="rounded-2xl border border-line/80 bg-surface p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-4">
              <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-lg font-bold text-white">
                {initials(user.fullName)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-bold text-fg">{user.fullName}</div>
                <div className="flex items-center gap-1 text-sm text-muted">
                  <MailIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{user.email}</span>
                </div>
              </div>
            </div>
            <dl className="mt-6 divide-y divide-line border-t border-line text-sm">
              {(
                [
                  ['Mobile', user.phone ? `+91 ${user.phone.slice(0, 5)} ${user.phone.slice(5)}` : null],
                  ['College', user.college],
                  ['Email', user.emailVerified ? 'Verified' : 'Not verified'],
                  ['Member since', new Date(user.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-3">
                    <dt className="text-muted">{k}</dt>
                    <dd className="truncate text-right font-semibold text-fg">
                      {k === 'Email' ? (
                        <span className={user.emailVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{v}</span>
                      ) : (
                        v
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        </div>
      </main>
    </div>
  );
}
