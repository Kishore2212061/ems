import { useState } from 'react';
import { DataList, EmptyState } from '@/components/data';
import { MailIcon, SendIcon } from '@/components/icons';
import { Badge, Card, PageHeader, Tabs } from '@/components/layout';
import { ConfirmDialog, Dialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, Field } from '@/components/ui';
import { inviteApi, type Invite, type RoleGrant } from '@/lib/ems-api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { isSuperAdmin } from '@/lib/permissions';
import { invalidate, useQuery } from '@/lib/query';
import { useSubmit } from '@/lib/use-submit';
import { rules } from '@/lib/validate';
import { roleTitle, useAuth, type Role } from '@/store/auth';
import { RolePicker } from './RolePicker';

type Status = Invite['status'];

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAuth((s) => s.user)!;
  const sa = isSuperAdmin(me);
  // Mirror of the backend rule: non-super-admins invite ADMIN/SCANNER inside their own scope.
  const roles: Role[] = sa ? ['ADMIN', 'FINANCE', 'SCANNER', 'SUPER_ADMIN'] : ['ADMIN', 'SCANNER'];
  const myDepts = me.roles.filter((r) => r.role === 'ADMIN' && r.scopeType === 'DEPARTMENT').map((r) => r.scopeId!);
  const orgAdmin = me.roles.some((r) => r.role === 'ADMIN' && r.scopeType === 'ORG');
  const [email, setEmail] = useState('');
  const [grant, setGrant] = useState<RoleGrant>({ role: 'ADMIN', scopeType: sa || orgAdmin ? 'ORG' : myDepts.length ? 'DEPARTMENT' : 'GLOBAL_EVENT', scopeId: null });
  const { loading, error, fields, setFields, run } = useSubmit();

  async function send() {
    const e = rules.email(email);
    if (e) return setFields({ email: e });
    if (grant.scopeType !== 'ORG' && !grant.scopeId) return setFields({ scopeId: 'Choose one' });
    const r = await run(() => inviteApi.create({ email: email.trim(), ...grant }));
    if (r) {
      invalidate('admin:invites');
      toast.success(`Invitation sent to ${r.email}`);
      setEmail('');
      onClose();
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite someone"
      description="They'll get an email link (valid 72 hours) to join with this role."
      footer={
        <>
          <Button size="sm" block={false} variant="secondary" onClick={onClose}>Cancel</Button>
          <Button size="sm" block={false} loading={loading} onClick={send}>
            <SendIcon className="size-4" /> Send invite
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Email address" type="email" icon={MailIcon} placeholder="faculty@nec.edu.in" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} autoFocus />
        <RolePicker value={grant} onChange={setGrant} roles={roles} allowedDepartmentIds={sa || orgAdmin ? undefined : myDepts} errors={fields} />
      </div>
    </Dialog>
  );
}

export default function Invites() {
  const [tab, setTab] = useState<Status>('PENDING');
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<Invite | null>(null);
  const { data, loading } = useQuery(`admin:invites:${tab}`, () => inviteApi.list(tab));

  async function resend(i: Invite) {
    try {
      await inviteApi.resend(i.id);
      toast.success(`Sent a new link to ${i.email}`);
      invalidate('admin:invites');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Invites"
        description="Bring faculty, coordinators and volunteers on board."
        actions={<Button size="sm" block={false} onClick={() => setInviting(true)}><SendIcon className="size-4" /> Invite</Button>}
      />
      <Card padded={false}>
        <div className="px-5 pt-2 sm:px-6">
          <Tabs<Status>
            label="Invite status"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'ACCEPTED', label: 'Accepted' },
              { value: 'REVOKED', label: 'Withdrawn' },
            ]}
          />
        </div>
        <DataList
          loading={loading}
          rows={data ?? []}
          rowKey={(i) => i.id}
          empty={<EmptyState compact icon={MailIcon} title={tab === 'PENDING' ? 'No pending invites' : 'Nothing here yet'} action={tab === 'PENDING' && <Button size="sm" block={false} onClick={() => setInviting(true)}>Invite someone</Button>} />}
          columns={[
            { key: 'email', header: 'Email', primary: true, render: (i) => i.email },
            { key: 'role', header: 'Role', render: (i) => <Badge tone="brand">{roleTitle({ role: i.role, scopeLabel: i.scopeLabel })}</Badge> },
            { key: 'by', header: 'Invited by', render: (i) => i.invitedByName, hideOnMobile: true },
            {
              key: 'when',
              header: tab === 'PENDING' ? 'Expires' : 'Sent',
              render: (i) =>
                tab === 'PENDING' ? (i.expired ? <Badge tone="danger">Expired</Badge> : <span title={fmtDateTime(i.expiresAt)}>{fmtDateTime(i.expiresAt)}</span>) : timeAgo(i.lastSentAt),
            },
            ...(tab === 'PENDING'
              ? [
                  {
                    key: 'actions',
                    header: '',
                    align: 'right' as const,
                    render: (i: Invite) => (
                      <span className="inline-flex gap-3">
                        <button type="button" className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400" onClick={() => void resend(i)}>
                          Resend
                        </button>
                        <button type="button" className="text-sm font-semibold text-red-600 hover:text-red-500 dark:text-red-400" onClick={() => setRevoking(i)}>
                          Withdraw
                        </button>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Withdraw this invitation?"
        message={`The link sent to ${revoking?.email} stops working immediately.`}
        confirmLabel="Withdraw"
        tone="danger"
        onConfirm={async () => {
          await inviteApi.revoke(revoking!.id);
          invalidate('admin:invites');
          toast.success('Invitation withdrawn');
        }}
      />
    </>
  );
}
