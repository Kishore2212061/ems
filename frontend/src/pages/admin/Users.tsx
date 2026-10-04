import { useState } from 'react';
import { DataList, EmptyState } from '@/components/data';
import { SearchIcon, UsersIcon } from '@/components/icons';
import { Badge, Card, PageHeader } from '@/components/layout';
import { ConfirmDialog, Dialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, SelectField } from '@/components/ui';
import { userApi, type AdminUser, type RoleGrant } from '@/lib/ems-api';
import { fmtDate, timeAgo } from '@/lib/format';
import { can } from '@/lib/permissions';
import { invalidate, setQueryData, useQuery } from '@/lib/query';
import { useSubmit } from '@/lib/use-submit';
import { ROLE_LABEL, roleTitle, useAuth, type Role, type UserRole } from '@/store/auth';
import { RolePicker } from './RolePicker';
import { useDebounced } from './shared';

const STAFF_ROLES: Role[] = ['ADMIN', 'FINANCE', 'SCANNER', 'SUPER_ADMIN'];
const STATUS_TONE = { ACTIVE: 'success', PENDING_VERIFICATION: 'warning', SUSPENDED: 'danger' } as const;
const STATUS_TEXT = { ACTIVE: 'Active', PENDING_VERIFICATION: 'Unverified', SUSPENDED: 'Suspended' };

function UserDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const me = useAuth((s) => s.user)!;
  const manage = can(me, 'user.manage');
  const key = `admin:user:${userId}`;
  const { data: u } = useQuery(userId ? key : null, () => userApi.get(userId!));
  const [grant, setGrant] = useState<RoleGrant>({ role: 'ADMIN', scopeType: 'ORG', scopeId: null });
  const [removing, setRemoving] = useState<UserRole | null>(null);
  const [suspending, setSuspending] = useState(false);
  const add = useSubmit();

  const update = (next: AdminUser) => {
    setQueryData(key, next);
    invalidate('admin:users');
  };

  return (
    <Dialog
      open={!!userId}
      onClose={onClose}
      size="lg"
      title={u?.fullName ?? 'Loading…'}
      description={u && <>{u.email} · joined {fmtDate(u.createdAt)}{u.lastLoginAt && <> · last seen {timeAgo(u.lastLoginAt)}</>}</>}
      footer={
        <>
          {manage && u && u.id !== me.id && (
            <Button size="sm" block={false} variant={u.status === 'SUSPENDED' ? 'secondary' : 'danger'} onClick={() => setSuspending(true)}>
              {u.status === 'SUSPENDED' ? 'Reactivate account' : 'Suspend account'}
            </Button>
          )}
          <Button size="sm" block={false} variant="secondary" onClick={onClose}>Close</Button>
        </>
      }
    >
      {u && (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-fg-2">Roles</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {u.roles.map((r) => (
                <li key={`${r.role}:${r.scopeId}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-semibold text-fg">{roleTitle(r)}</span>
                  {manage && r.role !== 'PARTICIPANT' && (
                    <button type="button" onClick={() => setRemoving(r)} className="text-sm font-semibold text-red-600 hover:text-red-500 dark:text-red-400">
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {manage && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-fg-2">Give a role</h3>
              {add.error && <div className="mb-3"><Alert>{add.error}</Alert></div>}
              <RolePicker value={grant} onChange={setGrant} roles={STAFF_ROLES} errors={add.fields} />
              <div className="mt-4 flex justify-end">
                <Button
                  size="sm"
                  block={false}
                  loading={add.loading}
                  disabled={grant.scopeType !== 'ORG' && !grant.scopeId}
                  onClick={async () => {
                    const r = await add.run(() => userApi.grant(u.id, grant));
                    if (r) {
                      update(r);
                      toast.success(`${ROLE_LABEL[grant.role]} role given to ${u.fullName}`);
                    }
                  }}
                >
                  Add role
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing ? roleTitle(removing) : ''}?`}
        message={`${u?.fullName} loses this access immediately and is signed out on every device.`}
        confirmLabel="Remove role"
        tone="danger"
        onConfirm={async () => {
          update(await userApi.revoke(u!.id, removing!));
          toast.success('Role removed');
        }}
      />
      <ConfirmDialog
        open={suspending}
        onClose={() => setSuspending(false)}
        title={u?.status === 'SUSPENDED' ? `Reactivate ${u?.fullName}?` : `Suspend ${u?.fullName}?`}
        message={u?.status === 'SUSPENDED' ? 'They can sign in again.' : 'They are signed out everywhere and cannot sign in until reactivated. Their data is kept.'}
        confirmLabel={u?.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
        tone={u?.status === 'SUSPENDED' ? 'primary' : 'danger'}
        onConfirm={async () => {
          update(await (u!.status === 'SUSPENDED' ? userApi.reactivate(u!.id) : userApi.suspend(u!.id)));
          toast.success(u!.status === 'SUSPENDED' ? 'Account reactivated' : 'Account suspended');
        }}
      />
    </Dialog>
  );
}

export default function Users() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [more, setMore] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const term = useDebounced(q.trim(), 300);
  const key = `admin:users:${term}:${role}`;
  const { data, loading, error } = useQuery(key, () => userApi.list({ q: term || undefined, role: role || undefined }));

  // Reset "load more" pages whenever the search changes.
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setMore([]);
    setCursor(undefined);
  }
  const rows = [...(data?.items ?? []), ...more];
  const next = cursor === undefined ? data?.nextCursor : cursor;

  return (
    <>
      <PageHeader title="People" description="Everyone with an account. Search, review roles and manage access." />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-end sm:px-6">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search people"
              className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-3 text-[15px] text-fg outline-none placeholder:text-subtle focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            />
          </div>
          <SelectField label="Role" className="sm:w-48" value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
            <option value="">Everyone</option>
            {(['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'SCANNER', 'PARTICIPANT'] as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </SelectField>
        </div>
        {error ? (
          <div className="p-5"><Alert>{error.message}</Alert></div>
        ) : (
          <DataList
            loading={loading}
            rows={rows}
            rowKey={(u) => u.id}
            onRowClick={(u) => setOpen(u.id)}
            empty={<EmptyState compact icon={UsersIcon} title="No one matches" description={term ? 'Try a different name or email.' : undefined} />}
            columns={[
              {
                key: 'name',
                header: 'Person',
                primary: true,
                render: (u) => (
                  <span>
                    {u.fullName}
                    <span className="block text-xs font-normal text-subtle">{u.email}</span>
                  </span>
                ),
              },
              {
                key: 'roles',
                header: 'Roles',
                render: (u) => (
                  <span className="inline-flex flex-wrap justify-end gap-1 sm:justify-start">
                    {u.roles.filter((r) => r.role !== 'PARTICIPANT').map((r) => <Badge key={`${r.role}:${r.scopeId}`} tone="brand">{roleTitle(r)}</Badge>)}
                    {u.roles.every((r) => r.role === 'PARTICIPANT') && <span className="text-subtle">Participant</span>}
                  </span>
                ),
              },
              { key: 'status', header: 'Status', render: (u) => <Badge tone={STATUS_TONE[u.status]} dot>{STATUS_TEXT[u.status]}</Badge> },
              { key: 'seen', header: 'Last seen', render: (u) => (u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'), hideOnMobile: true },
            ]}
          />
        )}
        {next && !loading && (
          <div className="border-t border-line p-4 text-center">
            <Button
              size="sm"
              block={false}
              variant="secondary"
              onClick={async () => {
                const page = await userApi.list({ q: term || undefined, role: role || undefined, cursor: next });
                setMore((m) => [...m, ...page.items]);
                setCursor(page.nextCursor ?? '');
              }}
            >
              Load more
            </Button>
          </div>
        )}
      </Card>
      <UserDialog userId={open} onClose={() => setOpen(null)} />
    </>
  );
}
