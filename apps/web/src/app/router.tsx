import { lazy, type ReactNode } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/templates/AppShell';
import { AuthLayout } from '@/components/templates/AuthLayout';
import { RequireAuth } from './RequireAuth';
import { RouteErrorBoundary } from './RouteErrorBoundary';

/*
 * Every screen is a lazy route. Module agents own the page files in src/pages and must keep
 * each default export. Figma frame ids are in docs/plan/BUILD-PLAN.md section 6.
 */
const HomePage = lazy(() => import('@/pages/HomePage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const ProductKitPage = lazy(() => import('@/pages/ProductKitPage'));
const IdeasPage = lazy(() => import('@/pages/IdeasPage'));
const PlanPage = lazy(() => import('@/pages/PlanPage'));
const BriefsPage = lazy(() => import('@/pages/BriefsPage'));
const BriefPage = lazy(() => import('@/pages/BriefPage'));
const StudioPage = lazy(() => import('@/pages/StudioPage'));
const ReviewListPage = lazy(() => import('@/pages/ReviewListPage'));
const ReviewPage = lazy(() => import('@/pages/ReviewPage'));
const ApprovalsPage = lazy(() => import('@/pages/ApprovalsPage'));
const PublishListPage = lazy(() => import('@/pages/PublishListPage'));
const PublishPage = lazy(() => import('@/pages/PublishPage'));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage'));
const SalesPage = lazy(() => import('@/pages/SalesPage'));
const IntegrationsPage = lazy(() => import('@/pages/IntegrationsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const SchedulePage = lazy(() => import('@/pages/SchedulePage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
// Dev only: the import sits behind the DEV flag so the kit is not in the production bundle.
const UiKitPage = import.meta.env.DEV ? lazy(() => import('@/pages/UiKitPage')) : null;

const errorElement = <RouteErrorBoundary />;

const screen = (path: string, element: ReactNode): RouteObject => ({ path, element, errorElement });

export const appRoutes: RouteObject[] = [
  {
    element: <AuthLayout />,
    errorElement,
    children: [screen('/login', <LoginPage />)],
  },
  {
    element: <RequireAuth />,
    errorElement,
    children: [
      {
        element: <AppShell />,
        errorElement,
        children: [
          { index: true, element: <HomePage />, errorElement },
          screen('/products', <ProductsPage />),
          screen('/products/:productId/kit', <ProductKitPage />),
          screen('/ideas', <IdeasPage />),
          screen('/plan', <PlanPage />),
          screen('/briefs', <BriefsPage />),
          screen('/briefs/:briefId', <BriefPage />),
          // /studio (no id) is the sidebar target; the page asks which brief to open.
          screen('/studio', <StudioPage />),
          screen('/studio/:briefId', <StudioPage />),
          screen('/review', <ReviewListPage />),
          screen('/review/:briefId', <ReviewPage />),
          screen('/approvals', <ApprovalsPage />),
          screen('/publish', <PublishListPage />),
          screen('/publish/:briefId', <PublishPage />),
          screen('/analytics', <AnalyticsPage />),
          screen('/sales', <SalesPage />),
          screen('/schedule', <SchedulePage />),
          screen('/settings', <SettingsPage />),
          screen('/integrations', <IntegrationsPage />),
          ...(UiKitPage ? [screen('/kit', <UiKitPage />)] : []),
          screen('*', <NotFoundPage />),
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes, {
    future: { v7_relativeSplatPath: true },
  });
}
