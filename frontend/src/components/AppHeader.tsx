import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { Link, useLocation } from 'wouter';
import { authApi } from '@/lib/auth-api';
import { HOME_LABEL, homeFor, roleKey, roleTitle, sortRoles, useAuth, type Role, type UserRole } from '@/store/auth';
import { CheckIcon, ChevronDownIcon, GridIcon, KeyIcon, LogOutIcon, ScanIcon, ShieldIcon, SwitchIcon, TicketIcon, UserIcon, WalletIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';
import { cx, Logo, Spinner } from './ui';

/** Click-outside + Escape closing for small popovers. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const menuPanel = 'absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-xl';
const menuRow = 'flex w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg';
const menuItem = `${menuRow} py-2.5`;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

const ROLE_ICON: Record<Role, ComponentType<SVGProps<SVGSVGElement>>> = {
  SUPER_ADMIN: ShieldIcon,
  ADMIN: GridIcon,
  FINANCE: WalletIcon,
  SCANNER: ScanIcon,
  PARTICIPANT: TicketIcon,
};

/**
 * Role context for this session. Switching is instant: no sign-out and no request, because the API
 * already authorises with every role the user holds; it only changes which surface is shown.
 */
function useRoleSwitch() {
  const user = useAuth((s) => s.user);
  const active = useAuth((s) => s.activeRole);
  const setActive = useAuth((s) => s.setActiveRole);
  const [, navigate] = useLocation();
  const roles = user ? sortRoles(user.roles) : [];
  const current = roles.find((r) => roleKey(r) === active) ?? roles[0];
  const pick = (r: UserRole) => {
    setActive(roleKey(r));
    navigate(homeFor(r.role));
  };
  return { roles, active, current, pick };
}

/** The list of the user's roles; picking one opens that role's home. */
function RoleOptions({ onPicked }: { onPicked: () => void }) {
  const { roles, active, pick } = useRoleSwitch();
  return (
    <>
      <p className="flex items-center gap-2 px-3 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wider text-subtle">
        <SwitchIcon className="size-3.5" /> Switch role
      </p>
      {roles.map((r) => {
        const key = roleKey(r);
        const on = key === active;
        const I = ROLE_ICON[r.role];
        return (
          <button
            key={key}
            type="button"
            role="menuitemradio"
            aria-checked={on}
            onClick={() => {
              onPicked();
              pick(r);
            }}
            className={cx(menuRow, 'py-2', on && 'bg-indigo-500/10 text-fg')}
          >
            <span className={cx('grid size-8 shrink-0 place-items-center rounded-lg', on ? 'bg-indigo-500 text-white' : 'bg-surface-2 text-muted')}>
              <I className="size-4" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-semibold">{roleTitle(r)}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">{HOME_LABEL[homeFor(r.role)]}</span>
            </span>
            {on && <CheckIcon className="size-4 shrink-0 text-indigo-500" strokeWidth={2.5} />}
          </button>
        );
      })}
    </>
  );
}

/** Active-role pill (tablet/desktop; on phones the same list lives in the account menu). Only shown when there's a choice. */
export function RoleSwitcher() {
  const { roles, current } = useRoleSwitch();
  const { open, setOpen, ref } = usePopover();
  if (roles.length < 2 || !current) return null;
  const I = ROLE_ICON[current.role];

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Active role: ${roleTitle(current)}. Switch role`}
        className="flex h-10 max-w-60 items-center gap-1.5 rounded-full border border-indigo-500/25 bg-indigo-500/10 pl-3 pr-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-500/15 dark:text-indigo-300"
      >
        <I className="size-3.5 shrink-0" />
        <span className="truncate">{roleTitle(current)}</span>
        <ChevronDownIcon className={cx('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className={menuPanel}>
          <RoleOptions onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

export function UserMenu() {
  const user = useAuth((s) => s.user)!;
  const [, navigate] = useLocation();
  const { open, setOpen, ref } = usePopover();
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    await authApi.logout();
    navigate('/login', { replace: true });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-sm font-bold text-white shadow-md shadow-indigo-500/25 ring-2 ring-surface sm:size-10"
      >
        {initials(user.fullName)}
      </button>
      {open && (
        <div role="menu" className={menuPanel}>
          <div className="border-b border-line px-3 pb-3 pt-2">
            <div className="truncate text-sm font-semibold text-fg">{user.fullName}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
          </div>
          {user.roles.length > 1 && (
            <div className="border-b border-line py-1.5">
              <RoleOptions onPicked={() => setOpen(false)} />
            </div>
          )}
          <div className="pt-1.5">
            <Link href="/my/profile" onClick={() => setOpen(false)} className={menuItem}>
              <UserIcon className="size-4" /> Profile
            </Link>
            <Link href="/my/security" onClick={() => setOpen(false)} className={menuItem}>
              <KeyIcon className="size-4" /> Password & sessions
            </Link>
            <button type="button" onClick={logout} disabled={leaving} className={cx(menuItem, 'text-red-600 hover:text-red-600 dark:text-red-400')}>
              {leaving ? <Spinner /> : <LogOutIcon className="size-4" />} Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Top bar for the participant area and public pages when signed in. */
export function AppHeader({ nav = [], children }: { nav?: { href: string; label: string }[]; children?: ReactNode }) {
  const [location] = useLocation();
  const user = useAuth((s) => s.user);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/" className="shrink-0">
            <Logo />
          </Link>
          {nav.length > 0 && (
            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cx(
                    'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                    location === n.href ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
                  )}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          {children}
          <ThemeToggle />
          {user ? (
            <>
              <RoleSwitcher />
              <UserMenu />
            </>
          ) : (
            <Link href="/login" className="inline-flex h-10 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
