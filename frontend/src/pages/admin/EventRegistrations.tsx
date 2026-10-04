import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { DataList, EmptyState, StatTile, type Column } from '@/components/data';
import { XIcon } from '@/components/event-icons';
import { CalendarIcon, ScanIcon, SearchIcon, TicketIcon, UsersIcon, WalletIcon } from '@/components/icons';
import { Badge, Card, PageHeader, Tabs, type Tone } from '@/components/layout';
import { Dialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, TextareaField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { adminPayApi, adminRegApi, eventApi, reportApi, rupees, type AdminRegistration, type AdminRegistrationPage, type RegistrationStatus } from '@/lib/ems-api';
import { fmtDateTime, fmtWhen, timeAgo } from '@/lib/format';
import { can, canOnEvent } from '@/lib/permissions';
import { invalidate, useQuery } from '@/lib/query';
import { useDebounced } from '@/lib/use-debounced';
import { useAuth } from '@/store/auth';

const STATUS: Record<RegistrationStatus, { label: string; tone: Tone }> = {
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  PAYMENT_PENDING: { label: 'Pending payment', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  EXPIRED: { label: 'Hold expired', tone: 'neutral' },
};

function paymentText(r: AdminRegistration) {
  switch (r.payment.status) {
    case 'NOT_REQUIRED':
      return 'Free';
    case 'DUE':
      return `${rupees(r.payment.amountPaise)} at desk`;
    case 'PENDING':
      return `${rupees(r.payment.amountPaise)} online, unpaid`;
    default:
      return `${rupees(r.payment.amountPaise)} paid`;
  }
}

const columns: Column<AdminRegistration>[] = [
  {
    key: 'who',
    header: 'Registration',
    primary: true,
    render: (r) => {
      const leader = r.members.find((m) => m.leader) ?? r.members[0];
      return (
        <span className="block min-w-0 max-w-[18rem]">
          <span className="block truncate font-semibold text-fg">{r.teamName ?? leader.name}</span>
          <span className="block truncate text-xs text-muted">
            <span className="font-mono">{r.code}</span> · {leader.email}
          </span>
        </span>
      );
    },
  },
  { key: 'size', header: 'People', render: (r) => <span className="tabular-nums text-fg-2">{r.members.length}</span> },
  { key: 'pay', header: 'Entry', hideOnMobile: true, render: (r) => <span className="whitespace-nowrap text-fg-2">{paymentText(r)}</span> },
  { key: 'at', header: 'Registered', hideOnMobile: true, render: (r) => <span className="whitespace-nowrap text-muted">{timeAgo(r.createdAt)}</span> },
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

type Tab = RegistrationStatus | 'ALL';

/** Organiser view of one event's registrations: counts, status tabs, search by code/email, cancel with a reason. */
export default function EventRegistrations() {
  const { festId, eventId } = useParams<{ festId: string; eventId: string }>();
  const user = useAuth((s) => s.user);
  const { data: e } = useQuery(`admin:event:${eventId}`, () => eventApi.get(eventId));
  const [tab, setTab] = useState<Tab>('ALL');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const [pages, setPages] = useState<AdminRegistrationPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AdminRegistration | null>(null);
  const [summary, setSummary] = useState<AdminRegistrationPage | null>(null);
  const [reload, setReload] = useState(0);

  // First page (and the counts) whenever the tab or search changes; more pages on demand.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    adminRegApi
      .list(eventId, { status: tab === 'ALL' ? undefined : tab, q: q || undefined })
      .then((p) => {
        if (!live) return;
        setPages([p]);
        if (p.counts) setSummary(p);
      })
      .catch((err) => live && setError(err instanceof ApiError ? err.message : "Couldn't load registrations"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [eventId, tab, q, reload]);

  const rows = pages.flatMap((p) => p.items);
  const next = pages[pages.length - 1]?.nextCursor;
  const loadMore = async () => {
    if (!next) return;
    const p = await adminRegApi.list(eventId, { status: tab === 'ALL' ? undefined : tab, q: q || undefined, cursor: next });
    setPages((x) => [...x, p]);
  };

  const counts = summary?.counts ?? {};
  const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
  const canCancel = !!e && canOnEvent(user, 'registration.manage', festId, e.department?.id ?? null);
  const canCollect = !!e && canOnEvent(user, 'order.collect_offline', festId, e.department?.id ?? null);
  const seats = summary?.seats;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/admin/events/${festId}/local/${eventId}`, label: e?.name ?? 'Event' }}
        title="Registrations"
        description={e ? `${e.name} · ${fmtWhen(e.startsAt, e.endsAt)}` : undefined}
        actions={
          e && (
            <>
              {can(user, 'report.read') && (
                <Button
                  size="sm"
                  block={false}
                  variant="secondary"
                  onClick={() => reportApi.exportRegistrations(festId, eventId).catch((err) => toast.error(err instanceof ApiError ? err.message : 'Export failed'))}
                >
                  Export CSV
                </Button>
              )}
              {canOnEvent(user, 'checkin.scan', festId, e.department?.id ?? null) && e.status !== 'DRAFT' && (
                <Link href={`/scan/${eventId}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500">
                  <ScanIcon className="size-4" /> Check-in
                </Link>
              )}
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Confirmed" value={counts.CONFIRMED ?? 0} icon={TicketIcon} tint="success" loading={!summary} />
        <StatTile label="Pending payment" value={counts.PAYMENT_PENDING ?? 0} icon={WalletIcon} tint="warning" loading={!summary} />
        <StatTile label="People" value={summary?.people ?? 0} icon={UsersIcon} tint="brand" loading={!summary} />
        <StatTile label="Seats taken" value={seats ? `${seats.confirmed + seats.held}${seats.total != null ? ` / ${seats.total}` : ''}` : '–'} icon={CalendarIcon} tint="info" loading={!summary} />
      </div>

      <Card padded={false}>
        <div className="space-y-3 px-4 pt-4 sm:px-5">
          <Tabs<Tab>
            label="Status"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'ALL', label: 'All', count: total },
              { value: 'CONFIRMED', label: 'Confirmed', count: counts.CONFIRMED ?? 0 },
              { value: 'PAYMENT_PENDING', label: 'Pending', count: counts.PAYMENT_PENDING ?? 0 },
              { value: 'CANCELLED', label: 'Cancelled', count: counts.CANCELLED ?? 0 },
              { value: 'EXPIRED', label: 'Expired', count: counts.EXPIRED ?? 0 },
            ]}
          />
          <div className="pb-3">
            <label className="relative block sm:max-w-sm">
              <span className="sr-only">Search by code or email</span>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <input
                type="search"
                value={text}
                onChange={(ev) => setText(ev.target.value)}
                placeholder="Registration code (REG-…) or exact email"
                className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-sm text-fg placeholder:text-subtle focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
              />
              {text && (
                <button type="button" onClick={() => setText('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-subtle hover:text-fg">
                  <XIcon className="size-4" />
                </button>
              )}
            </label>
          </div>
        </div>
        {error ? (
          <div className="p-5">
            <Alert>{error}</Alert>
          </div>
        ) : (
          <DataList
            columns={columns}
            rows={rows}
            rowKey={(r) => r.code}
            onRowClick={setOpen}
            loading={loading}
            empty={
              <EmptyState
                icon={TicketIcon}
                title={q ? 'No match' : tab === 'ALL' ? 'No registrations yet' : `No ${STATUS[tab].label.toLowerCase()} registrations`}
                description={pages[0]?.hint ?? (q ? 'Search by the full registration code or an exact email address.' : undefined)}
              />
            }
          />
        )}
        {next && !loading && (
          <div className="border-t border-line p-3 text-center">
            <Button size="sm" variant="ghost" block={false} onClick={loadMore}>
              Load more
            </Button>
          </div>
        )}
      </Card>

      <RegistrationDialog
        r={open}
        canCancel={canCancel}
        canCollect={canCollect}
        onClose={() => setOpen(null)}
        onCancelled={() => {
          setOpen(null);
          setReload((n) => n + 1);
          invalidate(`admin:events:${festId}`);
        }}
      />
    </div>
  );
}

function RegistrationDialog({ r, canCancel, canCollect, onClose, onCancelled }: { r: AdminRegistration | null; canCancel: boolean; canCollect: boolean; onClose: () => void; onCancelled: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setCancelling(false);
    setCollecting(false);
    setReason('');
    setErr(null);
  }, [r]);
  if (!r) return null;
  const active = r.status === 'CONFIRMED' || r.status === 'PAYMENT_PENDING';

  /** Cash/UPI taken at the desk: the exact amount due, recorded once. */
  async function collect() {
    setBusy(true);
    setErr(null);
    try {
      await adminPayApi.collect(r!.code, r!.payment.amountPaise);
      toast.success(`${rupees(r!.payment.amountPaise)} received for ${r!.code}`);
      onCancelled();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not record the payment');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setErr(null);
    try {
      await adminRegApi.cancel(r!.code, reason.trim());
      toast.success(`${r!.code} cancelled`);
      onCancelled();
    } catch (e) {
      setErr(e instanceof ApiError ? (e.details?.fields?.reason ?? e.message) : 'Could not cancel');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{r.code}</span>
          <Badge tone={STATUS[r.status].tone} dot>
            {STATUS[r.status].label}
          </Badge>
        </span>
      }
      description={`${r.teamName ? `Team ${r.teamName} · ` : ''}${paymentText(r)} · registered ${fmtDateTime(r.createdAt)}`}
      footer={
        collecting ? (
          <>
            <Button variant="secondary" size="sm" block={false} onClick={() => setCollecting(false)} disabled={busy}>
              Back
            </Button>
            <Button size="sm" block={false} onClick={collect} loading={busy}>
              Yes, {rupees(r.payment.amountPaise)} received
            </Button>
          </>
        ) : cancelling ? (
          <>
            <Button variant="secondary" size="sm" block={false} onClick={() => setCancelling(false)} disabled={busy}>
              Back
            </Button>
            <Button variant="danger" size="sm" block={false} onClick={cancel} loading={busy} disabled={reason.trim().length < 3}>
              Cancel registration
            </Button>
          </>
        ) : (
          <>
            {canCollect && r.status === 'CONFIRMED' && r.payment.status === 'DUE' && (
              <Button variant="secondary" size="sm" block={false} onClick={() => setCollecting(true)}>
                Collect {rupees(r.payment.amountPaise)}
              </Button>
            )}
            {canCancel && active && r.payment.status !== 'PAID' && (
              <Button variant="secondary" size="sm" block={false} className="text-red-600 dark:text-red-400" onClick={() => setCancelling(true)}>
                Cancel registration…
              </Button>
            )}
            <Button size="sm" block={false} onClick={onClose}>
              Close
            </Button>
          </>
        )
      }
    >
      {collecting ? (
        <div className="space-y-3">
          {err && <Alert>{err}</Alert>}
          <p className="text-sm text-fg-2">
            Did you receive <span className="font-bold text-fg">{rupees(r.payment.amountPaise)}</span> (cash or UPI) for <span className="font-mono">{r.code}</span>? It is recorded under your name.
          </p>
        </div>
      ) : cancelling ? (
        <div className="space-y-3">
          {err && <Alert>{err}</Alert>}
          <p className="text-sm text-muted">The seat is released and everyone in the team gets an email with your reason.</p>
          <TextareaField label="Reason" rows={3} maxLength={300} placeholder="e.g. Duplicate entry, team asked to withdraw" value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </div>
      ) : (
        <>
          {r.cancelReason && (
            <div className="mb-3">
              <Alert tone="info">Cancelled: {r.cancelReason}</Alert>
            </div>
          )}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {r.members.map((m) => (
              <li key={m.email} className="px-3.5 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                  {m.name}
                  {m.leader && r.members.length > 1 && <Badge tone="brand">Leader</Badge>}
                </p>
                <p className="mt-0.5 break-all text-xs text-muted">
                  {m.email}
                  {m.phone && (
                    <>
                      {' · '}
                      <a href={`tel:+91${m.phone}`} className="font-medium text-indigo-600 dark:text-indigo-300">
                        {m.phone}
                      </a>
                    </>
                  )}
                  {m.college && ` · ${m.college}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
