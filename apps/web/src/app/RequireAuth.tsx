import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/atoms/Spinner';
import { ErrorState } from '@/components/molecules/ErrorState';
import { useMe } from '@/lib/auth';
import { useSessionStore } from '@/stores/session';

/** Route guard: waits for /auth/me, sends signed-out users to /login?next=<where they were>. */
export function RequireAuth() {
  const me = useMe();
  const status = useSessionStore((s) => s.status);
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-base text-muted">
        <Spinner size={28} label="Checking your session" />
      </div>
    );
  }

  if (me.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
        <ErrorState
          className="w-full max-w-md"
          error={me.error}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
        />
      </div>
    );
  }

  if (status !== 'signedIn' || !me.data) {
    const next = `${location.pathname}${location.search}`;
    const to = next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
    return <Navigate to={to} replace />;
  }

  return <Outlet />;
}
