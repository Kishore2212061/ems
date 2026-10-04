import { useState, type ChangeEvent, type FormEvent } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { DataList, EmptyState } from '@/components/data';
import { LockIcon, ShieldIcon } from '@/components/icons';
import { Badge, Card, PageHeader } from '@/components/layout';
import { ConfirmDialog } from '@/components/overlay';
import { toast } from '@/components/toast';
import { Alert, Button, PasswordField } from '@/components/ui';
import { api, applySession } from '@/lib/api';
import { meApi, type Session } from '@/lib/ems-api';
import { describeDevice, timeAgo } from '@/lib/format';
import { invalidate, useQuery } from '@/lib/query';
import { useSubmit } from '@/lib/use-submit';
import { rules } from '@/lib/validate';
import type { SessionPayload } from '@/store/auth';
import { useMyNav } from '@/lib/nav';

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const { loading, error, fields, setFields, clearField, run } = useSubmit();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.currentPassword) errs.currentPassword = 'Enter your current password';
    const pw = rules.password(form.newPassword);
    if (pw) errs.newPassword = pw;
    if (Object.keys(errs).length) return setFields(errs);
    const r = await run(() => api.post<SessionPayload>('/auth/change-password', form));
    if (r) {
      applySession(r); // this device stays signed in with a fresh session
      setForm({ currentPassword: '', newPassword: '' });
      invalidate('me:sessions');
      toast.success('Password changed. Other devices were signed out.');
    }
  }

  const bind = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      clearField(k);
    },
    error: fields[k],
  });

  return (
    <Card title="Change password" description="You'll stay signed in here; every other device is signed out.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <PasswordField label="Current password" icon={LockIcon} autoComplete="current-password" {...bind('currentPassword')} />
        <PasswordField label="New password" icon={LockIcon} autoComplete="new-password" showStrength {...bind('newPassword')} />
        <div className="flex justify-end">
          <Button type="submit" block={false} loading={loading}>
            Update password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Sessions() {
  const { data, loading, error, refetch } = useQuery('me:sessions', meApi.sessions);
  const [confirmAll, setConfirmAll] = useState(false);
  const others = data?.filter((s) => !s.current).length ?? 0;

  async function signOut(s: Session) {
    await meApi.revokeSession(s.id);
    toast.success(`Signed out ${describeDevice(s.userAgent)}`);
    invalidate('me:sessions');
  }

  return (
    <Card
      title="Where you're signed in"
      description="Sign out of devices you don't recognise."
      padded={false}
      actions={
        others > 0 && (
          <Button size="sm" variant="secondary" block={false} onClick={() => setConfirmAll(true)}>
            Sign out all others
          </Button>
        )
      }
    >
      {error ? (
        <div className="p-5">
          <Alert>
            Couldn&apos;t load sessions.{' '}
            <button type="button" className="font-semibold underline" onClick={refetch}>
              Retry
            </button>
          </Alert>
        </div>
      ) : (
        <DataList
          loading={loading}
          rows={data ?? []}
          rowKey={(s) => s.id}
          skeletonRows={2}
          empty={<EmptyState compact icon={ShieldIcon} title="No active sessions" />}
          columns={[
            {
              key: 'device',
              header: 'Device',
              primary: true,
              render: (s) => (
                <span className="flex flex-wrap items-center gap-2">
                  {describeDevice(s.userAgent)}
                  {s.current && <Badge tone="success" dot>This device</Badge>}
                </span>
              ),
            },
            { key: 'ip', header: 'IP address', render: (s) => s.ip ?? '—' },
            { key: 'active', header: 'Last active', render: (s) => timeAgo(s.lastActiveAt) },
            {
              key: 'act',
              header: '',
              align: 'right',
              render: (s) =>
                !s.current && (
                  <button type="button" onClick={() => void signOut(s)} className="text-sm font-semibold text-red-600 hover:text-red-500 dark:text-red-400">
                    Sign out
                  </button>
                ),
            },
          ]}
        />
      )}
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="Sign out all other devices?"
        message={`${others} other session${others === 1 ? '' : 's'} will be ended. This device stays signed in.`}
        confirmLabel="Sign out others"
        tone="danger"
        onConfirm={async () => {
          await meApi.revokeOthers();
          invalidate('me:sessions');
          toast.success('Other devices signed out');
        }}
      />
    </Card>
  );
}

export default function Security() {
  const nav = useMyNav();
  return (
    <div className="min-h-dvh bg-page">
      <AppHeader nav={nav} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-5 sm:py-10">
        <PageHeader title="Password & sessions" description="Keep your account secure." />
        <ChangePassword />
        <Sessions />
      </main>
    </div>
  );
}
