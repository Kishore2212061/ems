import { activeRoleName, homeFor, HOME_LABEL, useAuth } from '@/store/auth';

/** Signed-in area navigation (the /dashboard, /scan and /my/* pages). The first link is the active role's home. */
export function useMyNav() {
  const home = homeFor(useAuth((s) => activeRoleName(s.activeRole)));
  return [
    { href: home, label: home === '/dashboard' ? 'Dashboard' : HOME_LABEL[home] },
    { href: '/', label: 'Fests' },
    { href: '/my/profile', label: 'Profile' },
    { href: '/my/security', label: 'Security' },
  ];
}
