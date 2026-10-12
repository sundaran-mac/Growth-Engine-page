import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PageTransition } from '@/components/motion';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { CommandPalette } from '@/components/organisms/CommandPalette';
import { Sidebar } from '@/components/organisms/Sidebar';
import { useUiStore } from '@/stores/ui';

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading page">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[117px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-card" />
    </div>
  );
}

/**
 * Signed-in layout: 264px dark sidebar + content on surface/base (Figma 1440 frame:
 * content starts 40px right of the sidebar, 36px from the top).
 * Below 1024px the sidebar becomes a drawer opened from the top bar menu button.
 */
export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  return (
    <div className="min-h-screen bg-surface-base">
      <a
        href="#main"
        className="sr-only z-[60] rounded-pill bg-joy px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden lg:block" aria-label="Sidebar">
        <Sidebar />
      </aside>
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-sidebar max-w-none border-0 bg-media-canvas p-0 lg:hidden">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="lg:pl-[264px]">
        <main id="main" tabIndex={-1} className="min-w-0 px-6 pb-12 pt-9 outline-none xl:px-10">
          <Suspense fallback={<PageSkeleton />}>
            <RouteFade />
          </Suspense>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}

/** Each screen eases in when the path changes (not on query-string changes like ?tab=). */
function RouteFade() {
  const { pathname } = useLocation();
  return (
    <PageTransition key={pathname}>
      <Outlet />
    </PageTransition>
  );
}
