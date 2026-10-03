import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { Logo } from './ui';

// Decorative QR: deterministic pseudo-random modules + the three finder squares. Pure SVG, no lib.
const N = 21;
const QR_CELLS = (() => {
  const cells: [number, number][] = [];
  let seed = 7;
  const finder = (x: number, y: number) => (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      seed = (seed * 9301 + 49297) % 233280;
      if (!finder(x, y) && seed / 233280 > 0.52) cells.push([x, y]);
    }
  return cells;
})();

function FakeQr() {
  const finder = (x: number, y: number) => (
    <g key={`${x}${y}`}>
      <rect x={x} y={y} width="7" height="7" rx="1.5" fill="#0f172a" />
      <rect x={x + 1} y={y + 1} width="5" height="5" rx="1" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" rx=".6" fill="#0f172a" />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${N + 2} ${N + 2}`} className="size-24 shrink-0" aria-hidden>
      {QR_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 0.1} y={y + 0.1} width=".8" height=".8" rx=".2" fill="#0f172a" />
      ))}
      {finder(0, 0)}
      {finder(N - 7, 0)}
      {finder(0, N - 7)}
    </svg>
  );
}

function TicketCard() {
  return (
    <div className="w-full max-w-[340px]">
      <div className="overflow-hidden rounded-3xl bg-white shadow-[0_30px_70px_-25px_rgb(0_0_0/.6)] ring-1 ring-white/10">
        <div className="bg-gradient-to-br from-indigo-600 to-indigo-500 px-6 pb-5 pt-6 text-white">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[.18em] text-white/70">
            <span>NEC Tech Fest '25</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 tracking-wider text-white">Confirmed</span>
          </div>
          <div className="mt-3 text-2xl font-bold tracking-tight">Blind Coding Challenge</div>
          <div className="mt-1 text-sm text-white/75">Dept. of Computer Science & Engg.</div>
        </div>
        <div className="grid grid-cols-3 gap-3 px-6 py-5 text-slate-900">
          {[
            ['Date', '14 Mar'],
            ['Time', '10:00 AM'],
            ['Venue', 'IT Lab 3'],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k}</div>
              <div className="mt-0.5 text-sm font-bold">{v}</div>
            </div>
          ))}
        </div>
        <div className="mx-6 border-t-2 border-dashed border-slate-200" />
        <div className="flex items-center justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Admit one</div>
            <div className="mt-1 font-mono text-base font-bold tracking-wider text-slate-900">TCK-7Q2K-91</div>
            <div className="mt-1 text-xs font-medium text-slate-500">Scan at the venue entrance</div>
          </div>
          <FakeQr />
        </div>
      </div>
    </div>
  );
}

const STATS = [
  ['100+', 'Events'],
  ['9', 'Departments'],
  ['2', 'Days'],
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-page lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-indigo-950 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(40rem_32rem_at_0%_0%,rgb(99_102_241/.35),transparent_70%),radial-gradient(36rem_28rem_at_100%_100%,rgb(99_102_241/.18),transparent_70%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/.08)_1px,transparent_1px)] bg-[size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
        </div>

        <div className="relative">
          <Logo light />
        </div>

        <div className="relative flex flex-col items-center py-10">
          <TicketCard />
        </div>

        <div className="relative">
          <h2 className="max-w-md text-3xl font-bold leading-[1.15] tracking-tight text-white xl:text-4xl">
            One account for every <span className="text-indigo-300">NEC fest</span>.
          </h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60">
            Register for events, pay online and get your QR pass instantly.
          </p>
          <dl className="mt-8 flex gap-10">
            {STATS.map(([n, l]) => (
              <div key={l}>
                <dt className="text-2xl font-bold text-white">{n}</dt>
                <dd className="text-sm font-medium text-white/50">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>

      <main className="relative flex items-center justify-center overflow-hidden px-5 py-10 sm:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(30rem_16rem_at_100%_0%,rgb(99_102_241/.14),transparent_70%)] lg:hidden" />
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <ThemeToggle />
        </div>
        <div className="relative w-full max-w-[420px]">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-fg">{title}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-12 text-center text-xs text-subtle">
            © {new Date().getFullYear()} National Engineering College, Kovilpatti
          </p>
        </div>
      </main>
    </div>
  );
}
