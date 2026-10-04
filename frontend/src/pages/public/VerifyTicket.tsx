import { useParams } from 'wouter';
import { AppHeader } from '@/components/AppHeader';
import { Skeleton } from '@/components/data';
import { AlertIcon, CheckIcon, TicketIcon } from '@/components/icons';
import { cx } from '@/components/ui';
import { ticketApi, type TicketStatus } from '@/lib/ems-api';
import { fmtWhen } from '@/lib/format';
import { useQuery } from '@/lib/query';

const LOOK: Record<TicketStatus, { title: string; tone: string; icon: typeof CheckIcon }> = {
  ACTIVE: { title: 'Valid ticket', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', icon: CheckIcon },
  PAYMENT_PENDING: { title: 'Valid after payment at the desk', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', icon: AlertIcon },
  USED: { title: 'Already checked in', tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', icon: AlertIcon },
  VOID: { title: 'Not valid (cancelled)', tone: 'bg-red-500/10 text-red-700 dark:text-red-300', icon: AlertIcon },
};

/** Public ticket check by code: event and status, holder as initials only (no personal data). */
export default function VerifyTicket() {
  const { code } = useParams<{ code: string }>();
  const { data: t, error } = useQuery(`public:verify:${code}`, () => ticketApi.verify(code), { staleMs: 5_000 });
  const look = t ? LOOK[t.status] : null;
  return (
    <div className="min-h-dvh bg-page">
      <AppHeader />
      <main className="mx-auto max-w-md px-4 py-10">
        {error ? (
          <div className={cx('rounded-2xl p-6 text-center', LOOK.VOID.tone)}>
            <TicketIcon className="mx-auto size-8" />
            <p className="mt-3 text-lg font-bold">No such ticket</p>
            <p className="mt-1 text-sm">Check the code: it looks like TCK-XXXX-XX.</p>
          </div>
        ) : !t || !look ? (
          <Skeleton className="h-48 rounded-2xl" />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className={cx('flex items-center gap-3 px-5 py-4', look.tone)}>
              <look.icon className="size-6 shrink-0" />
              <p className="text-lg font-bold">{look.title}</p>
            </div>
            <dl className="divide-y divide-line px-5 text-sm">
              {(
                [
                  ['Ticket', t.code],
                  ['Event', t.event ?? '—'],
                  ['When', fmtWhen(t.startsAt, null)],
                  ['Fest', t.fest ?? '—'],
                  ['Holder', t.holder],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className={cx('text-right font-semibold text-fg', k === 'Ticket' && 'font-mono')}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </main>
    </div>
  );
}
