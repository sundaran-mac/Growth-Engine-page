import { cn } from '@/lib/utils';

export interface SpinnerProps {
  size?: number;
  /** Read by screen readers. Set to null when a parent already announces the busy state. */
  label?: string | null;
  className?: string;
}

export function Spinner({ size = 16, label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={cn('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      style={{ width: size, height: size }}
    />
  );
}
