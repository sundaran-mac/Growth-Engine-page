import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Heading level. Pages already have an h1 in the TopBar, so the default is h2. */
  as?: 'h2' | 'h3';
  className?: string;
}

/** Section header inside page content: title, description, actions on the right. */
export function PageHeader({ title, description, actions, as: Heading = 'h2', className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end gap-3', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Heading className="text-lg font-bold text-ink">{title}</Heading>
        {description ? <p className="text-13 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}
