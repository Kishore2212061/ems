import { Link } from 'wouter';
import { rupees, type Registration } from '@/lib/ems-api';
import { fmtDay, fmtTime } from '@/lib/format';
import { isActive, istDay } from '@/lib/schedule';
import { AlertIcon } from './icons';
import { Badge, type Tone } from './layout';

/** One status for a registration as the participant sees it. */
export function regBadge(r: Registration, now = Date.now()): { tone: Tone; label: string } {
  if (r.event?.status === 'CANCELLED' && r.status !== 'CANCELLED') return { tone: 'danger', label: 'Event cancelled' };
  switch (r.status) {
    case 'CONFIRMED':
      return r.payment.status === 'DUE' ? { tone: 'warning', label: 'Pay at desk' } : { tone: 'success', label: 'Confirmed' };
    case 'PAYMENT_PENDING':
      return isActive(r, now) ? { tone: 'warning', label: 'Payment pending' } : { tone: 'neutral', label: 'Hold expired' };
    case 'EXPIRED':
      return { tone: 'neutral', label: 'Hold expired' };
    default:
      return { tone: 'danger', label: 'Cancelled' };
  }
}

/** "Pay ₹200 at the registration desk", "Complete payment: ₹300", or null. */
export function payNote(r: Registration) {
  if (r.status === 'CONFIRMED' && r.payment.status === 'DUE') return `Pay ${rupees(r.payment.amountPaise)} at the registration desk`;
  if (r.status === 'PAYMENT_PENDING' && isActive(r)) return `Complete payment: ${rupees(r.payment.amountPaise)}`;
  return null;
}

/**
 * A registration in a schedule list: time on the left (plus the day when the list spans days),
 * event, place and team on the right. Plain row: cheap to scroll, no images.
 */
export function RegistrationRow({ r, showDay, clash }: { r: Registration; showDay?: boolean; clash?: boolean }) {
  const badge = regBadge(r);
  const note = payNote(r);
  const venue = r.event?.venue ?? (r.event?.online ? 'Online' : 'Venue TBA');
  const team = r.members.length > 1 ? `${r.teamName ?? 'Team'} · ${r.members.length} people` : null;
  return (
    <Link href={`/my/registrations/${r.code}`} className="flex gap-3 rounded-xl border border-line bg-surface p-3.5 hover:border-indigo-500/50 sm:gap-4 sm:p-4">
      <div className="w-[4.5rem] shrink-0 sm:w-20">
        {showDay && <p className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-subtle">{fmtDay(istDay(r.startsAt))}</p>}
        <p className="text-sm font-bold tabular-nums text-fg">{fmtTime(r.startsAt)}</p>
        {r.event?.endsAt && <p className="text-xs tabular-nums text-muted">to {fmtTime(r.event.endsAt)}</p>}
      </div>
      <div className="min-w-0 flex-1 border-l border-line pl-3 sm:pl-4">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate font-semibold text-fg">{r.event?.name ?? 'Event'}</p>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted">
          {venue}
          {team && ` · ${team}`}
          {r.role === 'MEMBER' && ' · added by your leader'}
        </p>
        {(note || clash) && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <AlertIcon className="size-3.5 shrink-0" />
            {clash ? 'Overlaps another of your events (the time changed)' : note}
          </p>
        )}
      </div>
    </Link>
  );
}
