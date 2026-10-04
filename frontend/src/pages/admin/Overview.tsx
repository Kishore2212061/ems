import { Link, useLocation } from 'wouter';
import { DataList, EmptyState, StatTile } from '@/components/data';
import { BuildingIcon, CalendarIcon, MailIcon, PlusIcon, SparkIcon } from '@/components/icons';
import { Badge, Card, PageHeader } from '@/components/layout';
import { deptApi, festApi, inviteApi, FEST_STATUS_LABEL, FEST_STATUS_TONE } from '@/lib/ems-api';
import { fmtRange } from '@/lib/format';
import { can } from '@/lib/permissions';
import { useQuery } from '@/lib/query';
import { useAuth } from '@/store/auth';
import { Analytics } from './Analytics';

export default function Overview() {
  const user = useAuth((s) => s.user)!;
  const [, navigate] = useLocation();
  const canInvite = can(user, 'user.invite');
  const fests = useQuery('admin:fests:all', () => festApi.list());
  const depts = useQuery('admin:departments', deptApi.listAll);
  const invites = useQuery(canInvite ? 'admin:invites:PENDING' : null, () => inviteApi.list('PENDING'));
  const counts = fests.data?.counts ?? {};

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.fullName.split(' ')[0]}`}
        description="Run every fest from here: editions, departments and your team."
        actions={
          can(user, 'global_event.create') && (
            <Link href="/admin/events/new" className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
              <PlusIcon className="size-4" /> New fest
            </Link>
          )
        }
      />

      {can(user, 'report.read') && (
        <div className="mb-8">
          <Analytics fests={fests.data?.items ?? []} />
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Live fests" value={counts.PUBLISHED ?? 0} icon={SparkIcon} tint="success" loading={fests.loading} />
        <StatTile label="Drafts" value={counts.DRAFT ?? 0} icon={CalendarIcon} loading={fests.loading} />
        <StatTile label="Departments" value={depts.data?.filter((d) => d.active).length ?? 0} icon={BuildingIcon} tint="info" loading={depts.loading} />
        {canInvite && <StatTile label="Pending invites" value={invites.data?.length ?? 0} icon={MailIcon} tint="warning" loading={invites.loading} />}
      </section>

      <Card className="mt-6" title="Fests" description="Most recent first." padded={false} actions={<Link href="/admin/events" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">View all</Link>}>
        <DataList
          loading={fests.loading}
          rows={(fests.data?.items ?? []).slice(0, 5)}
          rowKey={(f) => f.id}
          onRowClick={(f) => navigate(`/admin/events/${f.id}`)}
          skeletonRows={3}
          empty={<EmptyState compact icon={CalendarIcon} title="No fests yet" description="Create your first edition to get started." />}
          columns={[
            { key: 'name', header: 'Fest', primary: true, render: (f) => f.name },
            { key: 'dates', header: 'Dates', render: (f) => fmtRange(f.startsAt, f.endsAt) },
            { key: 'status', header: 'Status', render: (f) => <Badge tone={FEST_STATUS_TONE[f.status]} dot>{FEST_STATUS_LABEL[f.status]}</Badge> },
          ]}
        />
      </Card>
    </>
  );
}
