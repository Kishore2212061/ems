import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { AuthLayout } from '@/components/AuthLayout';
import { Skeleton } from '@/components/data';
import { LockIcon, MailIcon, UserIcon } from '@/components/icons';
import { Badge } from '@/components/layout';
import { Alert, Button, Field, PasswordField } from '@/components/ui';
import { api, applySession } from '@/lib/api';
import { inviteApi } from '@/lib/ems-api';
import { fmtDateTime } from '@/lib/format';
import { useQuery } from '@/lib/query';
import { useSubmit } from '@/lib/use-submit';
import { rules, validate } from '@/lib/validate';
import { currentHome, ROLE_LABEL, useAuth, type SessionPayload } from '@/store/auth';

type AcceptResult = { status: 'ROLE_ADDED'; email: string } | ({ status: 'SIGNED_IN' } & SessionPayload);

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const signedIn = useAuth((s) => s.user);
  const { data: inv, error, loading } = useQuery(`invite:${token}`, () => inviteApi.preview(token), { staleMs: 0 });
  const [form, setForm] = useState({ fullName: '', password: '' });
  const [added, setAdded] = useState(false);
  const submit = useSubmit();

  async function accept(e: FormEvent) {
    e.preventDefault();
    if (inv && !inv.accountExists) {
      const errs = validate(form, { fullName: rules.fullName, password: rules.password });
      if (Object.keys(errs).length) return submit.setFields(errs as Record<string, string>);
    }
    const r = await submit.run(() => api.post<AcceptResult>(`/auth/invites/${token}/accept`, inv?.accountExists ? {} : form));
    if (!r) return;
    if (r.status === 'SIGNED_IN') {
      applySession(r);
      navigate(currentHome(), { replace: true });
    } else {
      setAdded(true);
    }
  }

  const bind = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      submit.clearField(k);
    },
    error: submit.fields[k],
  });

  if (error) {
    return (
      <AuthLayout title="Invitation unavailable" subtitle="This link can't be used.">
        <Alert>{error.message}</Alert>
        <Link href="/login" className="mt-6 block text-center text-sm font-semibold text-indigo-600 dark:text-indigo-400">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }

  if (loading || !inv) {
    return (
      <AuthLayout title="Checking your invitation…" subtitle="One moment.">
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-12" />
        </div>
      </AuthLayout>
    );
  }

  if (added) {
    return (
      <AuthLayout title="You're all set" subtitle={<>The new role was added to <strong className="text-fg">{inv.email}</strong>.</>}>
        <Alert tone="success">Sign in with your existing password to start using it.</Alert>
        <Link href="/login" className="mt-6 flex h-12 items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-semibold text-white hover:bg-indigo-500">
          Sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="You're invited" subtitle={<>{inv.invitedByName} invited you to help run NEC Events.</>}>
      <div className="mb-6 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{ROLE_LABEL[inv.role]}</Badge>
          {inv.scopeLabel && <Badge>{inv.scopeLabel}</Badge>}
        </div>
        <p className="mt-2 text-sm text-muted">
          For <span className="font-semibold text-fg">{inv.email}</span> · expires {fmtDateTime(inv.expiresAt)}
        </p>
      </div>

      {signedIn && signedIn.email !== inv.email && (
        <div className="mb-5">
          <Alert tone="info">You&apos;re signed in as {signedIn.email}. This invitation is for {inv.email}.</Alert>
        </div>
      )}

      <form onSubmit={accept} className="space-y-5" noValidate>
        {submit.error && <Alert>{submit.error}</Alert>}
        {inv.accountExists ? (
          <p className="text-sm text-muted">You already have an account. Accept to add this role to it.</p>
        ) : (
          <>
            <Field label="Email address" icon={MailIcon} value={inv.email} disabled />
            <Field label="Full name" icon={UserIcon} autoComplete="name" placeholder="Your name" autoFocus maxLength={80} {...bind('fullName')} />
            <PasswordField label="Create a password" icon={LockIcon} autoComplete="new-password" showStrength {...bind('password')} />
          </>
        )}
        <Button type="submit" loading={submit.loading}>
          Accept invitation
        </Button>
      </form>
    </AuthLayout>
  );
}
