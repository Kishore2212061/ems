import type { ReactNode } from 'react';
import { Logo } from './ui';

const FEATURES = [
  ['Every fest, one account', 'Tech Fest, cultural fests and hackathons — register for all of them here.'],
  ['Instant QR tickets', 'Pay by UPI or card and get your entry pass by email right away.'],
  ['Team registrations', 'Add teammates once; each member gets their own ticket.'],
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-indigo-700 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-32 size-[28rem] rounded-full bg-violet-500/40 blur-3xl" />
          <div className="absolute -bottom-40 -right-20 size-[32rem] rounded-full bg-indigo-400/30 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/.06)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        </div>

        <div className="relative">
          <Logo light />
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-white">
            One pass for every
            <br />
            NEC fest.
          </h2>
          <ul className="mt-10 space-y-6">
            {FEATURES.map(([t, d]) => (
              <li key={t} className="flex gap-4">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/20">
                  <svg viewBox="0 0 20 20" className="size-4 text-white" fill="currentColor" aria-hidden>
                    <path d="M8.1 13.6 4.5 10l-1.1 1.1 4.7 4.7 9.4-9.4-1.1-1.1z" />
                  </svg>
                </span>
                <div>
                  <div className="font-medium text-white">{t}</div>
                  <div className="mt-0.5 text-sm leading-relaxed text-indigo-200">{d}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-indigo-300">© {new Date().getFullYear()} National Engineering College, Kovilpatti</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1.5 text-[15px] text-slate-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
