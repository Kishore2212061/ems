import { create } from 'zustand';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'FINANCE' | 'SCANNER' | 'PARTICIPANT';

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  college: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  emailVerified: boolean;
  roles: { role: Role; scopeType: string; scopeId: string | null }[];
  createdAt: string;
}

export interface SessionPayload {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface OtpChallenge {
  otpRequired: true;
  otpToken: string;
  email: string;
  resendAfterSec: number;
}

type Status = 'loading' | 'authed' | 'guest';

interface AuthState {
  status: Status;
  user: User | null;
  /** Pending OTP step; mirrored to sessionStorage so a page reload doesn't lose it. */
  challenge: OtpChallenge | null;
  setUser: (u: User | null) => void;
  setChallenge: (c: OtpChallenge | null) => void;
}

const CHALLENGE_KEY = 'ems_otp';
const saved = sessionStorage.getItem(CHALLENGE_KEY);

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  user: null,
  challenge: saved ? (JSON.parse(saved) as OtpChallenge) : null,
  setUser: (user) => set({ user, status: user ? 'authed' : 'guest' }),
  setChallenge: (challenge) => {
    if (challenge) sessionStorage.setItem(CHALLENGE_KEY, JSON.stringify(challenge));
    else sessionStorage.removeItem(CHALLENGE_KEY);
    set({ challenge });
  },
}));

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  FINANCE: 'Finance',
  SCANNER: 'Scanner',
  PARTICIPANT: 'Participant',
};
