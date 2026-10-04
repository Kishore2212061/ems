import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { EmptyState, Skeleton } from '@/components/data';
import { ArrowLeftIcon, MailIcon, TicketIcon } from '@/components/icons';
import { QrCode } from '@/components/QrCode';
import { toast } from '@/components/toast';
import { cx } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { ticketApi, type TicketStatus } from '@/lib/ems-api';
import { fmtDay, fmtTimeRange } from '@/lib/format';
import { useQuery } from '@/lib/query';
import { istDay } from '@/lib/schedule';

const STATUS: Record<TicketStatus, { label: string; note: string; tone: string }> = {
  ACTIVE: { label: 'Valid', note: 'Show this QR at the registration desk', tone: 'bg-white/15 text-white' },
  PAYMENT_PENDING: { label: 'Pay first', note: 'Pay at the registration desk, then show this QR', tone: 'bg-amber-400 text-amber-950' },
  USED: { label: 'Checked in', note: 'This ticket has already been used', tone: 'bg-white/15 text-white' },
  VOID: { label: 'Void', note: 'This ticket was cancelled and no longer admits entry', tone: 'bg-red-500 text-white' },
};

/** Keep the screen on while the ticket is shown (released when hidden; re-acquired on return). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    const acquire = () => {
      if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').then((l) => (lock = l), () => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, []);
}

/** Full-screen entry pass: the same ticket card as the sign-in page, with the real QR at full size. */
export default function Ticket() {
  const { code } = useParams<{ code: string }>();
  const { data: t, error, loading } = useQuery(`my:ticket:${code}`, () => ticketApi.get(code), { staleMs: 15_000 });
  const [sending, setSending] = useState(false);
  useWakeLock();
  const qrSize = Math.min(300, (typeof window !== 'undefined' ? window.innerWidth : 360) - 96);
  const s = t ? STATUS[t.status] : null;

  return (
    <div className="min-h-dvh bg-indigo-950 px-4 py-6">
      <div className="mx-auto max-w-sm">
        <Link href={t ? `/my/registrations/${t.registrationCode}` : '/my/registrations'} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-white/70 hover:text-white">
          <ArrowLeftIcon className="size-4" /> Back
        </Link>

        {error ? (
          <div className="rounded-3xl bg-surface">
            <EmptyState icon={TicketIcon} title="Ticket not found" description="Sign in with the email this ticket was issued to." />
          </div>
        ) : loading || !t || !s ? (
          <Skeleton className="h-[34rem] rounded-3xl" />
        ) : (
          <>
            <div className={cx('overflow-hidden rounded-3xl bg-white shadow-2xl', t.status === 'VOID' && 'opacity-80 grayscale')}>
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-500 px-6 pb-5 pt-6 text-white">
                <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[.18em] text-white/70">
                  <span className="truncate">{t.fest?.name ?? 'NEC Events'}</span>
                  <span className={cx('shrink-0 rounded-full px-2 py-0.5 tracking-wider', s.tone)}>{s.label}</span>
                </div>
                <div className="mt-3 text-2xl font-bold leading-tight tracking-tight">{t.event?.name ?? 'Event'}</div>
                <div className="mt-1 text-sm text-white/80">{t.holder}</div>
              </div>
              <div className="grid grid-cols-3 gap-3 px-6 py-5 text-slate-900">
                {(
                  [
                    ['Date', t.event?.startsAt ? fmtDay(istDay(t.event.startsAt)) : 'TBA'],
                    ['Time', t.event?.startsAt ? fmtTimeRange(t.event.startsAt, null) : 'TBA'],
                    ['Venue', t.event?.venue ?? (t.event?.online ? 'Online' : 'TBA')],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k}</div>
                    <div className="mt-0.5 truncate text-sm font-bold" title={v}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mx-6 border-t-2 border-dashed border-slate-200" />
              <div className="flex flex-col items-center px-6 pb-6 pt-5">
                {t.qr ? <QrCode value={t.qr} size={qrSize} label={`Entry QR for ${t.event?.name ?? 'the event'}`} /> : <div className="grid place-items-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500" style={{ width: qrSize, height: qrSize }}>No QR: ticket void</div>}
                <div className="mt-3 font-mono text-base font-bold tracking-[.2em] text-slate-900">{t.code}</div>
                <div className="mt-1 text-center text-xs font-medium text-slate-500">{s.note}</div>
              </div>
            </div>

            <p className="mt-4 text-center text-xs leading-relaxed text-white/60">Turn your screen brightness up at the gate. This page keeps the screen on.</p>
            {t.status !== 'VOID' && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  disabled={sending}
                  onClick={async () => {
                    setSending(true);
                    try {
                      await ticketApi.resend(t.code);
                      toast.success('Ticket emailed to you');
                    } catch (e) {
                      toast.error(e instanceof ApiError && e.status === 429 ? 'Already sent a few times: check your inbox and spam folder' : "Couldn't send the email");
                    } finally {
                      setSending(false);
                    }
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-60"
                >
                  <MailIcon className="size-4" /> Email me this ticket
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
