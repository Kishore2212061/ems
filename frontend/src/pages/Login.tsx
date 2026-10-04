import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AuthLayout } from '@/components/AuthLayout';
import { ArrowRightIcon, LockIcon, MailIcon } from '@/components/icons';
import { Alert, Button, Field, PasswordField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/auth-api';
import { useSubmit } from '@/lib/use-submit';
import { currentHome } from '@/store/auth';
import { rules, validate } from '@/lib/validate';

export default function Login() {
  const [, navigate] = useLocation();
  const next = new URLSearchParams(useSearch()).get('next');
  const [form, setForm] = useState({ email: '', password: '' });
  const { loading, error, setError, fields, setFields, clearField, run } = useSubmit();

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    clearField(k);
    setError(null);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate(form, { email: rules.email, password: rules.required('password') });
    if (Object.keys(errs).length) return setFields(errs as Record<string, string>);

    const r = await run(async () => {
      try {
        return await authApi.login(form.email, form.password);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') {
          const mins = Math.ceil((err.details?.retryAfterSec ?? 900) / 60);
          throw new ApiError(err.status, err.code, `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}, or reset your password.`);
        }
        throw err;
      }
    });
    if (r === 'otp') navigate(next ? `/verify-otp?next=${encodeURIComponent(next)}` : '/verify-otp');
    else if (r === 'ok') navigate(next ?? currentHome(), { replace: true });
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to manage your registrations and tickets.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field
          label="Email address"
          type="email"
          icon={MailIcon}
          autoComplete="email"
          placeholder="you@college.edu"
          value={form.email}
          onChange={set('email')}
          error={fields.email}
          autoFocus
        />
        <PasswordField
          label="Password"
          icon={LockIcon}
          autoComplete="current-password"
          placeholder="Enter your password"
          value={form.password}
          onChange={set('password')}
          error={fields.password}
          hint={
            <Link href="/forgot-password" className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300">
              Forgot password?
            </Link>
          }
        />
        <div className="pt-1">
          <Button type="submit" loading={loading}>
            Sign in
            {!loading && <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />}
          </Button>
        </div>
      </form>

      <div className="mt-8 flex items-center gap-4 text-xs font-medium uppercase tracking-wider text-subtle">
        <div className="h-px flex-1 bg-line" />
        New here?
        <div className="h-px flex-1 bg-line" />
      </div>
      <Link
        href="/signup"
        className="mt-5 flex h-12 w-full items-center justify-center rounded-xl border border-line bg-surface text-[15px] font-semibold text-fg-2 shadow-sm transition hover:border-line-strong hover:bg-surface-2"
      >
        Create an account
      </Link>
    </AuthLayout>
  );
}
