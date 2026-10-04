import { useState } from 'react';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { Dialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, cx, TextareaField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { refundApi, rupees, type Registration, type RefundView } from '@/lib/ems-api';
import { fmtDateTime } from '@/lib/format';
import { invalidate, useQuery } from '@/lib/query';

const ACTIVE = ['REQUESTED', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'MANUAL_PENDING', 'MANUAL_DONE', 'FAILED'];

/** Requested → Approved → Processing → Refunded, as a small vertical timeline. */
function Timeline({ r }: { r: RefundView }) {
  const stage = { REQUESTED: 1, QUEUED: 2, PROCESSING: 3, SUCCEEDED: 4 }[r.status as 'REQUESTED'] ?? 0;
  const auto = r.source !== 'REQUEST'; // event cancelled / late payment: no approval step
  const steps = [
    ...(auto ? [] : [{ label: 'Requested', at: r.createdAt }, { label: 'Approved by finance', at: r.decidedAt }]),
    { label: 'Refund sent to the gateway', at: null },
    { label: `${rupees(r.amountPaise)} back to your account`, at: null },
  ];
  const done = auto ? stage - 2 : stage;
  return (
    <ol className="mt-4 space-y-3">
      {steps.map((s, i) => {
        const state = i < done ? 'done' : i === done ? 'now' : 'next';
        return (
          <li key={s.label} className="flex items-start gap-3">
            <span
              className={cx(
                'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full',
                state === 'done' ? 'bg-emerald-500 text-white' : state === 'now' ? 'bg-indigo-500/20 ring-2 ring-indigo-500' : 'bg-surface-2 ring-1 ring-line',
              )}
            >
              {state === 'done' && <CheckIcon className="size-3" />}
            </span>
            <span className={cx('text-sm', state === 'next' ? 'text-subtle' : 'font-medium text-fg')}>
              {s.label}
              {s.at && state === 'done' && <span className="block text-xs font-normal text-muted">{fmtDateTime(s.at)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Refunds on the registration page: the tracker when there is one, otherwise (paid, leader,
 * before the event) a "Request a refund" button with a short reason.
 */
export function RefundPanel({ reg, onChanged }: { reg: Registration; onChanged: () => void }) {
  const { data } = useQuery('my:refunds', refundApi.mine, { staleMs: 15_000 });
  const refund = data?.items.find((x) => x.registrationCode === reg.code && ACTIVE.includes(x.status)) ?? data?.items.find((x) => x.registrationCode === reg.code);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAsk =
    reg.role === 'LEADER' && reg.status === 'CONFIRMED' && reg.payment.status === 'PAID' && Date.parse(reg.startsAt) > Date.now() && (!refund || refund.status === 'REJECTED');

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await refundApi.request(reg.code, reason.trim());
      invalidate('my:refunds');
      onChanged();
      setOpen(false);
      toast.success('Refund requested. Finance will review it.');
    } catch (e) {
      setError(e instanceof ApiError ? (e.details?.fields?.reason ?? e.message) : 'Could not send the request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {refund && refund.status !== 'REJECTED' && (
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="font-bold text-fg">Refund</h2>
          {refund.status === 'MANUAL_PENDING' ? (
            <p className="mt-2 text-sm text-fg-2">You paid in cash: collect {rupees(refund.amountPaise)} at the registration desk.</p>
          ) : refund.status === 'MANUAL_DONE' ? (
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="size-4" /> {rupees(refund.amountPaise)} handed back
            </p>
          ) : refund.status === 'FAILED' ? (
            <div className="mt-3">
              <Alert>The refund didn't go through ({refund.failure ?? 'gateway error'}). The organisers will retry; no action needed from you.</Alert>
            </div>
          ) : (
            <>
              {refund.source === 'EVENT_CANCELLED' && <p className="mt-1 text-sm text-muted">The event was cancelled, so your money is coming back automatically.</p>}
              <Timeline r={refund} />
              {refund.status === 'SUCCEEDED' && <p className="mt-3 text-xs text-muted">Banks usually show refunds within 5–7 working days.</p>}
            </>
          )}
        </section>
      )}
      {refund?.status === 'REJECTED' && (
        <Alert tone="info">
          Your refund request was declined{refund.note ? `: ${refund.note}` : '.'}
        </Alert>
      )}
      {canAsk && (
        <div className="text-center">
          <Button variant="ghost" block={false} onClick={() => { setReason(''); setError(null); setOpen(true); }}>
            <AlertIcon className="size-4" /> Request a refund
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onClose={busy ? () => {} : () => setOpen(false)}
        title="Request a refund"
        description={`If finance approves it, your team's place is released and ${rupees(reg.payment.amountPaise)} goes back to the account you paid from. Requests close shortly before the event.`}
        footer={
          <>
            <Button variant="secondary" size="sm" block={false} onClick={() => setOpen(false)} disabled={busy}>
              Keep my place
            </Button>
            <Button size="sm" block={false} onClick={submit} loading={busy} disabled={reason.trim().length < 5}>
              Send request
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <TextareaField label="Reason" rows={3} maxLength={300} placeholder="e.g. My exam was moved to the same day" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Dialog>
    </>
  );
}
