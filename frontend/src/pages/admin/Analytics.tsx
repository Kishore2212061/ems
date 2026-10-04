import { useEffect, useMemo, useState } from 'react';
import { BarList, Sparkline } from '@/components/charts';
import { EmptyState, StatTile } from '@/components/data';
import { CalendarIcon, ScanIcon, TicketIcon, UsersIcon, WalletIcon } from '@/components/icons';
import { Card } from '@/components/layout';
import { toast } from '@/components/toast';
import { Button, SelectField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { reportApi, rupees, type FestSummary, type ReportTotals } from '@/lib/ems-api';
import { fmtDay } from '@/lib/format';
import { useQuery } from '@/lib/query';

type Live = Partial<Record<'registrations' | 'people' | 'cancellations' | 'checkins' | 'revenue_paise' | 'refunds_paise', number>>;

/**
 * Live counters: a short pass from the API opens an EventSource on the fest; ticks are added on
 * top of the last fetched totals. Reconnects (with a fresh pass) if the stream drops.
 */
function useLive(festId: string | null) {
  const [live, setLive] = useState<Live>({});
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    setLive({});
    if (!festId || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = async () => {
      try {
        const { pass } = await reportApi.livePass(festId);
        if (stopped) return;
        es = new EventSource(`/api/v1/live/fests/${festId}?pass=${encodeURIComponent(pass)}`);
        es.addEventListener('hello', () => setConnected(true));
        es.addEventListener('tick', (e) => {
          const inc = JSON.parse((e as MessageEvent).data) as Live;
          setLive((cur) => {
            const next = { ...cur };
            for (const [k, v] of Object.entries(inc)) next[k as keyof Live] = (next[k as keyof Live] ?? 0) + (v ?? 0);
            return next;
          });
        });
        es.onerror = () => {
          setConnected(false);
          es?.close();
          if (!stopped) retry = setTimeout(connect, 5000);
        };
      } catch {
        if (!stopped) retry = setTimeout(connect, 15_000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [festId]);
  return { live, connected };
}

const delta = (now: number, before: number | null | undefined) => {
  if (!before) return undefined;
  const pct = Math.round(((now - before) / before) * 100);
  return { value: `${pct >= 0 ? '+' : ''}${pct}% vs last edition`, positive: pct >= 0 };
};

/** Fest dashboard: KPIs (with last edition), registrations per day, departments, top events, colleges, CSV export. */
export function Analytics({ fests }: { fests: FestSummary[] }) {
  const [festId, setFestId] = useState('');
  useEffect(() => {
    if (!festId && fests.length) setFestId((fests.find((f) => f.status === 'PUBLISHED') ?? fests[0]).id);
  }, [festId, fests]);
  const ov = useQuery(festId ? `reports:overview:${festId}` : null, () => reportApi.overview(festId), { staleMs: 60_000 });
  const col = useQuery(festId ? `reports:colleges:${festId}` : null, () => reportApi.colleges(festId), { staleMs: 300_000 });
  const { live, connected } = useLive(festId || null);
  const [exporting, setExporting] = useState(false);

  const t = ov.data?.totals;
  const prev = ov.data?.previous?.totals;
  const now: ReportTotals | null = useMemo(
    () =>
      t ? {
        ...t,
        registrations: t.registrations + (live.registrations ?? 0),
        people: t.people + (live.people ?? 0),
        checkins: t.checkins + (live.checkins ?? 0),
        revenuePaise: t.revenuePaise === null ? null : t.revenuePaise + (live.revenue_paise ?? 0),
        netPaise: t.netPaise === null ? null : t.netPaise + (live.revenue_paise ?? 0) - (live.refunds_paise ?? 0),
      } : null,
    [t, live],
  );
  const daily = ov.data?.daily ?? [];

  if (!fests.length) return null;

  return (
    <section className="space-y-4 sm:space-y-6" aria-label="Fest analytics">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SelectField label="Fest" className="w-full sm:w-80" value={festId} onChange={(e) => setFestId(e.target.value)}>
          {fests.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </SelectField>
        <div className="flex items-center gap-3">
          <span className={connected ? 'inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400' : 'text-xs text-subtle'}>
            {connected && <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />}
            {connected ? 'Live' : 'Not live'}
          </span>
          <Button
            size="sm"
            block={false}
            variant="secondary"
            loading={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await reportApi.exportRegistrations(festId);
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : 'Export failed');
              } finally {
                setExporting(false);
              }
            }}
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Registrations" value={now?.registrations ?? 0} icon={TicketIcon} tint="brand" loading={!now} delta={now ? delta(now.registrations, prev?.registrations) : undefined} />
        <StatTile label="People" value={now?.people ?? 0} icon={UsersIcon} tint="info" loading={!now} delta={now ? delta(now.people, prev?.people) : undefined} />
        <StatTile label="Checked in" value={now ? `${now.checkins}/${now.people}` : 0} icon={ScanIcon} tint="success" loading={!now} />
        {now?.netPaise !== null ? (
          <StatTile label="Net revenue" value={now ? rupees(now.netPaise ?? 0) : '–'} icon={WalletIcon} tint="warning" loading={!now} delta={now && prev?.netPaise ? delta(now.netPaise ?? 0, prev.netPaise) : undefined} />
        ) : (
          <StatTile label="Cancellations" value={now?.cancellations ?? 0} icon={CalendarIcon} tint="warning" />
        )}
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <Card title="Registrations per day" className="lg:col-span-2">
          {daily.length ? (
            <>
              <Sparkline values={daily.map((d) => d.registrations)} label="Registrations per day" height={96} />
              <div className="mt-2 flex justify-between text-xs text-subtle">
                <span>{fmtDay(daily[0].day)}</span>
                <span>{fmtDay(daily[daily.length - 1].day)}</span>
              </div>
            </>
          ) : (
            <EmptyState compact icon={TicketIcon} title="No registrations yet" />
          )}
        </Card>
        <Card title="By department">
          {ov.data?.departments.length ? <BarList items={ov.data.departments.map((d) => ({ label: d.code, value: d.people, hint: `${d.registrations} reg.` }))} /> : <p className="text-sm text-muted">Nothing yet.</p>}
        </Card>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="Most popular events" description="People registered">
          {ov.data?.topEvents.length ? <BarList items={ov.data.topEvents.map((e) => ({ label: e.name, value: e.people, hint: `${e.checkins} in` }))} /> : <p className="text-sm text-muted">Nothing yet.</p>}
        </Card>
        <Card title="Top colleges" description="By team leader's college">
          {col.data?.items.length ? <BarList items={col.data.items.map((c) => ({ label: c.college, value: c.people }))} /> : <p className="text-sm text-muted">Nothing yet.</p>}
        </Card>
      </div>
      {ov.data?.previous && <p className="text-xs text-muted">Compared with {ov.data.previous.fest.name}.</p>}
    </section>
  );
}
