import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { AuthLayout } from '@/components/AuthLayout';
import { ArrowLeftIcon, LockIcon, MailIcon } from '@/components/icons';
import { OtpInput } from '@/components/OtpInput';
import { ResendLink } from '@/components/ResendLink';
import { Alert, Button, Field, PasswordField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/auth-api';
import { otpErrorMessage } from '@/lib/otp-error';
import { useCountdown } from '@/lib/use-countdown';
import { useSubmit } from '@/lib/use-submit';
import { rules } from '@/lib/validate';
import { currentHome, type OtpChallenge } from '@/store/auth';

const LENGTH = 6;

export default function ForgotPassword() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [left, setLeft] = useCountdown(0);
  const req = useSubmit();
  const reset = useSubmit();
  const resend = useSubmit();

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    const err = rules.email(email);
    if (err) return req.setFields({ email: err });
    const r = await req.run(() => authApi.forgotPassword(email));
    if (r) {
      setChallenge(r);
      setLeft(r.resendAfterSec);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (code.length !== LENGTH) errs.code = `Enter the ${LENGTH}-digit code`;
    const pw = rules.password(password);
    if (pw) errs.password = pw;
    if (Object.keys(errs).length) return reset.setFields(errs);

    setInfo(null);
    const ok = await reset.run(async () => {
      try {
        await authApi.resetPassword(challenge!.otpToken, code, password);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.code.startsWith('OTP_')) setCode('');
        throw otpErrorMessage(err);
      }
    });
    if (ok) navigate(currentHome(), { replace: true });
  }

  async function onResend() {
    reset.setError(null);
    const r = await resend.run(async () => {
      try {
        return await authApi.resendOtp(challenge!.otpToken);
      } catch (err) {
        if (err instanceof ApiError && err.details?.retryAfterSec) setLeft(err.details.retryAfterSec);
        throw err;
      }
    });
    if (r) {
      setLeft(r.resendAfterSec);
      setCode('');
      setInfo(`A new code was sent to ${challenge!.email}.`);
    }
  }

  const back = (
    <Link href="/login" className="mx-auto mt-8 flex w-fit items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
      <ArrowLeftIcon className="size-4" />
      Back to sign in
    </Link>
  );

  if (!challenge) {
    return (
      <AuthLayout title="Forgot your password?" subtitle="Enter your email and we'll send you a code to reset it.">
        <form onSubmit={requestCode} className="space-y-5" noValidate>
          {req.error && <Alert>{req.error}</Alert>}
          <Field
            label="Email address"
            type="email"
            icon={MailIcon}
            autoComplete="email"
            placeholder="you@college.edu"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              req.clearField('email');
            }}
            error={req.fields.email}
            autoFocus
          />
          <div className="pt-1">
            <Button type="submit" loading={req.loading}>
              Send reset code
            </Button>
          </div>
        </form>
        {back}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={
        <>
          If an account exists for <span className="font-semibold text-fg [overflow-wrap:anywhere]">{challenge.email}</span>, we've sent it a <span className="whitespace-nowrap">{LENGTH}-digit code</span>.
        </>
      }
    >
      <form onSubmit={onReset} className="space-y-6" noValidate>
        {(reset.error || resend.error) && <Alert>{reset.error || resend.error}</Alert>}
        {info && !reset.error && <Alert tone="success">{info}</Alert>}

        <div>
          <div className="mb-2 text-sm font-semibold text-fg-2">Verification code</div>
          <OtpInput
            length={LENGTH}
            value={code}
            invalid={!!reset.fields.code}
            disabled={reset.loading}
            onChange={(v) => {
              setCode(v);
              reset.clearField('code');
            }}
          />
          {reset.fields.code && <p className="mt-1.5 text-[13px] font-medium text-red-600 dark:text-red-400">{reset.fields.code}</p>}
        </div>

        <PasswordField
          label="New password"
          icon={LockIcon}
          autoComplete="new-password"
          placeholder="Create a new password"
          maxLength={128}
          showStrength
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            reset.clearField('password');
          }}
          error={reset.fields.password}
        />

        <Button type="submit" loading={reset.loading}>
          Reset password and sign in
        </Button>
        <ResendLink left={left} loading={resend.loading} onResend={onResend} />
      </form>
      <p className="mt-6 text-center text-xs text-subtle">For your security, you'll be signed out of all other devices.</p>
      {back}
    </AuthLayout>
  );
}
