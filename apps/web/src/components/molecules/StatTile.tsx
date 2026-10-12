import * as React from 'react';
import { useCountUp } from '@/components/motion';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Kicker } from '@/components/atoms/Kicker';

export type StatDeltaTone = 'joy' | 'care' | 'muted' | 'danger';

export interface StatTileProps {
  /** Kicker text, for example "Reach · 7 days". */
  label: string;
  value: React.ReactNode;
  /** Line under the value, for example "+12% vs last week". */
  delta?: React.ReactNode;
  deltaTone?: StatDeltaTone;
  loading?: boolean;
  className?: string;
}

const deltaTones: Record<StatDeltaTone, string> = {
  joy: 'text-joy-text',
  care: 'text-care-text',
  muted: 'text-muted',
  danger: 'text-danger-text',
};

/** The big number. Strings and numbers count up once on first mount; other nodes render as they are. */
function StatValue({ value }: { value: React.ReactNode }) {
  const ref = React.useRef<HTMLParagraphElement>(null);
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  useCountUp(ref, text);
  return (
    <p ref={ref} className="text-stat font-bold tabular-nums text-ink">
      {text ?? value}
    </p>
  );
}

/** Figma "Stat tile" (237:784): card, 20px radius, 20px padding, 30px bold value. */
export function StatTile({
  label,
  value,
  delta,
  deltaTone = 'joy',
  loading = false,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-start gap-1 rounded-card border border-hairline bg-surface-card p-5',
        className,
      )}
      aria-busy={loading || undefined}
    >
      <Kicker as="p" className="w-full truncate">
        {label}
      </Kicker>
      {loading ? (
        <>
          <Skeleton className="h-[33px] w-24" />
          <Skeleton className="h-4 w-32" />
        </>
      ) : (
        <>
          <StatValue value={value} />
          {delta ? (
            <p className={cn('text-xs font-medium', deltaTones[deltaTone])}>{delta}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
