import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-hairline bg-surface-sunken px-1.5 font-sans text-2xs font-semibold text-muted',
        className,
      )}
      {...props}
    />
  );
}
