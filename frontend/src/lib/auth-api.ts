import { useAuth, type OtpChallenge, type SessionPayload } from '@/store/auth';
import { api, applySession, clearSession } from './api';
import { clearQueryCache } from './query';

type LoginResult = SessionPayload | OtpChallenge;

/** Returns 'otp' when the user must verify their email first, 'ok' when signed in. */
function handle(r: LoginResult): 'otp' | 'ok' {
  if ('otpRequired' in r) {
    useAuth.getState().setChallenge(r);
    return 'otp';
  }
  applySession(r);
  return 'ok';
}

export const authApi = {
  login: async (email: string, password: string) => handle(await api.post<LoginResult>('/auth/login', { email, password })),

  signup: async (body: { fullName: string; email: string; phone: string; college: string; password: string }) =>
    handle(await api.post<OtpChallenge>('/auth/signup', body)),

  verifyOtp: async (otpToken: string, code: string) => {
    applySession(await api.post<SessionPayload>('/auth/verify-otp', { otpToken, code }));
    useAuth.getState().setChallenge(null);
  },

  resendOtp: (otpToken: string) => api.post<{ sent: true; resendAfterSec: number }>('/auth/resend-otp', { otpToken }),

  forgotPassword: (email: string) => api.post<OtpChallenge>('/auth/forgot-password', { email }),

  resetPassword: async (otpToken: string, code: string, password: string) => {
    applySession(await api.post<SessionPayload>('/auth/reset-password', { otpToken, code, password }));
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearSession();
      clearQueryCache();
    }
  },
};
