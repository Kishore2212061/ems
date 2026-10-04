import { useEffect, useState } from 'react';
import { DataList, EmptyState, StatTile, type Column } from '@/components/data';
import { CardIcon } from '@/components/event-icons';
import { AlertIcon, TicketIcon, WalletIcon } from '@/components/icons';
import { Badge, Card, PageHeader } from '@/components/layout';
import { toast } from '@/components/toast';
import { Alert, Button, Field, SelectField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { adminPayApi, festApi, payApi, rupees, type OrderPage, type OrderView } from '@/lib/ems-api';
import { calculateBreakdown, type FeeSettings } from '@/lib/fees';
import { fmtDateTime } from '@/lib/format';
import { can } from '@/lib/permissions';
import { setQueryData, useQuery } from '@/lib/query';
import { useAuth } from '@/store/auth';

const columns: Column<OrderView & { eventName?: string | null }>[] = [
  {
    key: 'who',
    header: 'Order',
    primary: true,
    render: (o) => (
      <span className="block min-w-0 max-w-[18rem]">
        <span className="block truncate font-semibold text-fg">{o.eventName ?? 'Event'}</span>
        <span className="block truncate font-mono text-xs text-muted">
          {o.code} · {o.registrationCode}
        </span>
      </span>
    ),
  },
  { key: 'mode', header: 'Via', render: (o) => <span className="whitespace-nowrap text-fg-2">{o.mode === 'ONLINE' ? 'Online' : 'Desk'}</span> },
  { key: 'amount', header: 'Amount', render: (o) => <span className="whitespace-nowrap font-semibold tabular-nums text-fg">{rupees(o.amountPaise)}</span> },
  { key: 'when', header: 'Paid', hideOnMobile: true, render: (o) => <span className="whitespace-nowrap text-muted">{o.paidAt ? fmtDateTime(o.paidAt) : '—'}</span> },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    render: (o) =>
      o.refundStatus !== 'NONE' ? (
        <Badge tone={o.refundStatus === 'DONE' ? 'info' : 'warning'} dot>
          {o.refundStatus === 'DONE' ? 'Refunded' : 'Refund pending'}
        </Badge>
      ) : (
        <Badge tone={o.status === 'PAID' ? 'success' : 'neutral'} dot>
          {o.status === 'PAID' ? 'Paid' : 'Started'}
        </Badge>
      ),
  },
];

/** Fee settings (Super Admin): what participants pay on top of the entry fee. */
function FeesCard() {
  const { data } = useQuery('public:fees', payApi.fees, { staleMs: 60_000 });
  const [f, setF] = useState({ pct: '0', flat: '0', gst: '0', bearer: 'PARTICIPANT' as FeeSettings['feeBearer'] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data) setF({ pct: String(data.platformFeeBps / 100), flat: String(data.platformFeeFlatPaise / 100), gst: String(data.gstBps / 100), bearer: data.feeBearer });
  }, [data]);

  const settings: FeeSettings = {
    platformFeeBps: Math.round(Number(f.pct) * 100) || 0,
    platformFeeFlatPaise: Math.round(Number(f.flat) * 100) || 0,
    gstBps: Math.round(Number(f.gst) * 100) || 0,
    feeBearer: f.bearer,
  };
  const example = calculateBreakdown(10_000, true, settings);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await adminPayApi.setFees(settings);
      setQueryData('public:fees', saved);
      toast.success('Fee settings saved. New registrations use them.');
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.details?.fields ?? {})[0] ?? e.message) : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Fees & GST" description="Applied to new registrations. Existing ones keep the price they registered with.">
      <div className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Platform fee (online)" type="number" inputMode="decimal" min={0} max={10} step="0.1" trailing={<span className="pr-2 text-sm text-muted">%</span>} value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} />
          <Field label="Flat fee (online)" type="number" inputMode="decimal" min={0} max={1000} prefix="₹" value={f.flat} onChange={(e) => setF({ ...f, flat: e.target.value })} />
          <Field label="GST" type="number" inputMode="decimal" min={0} max={28} step="0.5" trailing={<span className="pr-2 text-sm text-muted">%</span>} value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })} />
        </div>
        <SelectField label="Who pays fees and GST?" className="sm:max-w-sm" value={f.bearer} onChange={(e) => setF({ ...f, bearer: e.target.value as FeeSettings['feeBearer'] })}>
          <option value="PARTICIPANT">Participant (added on top)</option>
          <option value="ORGANIZER">College (participant pays the listed price)</option>
        </SelectField>
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-fg-2">
          Example: a ₹100 entry paid online costs the participant <span className="font-bold text-fg">{rupees(example.totalPaise)}</span>
          {example.platformFeePaise > 0 && ` (fee ${rupees(example.platformFeePaise)}`}
          {example.gstPaise > 0 && `${example.platformFeePaise > 0 ? ', ' : ' ('}GST ${rupees(example.gstPaise)}`}
          {(example.platformFeePaise > 0 || example.gstPaise > 0) && ')'}. Desk payments carry no platform fee.
        </p>
        <Button block={false} onClick={save} loading={busy}>
          Save fee settings
        </Button>
      </div>
    </Card>
  );
}

/** Money in for a fest: totals (online vs desk), refunds to watch, every order. */
export default function Payments() {
  const user = useAuth((s) => s.user);
  const fests = useQuery('admin:fests:all', () => festApi.list());
  const [festId, setFestId] = useState('');
  const [pages, setPages] = useState<OrderPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSee = can(user, 'order.read');

  const list = fests.data?.items ?? [];
  useEffect(() => {
    if (!festId && list.length) setFestId((list.find((f) => f.status === 'PUBLISHED') ?? list[0]).id);
  }, [festId, list]);

  useEffect(() => {
    if (!festId || !canSee) return;
    let live = true;
    setLoading(true);
    setError(null);
    adminPayApi
      .orders({ festId })
      .then((p) => live && setPages([p]))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Couldn't load payments"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [festId, canSee]);

  const rows = pages.flatMap((p) => p.items);
  const totals = pages[0]?.totals;
  const next = pages[pages.length - 1]?.nextCursor;

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" description="Online and desk payments by fest, refunds, and fee settings." />

      {canSee && (
        <>
          <SelectField label="Fest" className="sm:max-w-sm" value={festId} onChange={(e) => setFestId(e.target.value)}>
            {list.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </SelectField>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile label="Collected" value={totals ? rupees(totals.onlinePaise + totals.deskPaise) : '–'} icon={WalletIcon} tint="success" loading={loading && !totals} />
            <StatTile label={`Online · ${totals?.onlineCount ?? 0}`} value={totals ? rupees(totals.onlinePaise) : '–'} icon={CardIcon} tint="brand" loading={loading && !totals} />
            <StatTile label={`At the desk · ${totals?.deskCount ?? 0}`} value={totals ? rupees(totals.deskPaise) : '–'} icon={TicketIcon} tint="info" loading={loading && !totals} />
            <StatTile label="Refunds" value={totals?.refunds ?? 0} icon={AlertIcon} tint="warning" loading={loading && !totals} />
          </div>

          <Card padded={false} title="Orders">
            {error ? (
              <div className="p-5">
                <Alert>{error}</Alert>
              </div>
            ) : (
              <DataList columns={columns} rows={rows} rowKey={(o) => o.code} loading={loading} empty={<EmptyState icon={WalletIcon} title="No payments yet" description="Online payments and desk collections for this fest appear here." />} />
            )}
            {next && !loading && (
              <div className="border-t border-line p-3 text-center">
                <Button
                  size="sm"
                  variant="ghost"
                  block={false}
                  onClick={async () => {
                    const p = await adminPayApi.orders({ festId, cursor: next });
                    setPages((x) => [...x, p]);
                  }}
                >
                  Load more
                </Button>
              </div>
            )}
          </Card>
        </>
      )}

      {can(user, 'settings.manage') && <FeesCard />}
    </div>
  );
}
