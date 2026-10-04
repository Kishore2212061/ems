import { lazy, Suspense, useEffect, type ComponentType, type SVGProps } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import { RoleSwitcher, UserMenu } from '@/components/AppHeader';
import { Skeleton } from '@/components/data';
import { BuildingIcon, CalendarIcon, ExternalIcon, GridIcon, MailIcon, UsersIcon } from '@/components/icons';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cx, Logo } from '@/components/ui';
import { can, canOrgWide, type UiPermission } from '@/lib/permissions';
import { homeFor, roleKey, useAuth } from '@/store/auth';

const Overview = lazy(() => import('./Overview'));
const Fests = lazy(() => import('./Fests'));
const FestNew = lazy(() => import('./FestNew'));
const FestDetail = lazy(() => import('./FestDetail'));
const EventStudio = lazy(() => import('./EventStudio'));
const Departments = lazy(() => import('./Departments'));
const Users = lazy(() => import('./Users'));
const Invites = lazy(() => import('./Invites'));

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  show: (u: ReturnType<typeof useAuth.getState>['user']) => boolean;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: GridIcon, show: () => true },
  { href: '/admin/events', label: 'Fests', icon: CalendarIcon, show: (u) => can(u, 'global_event.read') },
  { href: '/admin/departments', label: 'Departments', icon: BuildingIcon, show: () => true },
  { href: '/admin/users', label: 'People', icon: UsersIcon, show: (u) => canOrgWide(u, 'user.read') },
  { href: '/admin/invites', label: 'Invites', icon: MailIcon, show: (u) => can(u, 'user.invite' as UiPermission) },
];

const isActive = (loc: string, href: string) => (href === '/admin' ? loc === '/admin' : loc.startsWith(href));

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

export default function AdminLayout() {
  const user = useAuth((s) => s.user);
  const active = useAuth((s) => s.activeRole);
  const setActive = useAuth((s) => s.setActiveRole);
  const [loc] = useLocation();

  // Opened /admin while in a participant/scanner context (e.g. a bookmark) → switch the role pill
  // to the user's first admin-type role so the header matches the console.
  useEffect(() => {
    const current = user?.roles.find((r) => roleKey(r) === active);
    if (current && homeFor(current.role) === '/admin') return;
    const adminRole = user?.roles.find((r) => homeFor(r.role) === '/admin');
    if (adminRole) setActive(roleKey(adminRole));
  }, [user, active, setActive]);

  if (!can(user, 'admin.access')) {
    return (
      <div className="grid min-h-dvh place-items-center bg-page px-6 text-center">
        <div>
          <h1 className="text-2xl font-bold text-fg">No admin access</h1>
          <p className="mt-2 text-muted">Your account doesn&apos;t have a staff role. Ask a Super Admin for an invitation.</p>
          <Link href="/dashboard" className="mt-6 inline-block text-sm font-semibold text-indigo-600 dark:text-indigo-400">
            Go to your dashboard
          </Link>
        </div>
      </div>
    );
  }

  const items = NAV.filter((n) => n.show(user));

  return (
    <div className="min-h-dvh bg-page lg:pl-64">
      {/* sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
        <Link href="/admin" className="flex h-16 items-center border-b border-line px-5">
          <Logo />
        </Link>
        <nav className="flex-1 space-y-1 p-3">
          <p className="px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-subtle">Admin console</p>
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                isActive(loc, n.href) ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <n.icon className="size-5" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <Link href="/" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-fg">
            <ExternalIcon className="size-5" />
            Public site
          </Link>
        </div>
      </aside>

      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/admin" className="lg:hidden">
            <Logo />
          </Link>
          <span className="hidden text-sm font-semibold text-muted lg:block">{items.find((n) => isActive(loc, n.href))?.label ?? 'Admin'}</span>
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <ThemeToggle />
            <RoleSwitcher />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:pb-12">
        <Suspense fallback={<PageFallback />}>
          <Switch>
            <Route path="/admin" component={Overview} />
            <Route path="/admin/events" component={Fests} />
            <Route path="/admin/events/new" component={FestNew} />
            <Route path="/admin/events/:festId/local/:eventId" component={EventStudio} />
            <Route path="/admin/events/:id" component={FestDetail} />
            <Route path="/admin/departments" component={Departments} />
            <Route path="/admin/users" component={Users} />
            <Route path="/admin/invites" component={Invites} />
            <Route>
              <p className="text-muted">Page not found.</p>
            </Route>
          </Switch>
        </Suspense>
      </main>

      {/* bottom tabs (phones/tablets) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold', isActive(loc, n.href) ? 'text-indigo-600 dark:text-indigo-300' : 'text-muted')}
          >
            <n.icon className="size-5" />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
