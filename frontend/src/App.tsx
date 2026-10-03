import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Redirect, Route, Switch, useLocation } from 'wouter';
import { FullPageSpinner } from '@/components/ui';
import { refreshSession } from '@/lib/api';
import { useAuth } from '@/store/auth';

// Every page is its own chunk; a visitor only downloads the screen they open.
const Login = lazy(() => import('@/pages/Login'));
const Signup = lazy(() => import('@/pages/Signup'));
const VerifyOtp = lazy(() => import('@/pages/VerifyOtp'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));

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

function GuestOnly({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authed') return <Redirect to="/dashboard" replace />;
  return children;
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-indigo-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-500">
          ← Back home
        </Link>
      </div>
    </div>
  );
}

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
        <Route path="/">
          <Redirect to="/dashboard" replace />
        </Route>
        <Route path="/login">
          <GuestOnly>
            <Login />
          </GuestOnly>
        </Route>
        <Route path="/signup">
          <GuestOnly>
            <Signup />
          </GuestOnly>
        </Route>
        <Route path="/verify-otp">
          <GuestOnly>
            <VerifyOtp />
          </GuestOnly>
        </Route>
        <Route path="/dashboard">
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}
