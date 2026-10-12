import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { LogoMark } from '@/components/atoms/LogoMark';
import { Spinner } from '@/components/atoms/Spinner';

/**
 * PLACEHOLDER DESIGN: there is no Figma frame for sign in. Built in the same design language
 * (media canvas panel, joy accents, Poppins, 20px cards). Replace when a frame exists.
 */
export function AuthLayout() {
  return (
    <div className="grid min-h-screen bg-surface-base lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="hidden flex-col justify-between bg-media-canvas p-10 text-media-text lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div className="flex flex-col">
            <span className="text-17 font-bold">Growth Desk</span>
            <span className="text-2xs text-muted">Humini ecosystem</span>
          </div>
        </div>
        <div className="flex max-w-md flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-kicker text-joy">Plan · Make · Ship · Learn</p>
          <p className="text-2xl font-bold">Claude drafts. People decide. Tools do the repeating.</p>
          <p className="text-sm text-media-text/70">
            One place to plan, make, approve, publish, measure and sell, for every Humini product.
          </p>
        </div>
        <p className="text-2xs text-muted">Nothing goes public without both approvals.</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <Suspense fallback={<Spinner size={24} />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
