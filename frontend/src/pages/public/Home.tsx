import { Link } from 'wouter';
import { AppHeader } from '@/components/AppHeader';
import { EmptyState, Skeleton } from '@/components/data';
import { FestCard } from '@/components/FestCard';
import { ArrowRightIcon, CalendarIcon } from '@/components/icons';
import { Alert } from '@/components/ui';
import { publicApi } from '@/lib/ems-api';
import { useQuery } from '@/lib/query';
import { useAuth } from '@/store/auth';

export default function Home() {
  const user = useAuth((s) => s.user);
  const { data: fests, loading, error, refetch } = useQuery('public:fests', publicApi.fests, { staleMs: 60_000 });
  const live = fests?.filter((f) => f.status !== 'COMPLETED') ?? [];
  const past = fests?.filter((f) => f.status === 'COMPLETED') ?? [];

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader />

      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-600 to-indigo-800 text-white">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(36rem_22rem_at_90%_-10%,rgb(255_255_255/.16),transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-5 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-indigo-200">National Engineering College</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">Every NEC fest, in one place.</h1>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-indigo-100">
            Browse technical symposiums, cultural fests and hackathons. Register once, pay online and get your QR pass instantly.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#fests" className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 text-[15px] font-semibold text-indigo-700 shadow-lg shadow-black/10 transition hover:bg-indigo-50">
              Explore fests <ArrowRightIcon className="size-4" />
            </a>
            {!user && (
              <Link href="/signup" className="inline-flex h-12 items-center rounded-xl px-5 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/30 transition hover:bg-white/10">
                Create an account
              </Link>
            )}
          </div>
        </div>
      </section>

      <main id="fests" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-10 sm:px-5 sm:py-14">
        <h2 className="text-2xl font-bold tracking-tight text-fg">Happening now</h2>
        <p className="mt-1 text-muted">Fests open for registration and coming up.</p>

        <div className="mt-6">
          {error ? (
            <Alert>
              Couldn&apos;t load fests.{' '}
              <button type="button" onClick={refetch} className="font-semibold underline">
                Try again
              </button>
            </Alert>
          ) : loading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
                  <Skeleton className="h-36 rounded-none" />
                  <div className="space-y-3 p-5">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : live.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface">
              <EmptyState icon={CalendarIcon} title="No fests are live right now" description="New editions are announced here first. Check back soon." />
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {live.map((f) => (
                <FestCard key={f.id} fest={f} href={`/events/${f.slug}`} />
              ))}
            </div>
          )}
        </div>

        {past.length > 0 && (
          <>
            <h2 className="mt-14 text-xl font-bold tracking-tight text-fg">Past editions</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {past.map((f) => (
                <FestCard key={f.id} fest={f} href={`/events/${f.slug}`} />
              ))}
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-line py-8 text-center text-sm text-subtle">© {new Date().getFullYear()} National Engineering College, Kovilpatti</footer>
    </div>
  );
}
