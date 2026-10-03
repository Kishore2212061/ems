import { useEffect, useState } from 'react';
import { Redirect, useLocation, useSearch } from 'wouter';
import { AuthLayout } from '@/components/AuthLayout';
import { OtpInput } from '@/components/OtpInput';
import { Alert, Button } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/auth-api';
import { useSubmit } from '@/lib/use-submit';
import { useAuth } from '@/store/auth';

const LENGTH = 6;

function useCountdown(initial: number) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export default function VerifyOtp() {
  const [, navigate] = useLocation();
  const next = new URLSearchParams(useSearch()).get('next') || '/dashboard';
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
        if (e instanceof ApiError && e.code === 'OTP_INVALID' && e.details?.attemptsLeft != null) {
          const n = e.details.attemptsLeft;
          throw new ApiError(e.status, e.code, `Incorrect code. ${n} attempt${n === 1 ? '' : 's'} left.`);
        }
        if (e instanceof ApiError && e.code === 'OTP_SESSION_EXPIRED') setChallenge(null);
        throw e;
      }
    });
    if (ok) navigate(next, { replace: true });
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
          We sent a {LENGTH}-digit code to <span className="font-medium text-slate-900">{challenge.email}</span>
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
      </form>

      <div className="mt-8 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => {
            setChallenge(null);
            navigate('/login', { replace: true });
          }}
          className="text-slate-500 hover:text-slate-800"
        >
          ← Use another account
        </button>
        {left > 0 ? (
          <span className="tabular-nums text-slate-400">Resend in {left}s</span>
        ) : (
          <button
            type="button"
            onClick={onResend}
            disabled={resend.loading}
            className="font-semibold text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
          >
            {resend.loading ? 'Sending…' : 'Resend code'}
          </button>
        )}
      </div>
    </AuthLayout>
  );
}
