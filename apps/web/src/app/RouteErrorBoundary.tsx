import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { ErrorState } from '@/components/molecules/ErrorState';

/** errorElement for every route: shows the error in place of the page, the shell stays. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  // eslint-disable-next-line no-console -- dev-only aid for debugging route errors
  if (import.meta.env.DEV) console.error(error);

  const isChunkError = error instanceof Error && /dynamically imported module|Failed to fetch/i.test(error.message);
  if (isRouteErrorResponse(error)) {
    return (
      <ErrorState
        className="m-6"
        title={error.status === 404 ? 'Page not found' : 'Something went wrong'}
        description={error.statusText || 'Please try again.'}
        onRetry={() => navigate(0)}
      />
    );
  }
  return (
    <ErrorState
      className="m-6"
      title={isChunkError ? 'A new version is ready' : 'This screen hit a problem'}
      description={isChunkError ? 'Reload to get the latest version.' : 'Reload the screen. If it keeps happening, tell the team.'}
      onRetry={() => window.location.reload()}
    />
  );
}
