import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { DataList, EmptyState } from '@/components/data';
import { CalendarIcon, PlusIcon } from '@/components/icons';
import { Badge, Card, PageHeader, Tabs } from '@/components/layout';
import { Alert } from '@/components/ui';
import { festApi, FEST_STATUS_LABEL, FEST_STATUS_TONE, FEST_TYPE_LABEL, type FestStatus } from '@/lib/ems-api';
import { fmtRange } from '@/lib/format';
import { can } from '@/lib/permissions';
import { useQuery } from '@/lib/query';
import { useAuth } from '@/store/auth';

type Filter = 'ALL' | FestStatus;

export default function Fests() {
  const user = useAuth((s) => s.user);
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Filter>('ALL');
  const { data, loading, error, refetch } = useQuery('admin:fests:all', () => festApi.list());
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const rows = (data?.items ?? []).filter((f) => tab === 'ALL' || f.status === tab);

  return (
    <>
      <PageHeader
        title="Fests"
        description="Each edition of each fest. Several can be live at the same time."
        actions={
          can(user, 'global_event.create') && (
            <Link href="/admin/events/new" className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
              <PlusIcon className="size-4" /> New fest
            </Link>
          )
        }
      />
      {error && (
        <div className="mb-4">
          <Alert>
            Couldn&apos;t load fests.{' '}
            <button type="button" className="font-semibold underline" onClick={refetch}>
              Retry
            </button>
          </Alert>
        </div>
      )}
      <Card padded={false}>
        <div className="px-5 pt-2 sm:px-6">
          <Tabs<Filter>
            label="Filter by status"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'ALL', label: 'All', count: total },
              { value: 'PUBLISHED', label: 'Live', count: counts.PUBLISHED ?? 0 },
              { value: 'DRAFT', label: 'Drafts', count: counts.DRAFT ?? 0 },
              { value: 'SUSPENDED', label: 'Suspended', count: counts.SUSPENDED ?? 0 },
              { value: 'COMPLETED', label: 'Completed', count: counts.COMPLETED ?? 0 },
            ]}
          />
        </div>
        <DataList
          loading={loading}
          rows={rows}
          rowKey={(f) => f.id}
          onRowClick={(f) => navigate(`/admin/events/${f.id}`)}
          empty={<EmptyState compact icon={CalendarIcon} title={tab === 'ALL' ? 'No fests yet' : 'Nothing here'} description={tab === 'ALL' ? 'Create the first edition to get started.' : 'No fests with this status.'} />}
          columns={[
            {
              key: 'name',
              header: 'Fest',
              primary: true,
              render: (f) => (
                <span>
                  {f.name}
                  <span className="block text-xs font-normal text-subtle">/{f.slug}</span>
                </span>
              ),
            },
            { key: 'type', header: 'Type', render: (f) => FEST_TYPE_LABEL[f.type], hideOnMobile: true },
            { key: 'dates', header: 'Dates', render: (f) => fmtRange(f.startsAt, f.endsAt) },
            { key: 'depts', header: 'Departments', render: (f) => f.departments.length, align: 'right' },
            { key: 'status', header: 'Status', render: (f) => <Badge tone={FEST_STATUS_TONE[f.status]} dot>{FEST_STATUS_LABEL[f.status]}</Badge> },
          ]}
        />
      </Card>
    </>
  );
}
