import { useState } from 'react';
import { Redirect, useLocation, useSearch } from 'wouter';
import { AuthLayout } from '@/components/AuthLayout';
import { ArrowLeftIcon } from '@/components/icons';
import { OtpInput } from '@/components/OtpInput';
import { ResendLink } from '@/components/ResendLink';
import { Alert, Button } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/auth-api';
import { otpErrorMessage } from '@/lib/otp-error';
import { useCountdown } from '@/lib/use-countdown';
import { useSubmit } from '@/lib/use-submit';
import { currentHome, useAuth } from '@/store/auth';

const LENGTH = 6;

export default function VerifyOtp() {
  const [, navigate] = useLocation();
  const next = new URLSearchParams(useSearch()).get('next');
  const challenge = useAuth((s) => s.challenge);
  const setChallenge = useAuth((s) => s.setChallenge);
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [left, setLeft] = useCountdown(challenge?.resendAfterSec ?? 0);
  const verify = useSubmit();
  const resend = useSubmit();

  if (!challenge) return <Redirect to="/login" replace />;

  async function submit(value = code) {
    if (value.length !== LENGTH || verify.loading) return;
    setInfo(null);
    const ok = await verify.run(async () => {
      try {
        await authApi.verifyOtp(challenge!.otpToken, value);
        return true;
      } catch (e) {
        setCode('');
        if (e instanceof ApiError && e.code === 'OTP_SESSION_EXPIRED') setChallenge(null);
        throw otpErrorMessage(e);
      }
    });
    if (ok) navigate(next ?? currentHome(), { replace: true });
  }

  async function onResend() {
    verify.setError(null);
    const r = await resend.run(async () => {
      try {
        return await authApi.resendOtp(challenge!.otpToken);
      } catch (e) {
        if (e instanceof ApiError && e.details?.retryAfterSec) setLeft(e.details.retryAfterSec);
        throw e;
      }
    });
    if (r) {
      setLeft(r.resendAfterSec);
      setCode('');
      setInfo(`A new code was sent to ${challenge!.email}.`);
    }
  }

  return (
    <AuthLayout
      title="Check your email"
      subtitle={
        <>
          Enter the <span className="whitespace-nowrap">{LENGTH}-digit</span> code we sent to <span className="font-semibold text-fg [overflow-wrap:anywhere]">{challenge.email}</span>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-6"
      >
        {(verify.error || resend.error) && <Alert>{verify.error || resend.error}</Alert>}
        {info && !verify.error && <Alert tone="success">{info}</Alert>}

        <OtpInput
          length={LENGTH}
          value={code}
          invalid={!!verify.error}
          disabled={verify.loading}
          onChange={(v) => {
            setCode(v);
            if (v.length === LENGTH) void submit(v); // auto-submit on the last digit / paste
          }}
        />

        <Button type="submit" loading={verify.loading} disabled={code.length !== LENGTH}>
          Verify and continue
        </Button>
        <ResendLink left={left} loading={resend.loading} onResend={onResend} />
      </form>

      <button
        type="button"
        onClick={() => {
          setChallenge(null);
          navigate('/login', { replace: true });
        }}
        className="mx-auto mt-8 flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"
      >
        <ArrowLeftIcon className="size-4" />
        Back to sign in
      </button>
    </AuthLayout>
  );
}
