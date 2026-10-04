import { Link, useParams } from 'wouter';
import { AppHeader } from '@/components/AppHeader';
import { EmptyState, Skeleton } from '@/components/data';
import { FestBanner } from '@/components/FestCard';
import { ArrowLeftIcon, CalendarIcon, MailIcon, MapPinIcon } from '@/components/icons';
import { Badge } from '@/components/layout';
import { Alert } from '@/components/ui';
import { publicApi, FEST_STATUS_LABEL, FEST_STATUS_TONE, FEST_TYPE_LABEL } from '@/lib/ems-api';
import { fmtRange } from '@/lib/format';
import { useQuery } from '@/lib/query';
import { EventCatalog } from './EventCatalog';

export default function FestPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: f, loading, error } = useQuery(`public:fest:${slug}`, () => publicApi.fest(slug), { staleMs: 60_000 });

  return (
    <div className="min-h-dvh bg-page">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-10">
        <Link href="/" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeftIcon className="size-4" /> All fests
        </Link>

        {error ? (
          <div className="rounded-2xl border border-line bg-surface">
            <EmptyState
              icon={CalendarIcon}
              title={error.status === 404 ? 'Fest not found' : "Couldn't load this fest"}
              description={error.status === 404 ? 'It may not be published yet, or the link is wrong.' : 'Please try again in a moment.'}
              action={
                <Link href="/" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                  Browse fests
                </Link>
              }
            />
          </div>
        ) : loading || !f ? (
          <div className="space-y-4">
            <Skeleton className="h-56 rounded-3xl" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : (
          <>
            <section className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
              <FestBanner fest={f} className="h-44 sm:h-64" />
              <div className="p-5 sm:p-8">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={FEST_STATUS_TONE[f.status]} dot>
                    {FEST_STATUS_LABEL[f.status]}
                  </Badge>
                  <Badge tone="brand">{FEST_TYPE_LABEL[f.type]}</Badge>
                  <span className="text-sm font-medium text-subtle">Edition {f.editionYear}</span>
                </div>
                <h1 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">{f.name}</h1>
                {f.tagline && <p className="mt-2 text-lg text-muted">{f.tagline}</p>}
                <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-fg-2">
                  <span className="flex items-center gap-2">
                    <CalendarIcon className="size-5 text-subtle" />
                    {fmtRange(f.startsAt, f.endsAt)}
                  </span>
                  {f.venue && (
                    <span className="flex items-center gap-2">
                      <MapPinIcon className="size-5 text-subtle" />
                      {f.venue}
                    </span>
                  )}
                  {f.contactEmail && (
                    <a href={`mailto:${f.contactEmail}`} className="flex items-center gap-2 hover:text-indigo-600 dark:hover:text-indigo-300">
                      <MailIcon className="size-5 text-subtle" />
                      {f.contactEmail}
                    </a>
                  )}
                </div>
                {f.status === 'SUSPENDED' && (
                  <div className="mt-5">
                    <Alert tone="info">Registrations are paused{f.suspendReason ? `: ${f.suspendReason}` : ''}. Existing tickets stay valid.</Alert>
                  </div>
                )}
              </div>
            </section>

            {f.status === 'COMPLETED' && (
              <div className="mt-6">
                <Alert tone="info">This edition has ended and registrations are closed. You can still browse its events.</Alert>
              </div>
            )}

            {f.description && (
              <section className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
                <h2 className="text-lg font-bold text-fg">About</h2>
                <p className="mt-3 max-w-3xl whitespace-pre-line leading-relaxed text-fg-2">{f.description}</p>
              </section>
            )}

            <EventCatalog fest={f} />
          </>
        )}
      </main>
    </div>
  );
}
