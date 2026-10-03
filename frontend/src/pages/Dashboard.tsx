import { useState } from 'react';
import { useLocation } from 'wouter';
import { CalendarIcon, LogOutIcon, MailIcon, ShieldIcon, TicketIcon } from '@/components/icons';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo, Spinner } from '@/components/ui';
import { authApi } from '@/lib/auth-api';
import { ROLE_LABEL, useAuth } from '@/store/auth';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard() {
  const user = useAuth((s) => s.user)!;
  const [, navigate] = useLocation();
  const [leaving, setLeaving] = useState(false);
  const primary = user.roles[0];
  const firstName = user.fullName.split(' ')[0];

  async function logout() {
    setLeaving(true);
    await authApi.logout();
    navigate('/login', { replace: true });
  }

  const stats = [
    { label: 'Registrations', value: 0, icon: CalendarIcon, tint: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300' },
    { label: 'Active tickets', value: 0, icon: TicketIcon, tint: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
    { label: 'Events attended', value: 0, icon: ShieldIcon, tint: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  ];

  return (
    <div className="min-h-dvh bg-page">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-5">
          <Logo />
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <ThemeToggle />
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-fg">{user.fullName}</div>
              {primary && <div className="text-xs font-medium text-muted">{ROLE_LABEL[primary.role]}</div>}
            </div>
            <div className="grid size-9 shrink-0 place-items-center rounded-full sm:size-10 bg-gradient-to-br from-indigo-500 to-indigo-600 text-sm font-bold text-white shadow-md shadow-indigo-500/25 ring-2 ring-surface">
              {initials(user.fullName)}
            </div>
            <button
              onClick={logout}
              disabled={leaving}
              title="Sign out"
              className="grid size-9 shrink-0 place-items-center rounded-xl text-muted sm:size-10 transition hover:bg-surface-2 hover:text-fg"
            >
              {leaving ? <Spinner /> : <LogOutIcon className="size-5" />}
              <span className="sr-only">Sign out</span>
            </button>
          </div>
        </div>
      </header>

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
              Your NEC Events account is ready. Event registrations open soon — your tickets and QR passes will show up here.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {user.roles.map((r) => (
                <span
                  key={`${r.role}-${r.scopeId}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/20"
                >
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  {ROLE_LABEL[r.role]}
                </span>
              ))}
            </div>
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
              <h2 className="text-lg font-bold text-fg">My registrations</h2>
            </div>
            <div className="mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed border-line bg-page/50 px-6 py-14 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25">
                <TicketIcon className="size-7" />
              </div>
              <p className="mt-5 text-base font-bold text-fg">No registrations yet</p>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                When registrations open, browse events across all NEC fests and book your spot in a few taps.
              </p>
            </div>
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
