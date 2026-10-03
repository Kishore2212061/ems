import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { AuthLayout } from '@/components/AuthLayout';
import { Alert, Button, Field, PasswordField } from '@/components/ui';
import { authApi } from '@/lib/auth-api';
import { useSubmit } from '@/lib/use-submit';

const EMPTY = { fullName: '', email: '', phone: '', college: '', password: '' };

export default function Signup() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState(EMPTY);
  const { loading, error, fields, run } = useSubmit();

  const bind = (k: keyof typeof EMPTY) => ({
    value: form[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
    error: fields[k],
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if ((await run(() => authApi.signup(form))) === 'otp') navigate('/verify-otp');
  }

  return (
    <AuthLayout title="Create your account" subtitle="Register once, join any event across NEC fests.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Full name" autoComplete="name" placeholder="Priya Sharma" autoFocus {...bind('fullName')} />
        <Field label="Email" type="email" autoComplete="email" placeholder="you@college.edu" {...bind('email')} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Mobile" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" {...bind('phone')} />
          <Field label="College" autoComplete="organization" placeholder="Your college" {...bind('college')} />
        </div>
        <PasswordField
          label="Password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          {...bind('password')}
        />
        {!fields.password && <p className="-mt-3 text-[13px] text-slate-500">Use 8+ characters with a letter and a number.</p>}
        <Button type="submit" loading={loading}>
          Create account
        </Button>
        <p className="text-center text-xs leading-relaxed text-slate-500">
          We'll email you a 6-digit code to verify your address.
        </p>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-500">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
