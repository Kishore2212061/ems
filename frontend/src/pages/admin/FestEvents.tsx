import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { DataList, EmptyState, type Column } from '@/components/data';
import { CATEGORY_ICON } from '@/components/event-icons';
import { PlusIcon, TicketIcon } from '@/components/icons';
import { Badge, Card } from '@/components/layout';
import { cx } from '@/components/ui';
import { CATEGORY_LABEL, EVENT_STATUS_LABEL, EVENT_STATUS_TONE, eventApi, priceLabel, type EventCard, type EventStatus, type FestDetail } from '@/lib/ems-api';
import { fmtWhen } from '@/lib/format';
import { eventDepartmentsFor } from '@/lib/permissions';
import { useQuery } from '@/lib/query';
import { useAuth } from '@/store/auth';

const STATUSES: EventStatus[] = ['DRAFT', 'PUBLISHED', 'SUSPENDED', 'COMPLETED', 'CANCELLED'];

type Row = EventCard & { taken: number };

const columns: Column<Row>[] = [
  {
    key: 'name',
    header: 'Event',
    primary: true,
    render: (e) => {
      const I = CATEGORY_ICON[e.category];
      return (
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
            <I className="size-4" />
          </span>
          {/* Capped width: in an auto-layout table one long name would otherwise stretch the column. */}
          <span className="min-w-0 max-w-[16rem] lg:max-w-[20rem]">
            <span className="block truncate font-semibold text-fg" title={e.name}>{e.name}</span>
            <span className="block truncate text-xs text-muted">
              {CATEGORY_LABEL[e.category]} · {e.department?.code ?? 'Fest-wide'}
            </span>
          </span>
        </span>
      );
    },
  },
  { key: 'when', header: 'When', render: (e) => <span className="whitespace-nowrap text-fg-2">{e.startsAt ? fmtWhen(e.startsAt, null) : 'Not scheduled'}</span> },
  {
    key: 'seats',
    header: 'Registered',
    hideOnMobile: true,
    render: (e) => <span className="whitespace-nowrap tabular-nums text-fg-2">{e.seatsTotal == null ? e.taken : `${e.taken} / ${e.seatsTotal}`}</span>,
  },
  { key: 'price', header: 'Entry', hideOnMobile: true, render: (e) => <span className="whitespace-nowrap text-fg-2">{priceLabel(e.pricing, e.participation)}</span> },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    render: (e) => (
      <Badge tone={EVENT_STATUS_TONE[e.status]} dot>
        {EVENT_STATUS_LABEL[e.status]}
      </Badge>
    ),
  },
];

/** "Events" tab of a fest: every department event the user can see, filterable by status and department. */
export function FestEvents({ fest }: { fest: FestDetail }) {
  const user = useAuth((s) => s.user);
  const [, navigate] = useLocation();
  const { data, loading, error } = useQuery(`admin:events:${fest.id}`, () => eventApi.list(fest.id));
  const [status, setStatus] = useState<EventStatus | ''>('');
  const [dept, setDept] = useState('');

  const closed = fest.status === 'COMPLETED' || fest.status === 'CANCELLED';
  const canCreate = !closed && eventDepartmentsFor(user, fest.id, fest.departments.map((d) => d.id)).length > 0;
  const all = data?.items ?? [];
  const rows = all.filter((e) => (!status || e.status === status) && (!dept || (e.department?.code ?? '-') === dept));
  const depts = [...new Set(all.map((e) => e.department?.code ?? '-'))];
  const newHref = `/admin/events/${fest.id}/local/new`;

  const chip = (on: boolean) =>
    cx('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors', on ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'border-line text-muted hover:text-fg');

  return (
    <Card
      padded={false}
      title="Events"
      description={closed ? 'This fest is closed; its events are read-only.' : 'Competitions and workshops run by the departments.'}
      actions={
        canCreate && (
          <Link href={newHref} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
            <PlusIcon className="size-4" /> New event
          </Link>
        )
      }
    >
      {all.length > 0 && (
        <div className="space-y-2 border-b border-line px-5 py-3 sm:px-6">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none]" role="group" aria-label="Status">
            <button type="button" aria-pressed={!status} className={chip(!status)} onClick={() => setStatus('')}>
              All <span className="tabular-nums opacity-70">{all.length}</span>
            </button>
            {STATUSES.filter((s) => data?.counts[s]).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} className={chip(status === s)} onClick={() => setStatus(status === s ? '' : s)}>
                {EVENT_STATUS_LABEL[s]} <span className="tabular-nums opacity-70">{data?.counts[s]}</span>
              </button>
            ))}
          </div>
          {depts.length > 1 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none]" role="group" aria-label="Department">
              <button type="button" aria-pressed={!dept} className={chip(!dept)} onClick={() => setDept('')}>
                All departments
              </button>
              {depts.map((d) => (
                <button key={d} type="button" aria-pressed={dept === d} className={chip(dept === d)} onClick={() => setDept(dept === d ? '' : d)}>
                  {d === '-' ? 'Fest-wide' : d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error ? (
        <EmptyState compact title="Couldn't load events" description={error.message} />
      ) : (
        <DataList
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          loading={loading}
          onRowClick={(e) => navigate(`/admin/events/${fest.id}/local/${e.id}`)}
          empty={
            <EmptyState
              compact
              icon={TicketIcon}
              title={all.length ? 'Nothing matches these filters' : 'No events yet'}
              description={all.length ? undefined : canCreate ? 'Add the first competition or workshop for this fest.' : 'Departments add their events here.'}
              action={
                !all.length &&
                canCreate && (
                  <Link href={newHref} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                    Create an event
                  </Link>
                )
              }
            />
          }
        />
      )}
    </Card>
  );
}
