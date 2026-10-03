import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { AuthLayout } from '@/components/AuthLayout';
import { ArrowRightIcon, BuildingIcon, LockIcon, MailIcon, UserIcon } from '@/components/icons';
import { Alert, Button, Field, PasswordField } from '@/components/ui';
import { authApi } from '@/lib/auth-api';
import { useSubmit } from '@/lib/use-submit';
import { rules, sanitizePhone, validate } from '@/lib/validate';

const EMPTY = { fullName: '', email: '', phone: '', college: '', password: '' };
type Key = keyof typeof EMPTY;
const SCHEMA = { fullName: rules.fullName, email: rules.email, phone: rules.phone, college: rules.college, password: rules.password };

export default function Signup() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const { loading, error, fields, setFields, clearField, run } = useSubmit();

  const clientErrors = validate(form, SCHEMA);
  // Show a field's error once it has been visited (blur) — not while the user is still typing it the first time.
  const errorFor = (k: Key) => fields[k] ?? (touched[k] ? clientErrors[k] : undefined);

  const bind = (k: Key, transform: (v: string) => string = (v) => v) => ({
    value: form[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [k]: transform(e.target.value) }));
      clearField(k);
    },
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
    error: errorFor(k),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ fullName: true, email: true, phone: true, college: true, password: true });
    if (Object.keys(clientErrors).length) return setFields(clientErrors as Record<string, string>);
    if ((await run(() => authApi.signup(form))) === 'otp') navigate('/verify-otp');
  }

  return (
    <AuthLayout title="Create your account" subtitle="Register once and join any event across NEC fests.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Full name" icon={UserIcon} autoComplete="name" placeholder="Priya Sharma" autoFocus maxLength={80} {...bind('fullName')} />
        <Field label="Email address" type="email" icon={MailIcon} autoComplete="email" placeholder="you@college.edu" maxLength={254} {...bind('email')} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Mobile number"
            type="tel"
            inputMode="numeric"
            prefix="+91"
            autoComplete="tel-national"
            placeholder="9876543210"
            {...bind('phone', sanitizePhone)}
          />
          <Field label="College" icon={BuildingIcon} autoComplete="organization" placeholder="Your college" maxLength={120} {...bind('college')} />
        </div>
        <PasswordField
          label="Password"
          icon={LockIcon}
          autoComplete="new-password"
          placeholder="Create a password"
          maxLength={128}
          showStrength
          {...bind('password')}
        />
        <div className="pt-1">
          <Button type="submit" loading={loading}>
            Create account
            {!loading && <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />}
          </Button>
        </div>
        <p className="text-center text-xs leading-relaxed text-muted">We'll email you a 6-digit code to verify your address.</p>
      </form>

      <p className="mt-8 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
