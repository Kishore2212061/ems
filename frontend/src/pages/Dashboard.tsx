import { useState } from 'react';
import { useLocation } from 'wouter';
import { Logo, Spinner } from '@/components/ui';
import { authApi } from '@/lib/auth-api';
import { ROLE_LABEL, useAuth } from '@/store/auth';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

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

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <div className="flex items-center gap-3">
            {primary && (
              <span className="hidden rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-600/10 sm:inline">
                {ROLE_LABEL[primary.role]}
              </span>
            )}
            <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white">
              {initials(user.fullName)}
            </div>
            <button
              onClick={logout}
              disabled={leaving}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {leaving ? <Spinner /> : null}
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Hi {firstName} 👋</h1>
        <p className="mt-1 text-slate-500">Here's what's happening with your account.</p>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs lg:col-span-2">
            <h2 className="font-semibold">My registrations</h2>
            <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-indigo-50 text-indigo-600">
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 9a2 2 0 0 0 2-2V5h14v2a2 2 0 0 0 0 4v2a2 2 0 0 0 0 4v2H5v-2a2 2 0 0 0-2-2" />
                  <path d="M9 5v14" strokeDasharray="2 2" />
                </svg>
              </div>
              <p className="mt-4 font-medium">No registrations yet</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Event registrations open soon. Your tickets and QR passes will appear here.
              </p>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <h2 className="font-semibold">Profile</h2>
            <dl className="mt-5 space-y-4 text-sm">
              {[
                ['Name', user.fullName],
                ['Email', user.email],
                ['Mobile', user.phone],
                ['College', user.college],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="mt-0.5 break-words font-medium text-slate-900">{v}</dd>
                  </div>
                ))}
              <div>
                <dt className="text-slate-500">Roles</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {user.roles.map((r) => (
                    <span key={`${r.role}-${r.scopeId}`} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {ROLE_LABEL[r.role]}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </main>
    </div>
  );
}
