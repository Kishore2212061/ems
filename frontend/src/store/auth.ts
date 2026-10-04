import { create } from 'zustand';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'FINANCE' | 'SCANNER' | 'PARTICIPANT';
export type ScopeType = 'ORG' | 'GLOBAL_EVENT' | 'DEPARTMENT' | 'LOCAL_EVENT';

export interface UserRole {
  role: Role;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeLabel: string | null;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  college: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  emailVerified: boolean;
  roles: UserRole[];
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

/** Stable key for a role tuple (also what the switcher persists). */
export const roleKey = (r: Pick<UserRole, 'role' | 'scopeId'>) => `${r.role}:${r.scopeId ?? ''}`;

const PRIORITY: Role[] = ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'SCANNER', 'PARTICIPANT'];
/** Roles in switcher order: most privileged first, Participant last. */
export const sortRoles = <T extends Pick<UserRole, 'role'>>(roles: T[]) => [...roles].sort((a, b) => PRIORITY.indexOf(a.role) - PRIORITY.indexOf(b.role));
const ROLE_PREF = (userId: string) => `ems_role_${userId}`;

/** Remembered choice if still valid, else the most privileged role. */
function pickActive(user: User): string {
  const saved = localStorage.getItem(ROLE_PREF(user.id));
  if (saved && user.roles.some((r) => roleKey(r) === saved)) return saved;
  const top = sortRoles(user.roles)[0];
  return top ? roleKey(top) : 'PARTICIPANT:';
}

interface AuthState {
  status: Status;
  user: User | null;
  /** Role context chosen in the switcher. UI only — the API authorises with all roles. */
  activeRole: string;
  /** Pending OTP step; mirrored to sessionStorage so a page reload doesn't lose it. */
  challenge: OtpChallenge | null;
  setUser: (u: User | null) => void;
  setActiveRole: (key: string) => void;
  setChallenge: (c: OtpChallenge | null) => void;
}

const CHALLENGE_KEY = 'ems_otp';
const saved = sessionStorage.getItem(CHALLENGE_KEY);

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  activeRole: 'PARTICIPANT:',
  challenge: saved ? (JSON.parse(saved) as OtpChallenge) : null,
  setUser: (user) => set({ user, status: user ? 'authed' : 'guest', activeRole: user ? pickActive(user) : 'PARTICIPANT:' }),
  setActiveRole: (key) => {
    const u = get().user;
    if (u) localStorage.setItem(ROLE_PREF(u.id), key);
    set({ activeRole: key });
  },
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

export const roleTitle = (r: Pick<UserRole, 'role' | 'scopeLabel'>) => (r.scopeLabel ? `${ROLE_LABEL[r.role]} · ${r.scopeLabel}` : ROLE_LABEL[r.role]);

export const activeRoleName = (key: string) => key.split(':')[0] as Role;

/** Where a role "lives" in the app. Each surface only renders for its own role context. */
export const homeFor = (role: Role) => (role === 'PARTICIPANT' ? '/dashboard' : role === 'SCANNER' ? '/scan' : '/admin');

export const HOME_LABEL: Record<ReturnType<typeof homeFor>, string> = {
  '/dashboard': 'My dashboard',
  '/admin': 'Admin console',
  '/scan': 'Ticket scanner',
};

export const currentHome = () => homeFor(activeRoleName(useAuth.getState().activeRole));
