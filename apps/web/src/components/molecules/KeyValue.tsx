import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Kicker } from '@/components/atoms/Kicker';

export interface KeyValueProps {
  /** Kicker label, for example "Owner". */
  label: string;
  value: React.ReactNode;
  /** stacked = label above value (Figma product card). inline = label left, value right. */
  layout?: 'stacked' | 'inline';
  className?: string;
}

/** Label + value pair (Figma Products card "OWNER / Elan"). Renders a dt/dd pair inside a div. */
export function KeyValue({ label, value, layout = 'stacked', className }: KeyValueProps) {
  return (
    <div className={cn(layout === 'stacked' ? 'flex flex-col gap-0.5' : 'flex items-baseline justify-between gap-4', className)}>
      <Kicker as="dt" size="sm">
        {label}
      </Kicker>
      <dd className="text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

/** Wrap KeyValue items in this so the dt/dd markup is valid. */
export function KeyValueList({ className, ...props }: React.HTMLAttributes<HTMLDListElement>) {
  return <dl className={cn('flex flex-col gap-3', className)} {...props} />;
}
