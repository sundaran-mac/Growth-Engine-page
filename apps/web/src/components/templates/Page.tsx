import * as React from 'react';
import { cn } from '@/lib/utils';
import { TopBar } from '@/components/organisms/TopBar';

export interface PageProps {
  /** Shown in the top bar (h1) and in the browser tab. */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Primary action slot in the top bar. */
  actions?: React.ReactNode;
  /** Browser tab text when `title` is not a plain string. */
  documentTitle?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Every screen starts with this: top bar + content column with 24px gaps (Figma Home layout).
 *   export default function IdeasPage() { return <Page title="Ideas" actions={...}>...</Page>; }
 */
export function Page({ title, subtitle, actions, documentTitle, className, children }: PageProps) {
  const tabTitle = documentTitle ?? (typeof title === 'string' ? title : undefined);
  React.useEffect(() => {
    if (tabTitle) document.title = `${tabTitle} · Growth Desk`;
  }, [tabTitle]);

  return (
    <div className="flex flex-col gap-6">
      <TopBar title={title} subtitle={subtitle} actions={actions} />
      <div className={cn('flex min-w-0 flex-col gap-6', className)}>{children}</div>
    </div>
  );
}
