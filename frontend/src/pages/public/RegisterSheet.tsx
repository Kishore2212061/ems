import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CardIcon, ClockIcon, TrashIcon } from '@/components/event-icons';
import { CheckIcon, MapPinIcon, PlusIcon, UserIcon, WalletIcon } from '@/components/icons';
import { Dialog } from '@/components/overlay';
import { Alert, Button, cx, Field } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { payApi, regApi, rupees, type EventDetail, type PaymentMode, type Registration } from '@/lib/ems-api';
import { calculateBreakdown, hasExtras } from '@/lib/fees';
import { fmtWhen } from '@/lib/format';
import { refreshAfterRegistrationChange } from '@/lib/my-registrations';
import { useQuery } from '@/lib/query';
import { useAuth } from '@/store/auth';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Mate = { name: string; email: string };

/** A fresh key per attempt-session: retries and double taps reuse it, so the server registers once. */
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

const MODE_COPY: Record<PaymentMode, { title: string; note: string }> = {
  ONLINE: { title: 'Pay online now', note: 'UPI, cards or net banking. Your seat is held for 10 minutes while you pay.' },
  OFFLINE: { title: 'Pay at the registration desk', note: 'Your place is confirmed now; pay before the event starts.' },
};

/**
 * Register for one event: you (the leader) + teammates by name and email, how you'll pay, and
 * the total. Free and pay-at-desk entries are confirmed on the spot; online ones go to checkout.
 */
export default function RegisterSheet({ event: e, open, onClose, onRegistered }: {
  event: EventDetail;
  open: boolean;
  onClose: () => void;
  /** Online-pay registrations: the caller moves on to checkout. */
  onRegistered: (r: Registration) => void;
}) {
  const user = useAuth((s) => s.user)!;
  const team = e.participation === 'TEAM';
  const blank = useMemo(() => Array.from({ length: Math.max(0, e.teamMin - 1) }, () => ({ name: '', email: '' })), [e.teamMin]);
  const [teamName, setTeamName] = useState('');
  const [mates, setMates] = useState<Mate[]>(blank);
  const modes = e.pricing.modes;
  const [mode, setMode] = useState<PaymentMode | undefined>(modes.length === 1 ? modes[0] : undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Registration | null>(null);
  const [key, setKey] = useState(newKey);

  useEffect(() => {
    if (!open) return;
    setTeamName('');
    setMates(blank);
    setMode(modes.length === 1 ? modes[0] : undefined);
    setErrors({});
    setFailure(null);
    setDone(null);
    setKey(newKey());
    // Reset when the sheet opens, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const size = mates.length + 1;
  const paid = e.pricing.type === 'PAID';
  // Same maths as the server (fees/GST from the org settings; the platform fee only applies online).
  const { data: fees } = useQuery(paid ? 'public:fees' : null, payApi.fees, { staleMs: 60_000 });
  const breakdown = calculateBreakdown(paid ? e.pricing.amountPaise * (e.pricing.per === 'MEMBER' ? size : 1) : 0, mode === 'ONLINE', fees ?? { platformFeeBps: 0, platformFeeFlatPaise: 0, gstBps: 0, feeBearer: 'PARTICIPANT' });
  const total = breakdown.totalPaise;

  const setMate = (i: number, k: keyof Mate, v: string) => {
    setMates((m) => m.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
    setErrors((er) => {
      const { [`teammates.${i}.${k}`]: _, ...rest } = er;
      return rest;
    });
  };

  function validate() {
    const er: Record<string, string> = {};
    const seen = new Set([user.email.toLowerCase()]);
    mates.forEach((m, i) => {
      if (m.name.trim().length < 2) er[`teammates.${i}.name`] = 'Enter their name';
      const email = m.email.trim().toLowerCase();
      if (!EMAIL.test(email)) er[`teammates.${i}.email`] = 'Enter a valid email';
      else if (email === user.email.toLowerCase()) er[`teammates.${i}.email`] = "That's you: you're the team leader";
      else if (seen.has(email)) er[`teammates.${i}.email`] = 'Already in this team';
      seen.add(email);
    });
    if (paid && !mode) er.paymentMode = 'Choose how you will pay';
    return er;
  }

  async function submit() {
    const er = validate();
    setErrors(er);
    setFailure(null);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const r = await regApi.create(
        { eventId: e.id, teamName: team ? teamName.trim() || null : null, teammates: mates.map((m) => ({ name: m.name.trim(), email: m.email.trim() })), paymentMode: paid ? mode : undefined },
        key,
      );
      refreshAfterRegistrationChange();
      if (r.status === 'PAYMENT_PENDING') onRegistered(r);
      else setDone(r);
    } catch (err) {
      const a = err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong. Please try again.');
      if (a.details?.fields) setErrors(a.details.fields);
      setFailure(a);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={<span className="sr-only">Registered</span>}
        footer={
          <>
            <Button variant="secondary" size="sm" block={false} onClick={onClose}>
              Done
            </Button>
            <Link href={`/my/registrations/${done.code}`} className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500">
              View registration
            </Link>
          </>
        }
      >
        <div className="flex flex-col items-center text-center">
          <span className="grid size-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-7" />
          </span>
          <p className="mt-4 text-xl font-bold text-fg">You're registered!</p>
          <p className="mt-1 text-sm text-muted">{e.name}</p>
          <p className="mt-4 rounded-xl bg-surface-2 px-4 py-2 font-mono text-lg font-bold tracking-widest text-fg">{done.code}</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-fg-2">
            {done.payment.status === 'DUE'
              ? `Pay ${rupees(done.payment.amountPaise)} at the registration desk before the event. Show this code there.`
              : 'Show this code at the registration desk.'}
            {done.members.length > 1 && ' Your teammates got an email too.'}
          </p>
        </div>
      </Dialog>
    );
  }

  const clash = failure && (failure.code === 'TIME_CLASH' || failure.code === 'MEMBER_ALREADY_REGISTERED') && failure.details?.self && failure.details.code;

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={team ? 'Register your team' : 'Register'}
      description={
        <span className="flex flex-col gap-1">
          <span className="font-semibold text-fg-2">{e.name}</span>
          <span className="flex items-center gap-1.5">
            <ClockIcon className="size-4 shrink-0" /> {fmtWhen(e.startsAt, e.endsAt)}
          </span>
          {e.venue && (
            <span className="flex items-center gap-1.5">
              <MapPinIcon className="size-4 shrink-0" /> {e.venue}
            </span>
          )}
        </span>
      }
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {paid ? (
              <>
                Total <span className="text-lg font-bold text-fg tabular-nums">{rupees(total)}</span>
                {e.pricing.per === 'MEMBER' && size > 1 && <span className="ml-1">({size} × {rupees(e.pricing.amountPaise)})</span>}
                {hasExtras(breakdown) && <span className="ml-1">incl. fees & GST</span>}
              </>
            ) : (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Free entry</span>
            )}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" size="sm" block={false} onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" block={false} onClick={submit} loading={busy}>
              {paid && mode === 'ONLINE' ? 'Continue to payment' : 'Confirm registration'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {failure && !failure.details?.fields && (
          <Alert>
            {failure.message}
            {clash && (
              <>
                {' '}
                <Link href={`/my/registrations/${failure.details!.code}`} className="font-semibold underline">
                  View it
                </Link>
              </>
            )}
          </Alert>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold text-fg-2">{team ? 'Team leader (you)' : 'Participant'}</p>
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
              <UserIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{user.fullName}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
        </div>

        {team && (
          <>
            <Field label="Team name" placeholder="Optional, e.g. Byte Busters" maxLength={60} value={teamName} onChange={(ev) => setTeamName(ev.target.value)} />
            <fieldset>
              <legend className="flex w-full items-baseline justify-between text-sm font-semibold text-fg-2">
                <span>Teammates</span>
                <span className="text-xs font-medium text-muted tabular-nums">
                  Team of {size} ({e.teamMin === e.teamMax ? `exactly ${e.teamMax}` : `${e.teamMin}–${e.teamMax} allowed`})
                </span>
              </legend>
              <p className="mt-1 text-xs text-muted">They'll get an email, and see it under My registrations when they sign in with that address.</p>
              <ol className="mt-3 space-y-3">
                {mates.map((m, i) => (
                  <li key={i} className="rounded-xl border border-line p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Teammate {i + 1}</span>
                      {size > e.teamMin && (
                        <button type="button" onClick={() => setMates((x) => x.filter((_, j) => j !== i))} aria-label={`Remove teammate ${i + 1}`} className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-surface-2 hover:text-red-600">
                          <TrashIcon className="size-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Name" autoComplete="off" value={m.name} onChange={(ev) => setMate(i, 'name', ev.target.value)} error={errors[`teammates.${i}.name`]} />
                      <Field label="Email" type="email" inputMode="email" autoComplete="off" value={m.email} onChange={(ev) => setMate(i, 'email', ev.target.value)} error={errors[`teammates.${i}.email`]} />
                    </div>
                  </li>
                ))}
              </ol>
              {size < e.teamMax && (
                <button type="button" onClick={() => setMates((x) => [...x, { name: '', email: '' }])} className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-300">
                  <PlusIcon className="size-4" /> Add teammate
                </button>
              )}
            </fieldset>
          </>
        )}

        {paid && (
          <fieldset>
            <legend className="text-sm font-semibold text-fg-2">Payment</legend>
            {modes.length > 1 ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup">
                {modes.map((m) => {
                  const Icon = m === 'ONLINE' ? CardIcon : WalletIcon;
                  const on = mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setMode(m);
                        setErrors(({ paymentMode: _, ...rest }) => rest);
                      }}
                      className={cx('flex gap-3 rounded-xl border p-3 text-left', on ? 'border-indigo-500 bg-indigo-500/5 ring-2 ring-indigo-500/20' : 'border-line hover:border-line-strong')}
                    >
                      <Icon className={cx('mt-0.5 size-5 shrink-0', on ? 'text-indigo-600 dark:text-indigo-300' : 'text-subtle')} />
                      <span>
                        <span className="block text-sm font-semibold text-fg">{MODE_COPY[m].title}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{MODE_COPY[m].note}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-2 flex gap-3 rounded-xl border border-line p-3">
                {modes[0] === 'ONLINE' ? <CardIcon className="mt-0.5 size-5 shrink-0 text-subtle" /> : <WalletIcon className="mt-0.5 size-5 shrink-0 text-subtle" />}
                <span>
                  <span className="block text-sm font-semibold text-fg">{MODE_COPY[modes[0]].title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{MODE_COPY[modes[0]].note}</span>
                </span>
              </div>
            )}
            {errors.paymentMode && <p className="mt-1.5 text-[13px] font-medium text-red-600 dark:text-red-400">{errors.paymentMode}</p>}
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
