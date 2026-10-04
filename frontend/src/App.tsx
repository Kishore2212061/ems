import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { Link, Redirect, Route, Switch, useLocation } from 'wouter';
import { Toaster } from '@/components/toast';
import { FullPageSpinner } from '@/components/ui';
import { refreshSession } from '@/lib/api';
import { activeRoleName, currentHome, useAuth } from '@/store/auth';

// Every page is its own chunk; a visitor only downloads the screen they open.
// Public
const Home = lazy(() => import('@/pages/public/Home'));
const FestPage = lazy(() => import('@/pages/public/FestPage'));
const EventPage = lazy(() => import('@/pages/public/EventPage'));
// Auth
const Login = lazy(() => import('@/pages/Login'));
const Signup = lazy(() => import('@/pages/Signup'));
const VerifyOtp = lazy(() => import('@/pages/VerifyOtp'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const AcceptInvite = lazy(() => import('@/pages/AcceptInvite'));
// Participant
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Profile = lazy(() => import('@/pages/my/Profile'));
const Security = lazy(() => import('@/pages/my/Security'));
const MyRegistrations = lazy(() => import('@/pages/my/Registrations'));
const RegistrationDetail = lazy(() => import('@/pages/my/RegistrationDetail'));
// Admin console (its own chunk group — never downloaded by participants)
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'));
// Scanner
const ScanHome = lazy(() => import('@/pages/scan/ScanHome'));
// Component gallery for design QA. Dev builds only — the branch (and its chunk) is removed in production.
const UiKit = import.meta.env.DEV ? lazy(() => import('@/pages/UiKit')) : null;

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const [location] = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'guest') {
    const next = location === '/dashboard' ? '' : `?next=${encodeURIComponent(location)}`;
    return <Redirect to={`/login${next}`} replace />;
  }
  return children;
}

/** The participant portal only renders in the Participant context; staff contexts go to their own home. */
export function ParticipantOnly({ children }: { children: ReactNode }) {
  const role = useAuth((s) => activeRoleName(s.activeRole));
  if (role !== 'PARTICIPANT') return <Redirect to={currentHome()} replace />;
  return children;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authed') return <Redirect to={currentHome()} replace />;
  return children;
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-page px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">404</p>
        <h1 className="mt-2 text-2xl font-bold text-fg">Page not found</h1>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
          ← Back home
        </Link>
      </div>
    </div>
  );
}

// Wrapped once at module level (not per render) so routes keep a stable component identity.
const guest = (C: ComponentType) => () => (
  <GuestOnly>
    <C />
  </GuestOnly>
);
const authed = (C: ComponentType) => () => (
  <RequireAuth>
    <C />
  </RequireAuth>
);
const participant = (C: ComponentType) => () => (
  <RequireAuth>
    <ParticipantOnly>
      <C />
    </ParticipantOnly>
  </RequireAuth>
);
const R = {
  login: guest(Login),
  signup: guest(Signup),
  verifyOtp: guest(VerifyOtp),
  forgot: guest(ForgotPassword),
  dashboard: participant(Dashboard),
  profile: authed(Profile),
  security: authed(Security),
  // Any signed-in context: staff are participants too (registration links in emails must just work).
  registrations: authed(MyRegistrations),
  registration: authed(RegistrationDetail),
  admin: authed(AdminLayout),
  scan: authed(ScanHome),
};

export default function App() {
  // Restore the session from the HttpOnly refresh cookie — one request returns token + user.
  useEffect(() => {
    void refreshSession().then((ok) => {
      if (!ok) useAuth.getState().setUser(null);
    });
  }, []);

  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/events/:slug" component={FestPage} />
        <Route path="/events/:fest/:slug" component={EventPage} />

        <Route path="/login" component={R.login} />
        <Route path="/signup" component={R.signup} />
        <Route path="/verify-otp" component={R.verifyOtp} />
        <Route path="/forgot-password" component={R.forgot} />
        <Route path="/accept-invite/:token" component={AcceptInvite} />

        <Route path="/dashboard" component={R.dashboard} />
        <Route path="/my/profile" component={R.profile} />
        <Route path="/my/security" component={R.security} />
        <Route path="/my/registrations" component={R.registrations} />
        <Route path="/my/registrations/:code" component={R.registration} />
        <Route path="/admin/*?" component={R.admin} />
        <Route path="/scan" component={R.scan} />

        {UiKit && <Route path="/__ui" component={UiKit} />}
        <Route component={NotFound} />
      </Switch>
      <Toaster />
    </Suspense>
  );
}
