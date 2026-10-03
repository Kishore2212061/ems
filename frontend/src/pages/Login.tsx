import { useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AuthLayout } from '@/components/AuthLayout';
import { Alert, Button, Field, PasswordField } from '@/components/ui';
import { authApi } from '@/lib/auth-api';
import { ApiError } from '@/lib/api';
import { useSubmit } from '@/lib/use-submit';

export default function Login() {
  const [, navigate] = useLocation();
  const next = new URLSearchParams(useSearch()).get('next') || '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { loading, error, setError, fields, run } = useSubmit();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await run(async () => {
      try {
        return await authApi.login(email, password);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') {
          const mins = Math.ceil((err.details?.retryAfterSec ?? 900) / 60);
          throw new ApiError(err.status, err.code, `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`);
        }
        throw err;
      }
    });
    if (r === 'otp') navigate(`/verify-otp?next=${encodeURIComponent(next)}`);
    else if (r === 'ok') navigate(next, { replace: true });
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to manage your registrations and tickets.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@college.edu"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          error={fields.email}
          autoFocus
          required
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          error={fields.password}
          required
        />
        <Button type="submit" loading={loading}>
          Sign in
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        New to NEC Events?{' '}
        <Link href="/signup" className="font-semibold text-indigo-600 hover:text-indigo-500">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
