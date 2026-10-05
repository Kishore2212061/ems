import { useEffect, useState } from 'react';
import { DataList, EmptyState, type Column } from '@/components/data';
import { WalletIcon } from '@/components/icons';
import { Badge, Card, Tabs, type Tone } from '@/components/layout';
import { Dialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, TextareaField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { adminRefundApi, rupees, type RefundBatchView, type RefundStatus, type RefundView } from '@/lib/ems-api';
import { timeAgo } from '@/lib/format';

const STATUS: Record<RefundStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: 'Needs decision', tone: 'warning' },
  REJECTED: { label: 'Declined', tone: 'neutral' },
  QUEUED: { label: 'Queued', tone: 'info' },
  PROCESSING: { label: 'Processing', tone: 'info' },
  SUCCEEDED: { label: 'Refunded', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  MANUAL_PENDING: { label: 'Cash to hand back', tone: 'warning' },
  MANUAL_DONE: { label: 'Cash returned', tone: 'success' },
};
const SOURCE = { REQUEST: 'Requested', EVENT_CANCELLED: 'Event cancelled', LATE_PAYMENT: 'Late payment', DUPLICATE_PAYMENT: 'Paid twice' } as const;

type Tab = 'REQUESTED' | 'MANUAL_PENDING' | 'FAILED' | 'ALL';

const columns: Column<RefundView>[] = [
  {
    key: 'who',
    header: 'Refund',
    primary: true,
    render: (r) => (
      <span className="block min-w-0 max-w-[18rem]">
        <span className="block truncate font-semibold text-fg">{r.eventName ?? 'Event'}</span>
        <span className="block truncate text-xs text-muted">
          <span className="font-mono">{r.registrationCode}</span> · {SOURCE[r.source]}
        </span>
      </span>
    ),
  },
  { key: 'amount', header: 'Amount', render: (r) => <span className="whitespace-nowrap font-semibold tabular-nums text-fg">{rupees(r.amountPaise)}</span> },
  { key: 'when', header: 'Created', hideOnMobile: true, render: (r) => <span className="whitespace-nowrap text-muted">{timeAgo(r.createdAt)}</span> },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    render: (r) => (
      <Badge tone={STATUS[r.status].tone} dot>
        {STATUS[r.status].label}
      </Badge>
    ),
  },
];

function Batches({ festId, version, onChanged }: { festId: string; version: number; onChanged: () => void }) {
  const [items, setItems] = useState<RefundBatchView[]>([]);
  useEffect(() => {
    adminRefundApi.batches(festId).then((r) => setItems(r.items), () => setItems([]));
  }, [festId, version]);
  if (!items.length) return null;
  return (
    <Card title="Cancelled events" description="Automatic refunds for every paid entry of a cancelled event.">
      <ul className="space-y-4">
        {items.map((b) => {
          const done = b.succeeded + b.manual;
          const pct = b.total ? Math.round((done / b.total) * 100) : 100;
          return (
            <li key={b.id}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-semibold text-fg">{b.eventName}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {done}/{b.total}
                  {b.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {b.failed} failed</span>}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.eventName} refunds`}>
                <div className={b.status === 'PAUSED' ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'} style={{ width: `${pct}%` }} />
              </div>
              {(b.status === 'PAUSED' || b.failed > 0) && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className={b.status === 'PAUSED' ? 'text-amber-700 dark:text-amber-300' : 'text-red-600 dark:text-red-400'}>
                    {b.status === 'PAUSED' ? `Paused: ${b.pausedReason}` : 'Some refunds failed'}
                  </span>
                  <Button
                    size="sm"
                    block={false}
                    variant="secondary"
                    onClick={async () => {
                      const r = await adminRefundApi.resume(b.id);
                      toast.success(`${r.requeued} refund${r.requeued === 1 ? '' : 's'} queued again`);
                      onChanged();
                    }}
                  >
                    {b.status === 'PAUSED' ? 'Resume' : 'Retry failed'}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Finance: decide refund requests, hand back cash, watch cancelled-event batches. */
export function RefundsTab({ festId }: { festId: string }) {
  const [tab, setTab] = useState<Tab>('REQUESTED');
  const [rows, setRows] = useState<RefundView[]>([]);
  const [counts, setCounts] = useState<Partial<Record<RefundStatus, number>>>({});
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<RefundView | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    adminRefundApi
      .list({ festId, status: tab === 'ALL' ? undefined : tab })
      .then((p) => {
        if (!live) return;
        setRows(p.items);
        if (p.counts) setCounts(p.counts);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [festId, tab, version]);

  const refresh = () => setVersion((v) => v + 1);

  return (
    <div className="space-y-6">
      <Batches festId={festId} version={version} onChanged={refresh} />
      <Card padded={false}>
        <div className="px-4 pt-3 sm:px-5">
          <Tabs<Tab>
            label="Refund status"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'REQUESTED', label: 'To decide', count: counts.REQUESTED ?? 0 },
              { value: 'MANUAL_PENDING', label: 'Cash to return', count: counts.MANUAL_PENDING ?? 0 },
              { value: 'FAILED', label: 'Failed', count: counts.FAILED ?? 0 },
              { value: 'ALL', label: 'All' },
            ]}
          />
        </div>
        <DataList columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={setOpen} loading={loading} empty={<EmptyState icon={WalletIcon} title="Nothing here" description="Refund requests and cancelled-event refunds appear here." />} />
      </Card>
      <RefundDialog r={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />
    </div>
  );
}

function RefundDialog({ r, onClose, onDone }: { r: RefundView | null; onClose: () => void; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRejecting(false);
    setNote('');
    setError(null);
  }, [r]);
  if (!r) return null;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(msg);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.details?.fields ?? {})[0] ?? e.message) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={`${rupees(r.amountPaise)} · ${r.registrationCode}`}
      description={`${r.eventName ?? 'Event'} · ${SOURCE[r.source]} · paid ${r.mode === 'ONLINE' ? 'online' : 'in cash'}`}
      footer={
        r.status === 'REQUESTED' ? (
          rejecting ? (
            <>
              <Button size="sm" variant="secondary" block={false} onClick={() => setRejecting(false)} disabled={busy}>
                Back
              </Button>
              <Button size="sm" variant="danger" block={false} loading={busy} disabled={note.trim().length < 3} onClick={() => act(() => adminRefundApi.reject(r.id, note.trim()), 'Request declined')}>
                Decline request
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" block={false} onClick={() => setRejecting(true)}>
                Decline…
              </Button>
              <Button size="sm" block={false} loading={busy} onClick={() => act(() => adminRefundApi.approve(r.id), r.mode === 'ONLINE' ? 'Approved: refund on its way' : 'Approved: hand the cash back at the desk')}>
                Approve refund
              </Button>
            </>
          )
        ) : r.status === 'MANUAL_PENDING' ? (
          <Button size="sm" block={false} loading={busy} onClick={() => act(() => adminRefundApi.markPaid(r.id, note.trim() || undefined), 'Marked as handed back')}>
            Cash handed back
          </Button>
        ) : r.status === 'FAILED' && r.mode === 'ONLINE' ? (
          <Button size="sm" block={false} loading={busy} onClick={() => act(() => adminRefundApi.retry(r.id), 'Refund queued again')}>
            Try again
          </Button>
        ) : (
          <Button size="sm" block={false} onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        {r.reason && (
          <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-fg-2">
            <span className="block text-xs font-semibold uppercase tracking-wide text-subtle">Reason</span>
            {r.reason}
          </p>
        )}
        {r.failure && <Alert>Failed: {r.failure}</Alert>}
        {r.note && <p className="text-muted">Note: {r.note}</p>}
        {r.status === 'REQUESTED' && !rejecting && <p className="text-muted">Approving releases the team's place and voids their tickets.</p>}
        {(rejecting || r.status === 'MANUAL_PENDING') && (
          <TextareaField
            label={rejecting ? 'Why are you declining? (sent to the participant)' : 'Note (optional)'}
            rows={3}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </div>
    </Dialog>
  );
}
