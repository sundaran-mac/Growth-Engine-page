import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLElement> {
  /** Render a <span> (inline-block) so it can sit inside headings and paragraphs. */
  inline?: boolean;
}

const base =
  'relative overflow-hidden rounded-tile bg-surface-sunken before:absolute before:inset-0 before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/55 before:to-transparent motion-reduce:before:hidden';

/** Loading placeholder: beige block with a soft light sweep (static when reduced motion is on). */
export function Skeleton({ className, inline = false, ...props }: SkeletonProps) {
  if (inline) {
    return (
      <span
        aria-hidden="true"
        className={cn(base, 'inline-block align-middle', className)}
        {...props}
      />
    );
  }
  return <div aria-hidden="true" className={cn(base, className)} {...props} />;
}
