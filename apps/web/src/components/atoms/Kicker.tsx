import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface KickerProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'p' | 'span' | 'h2' | 'h3' | 'h4' | 'dt' | 'div';
  /** md = stat tile label (12px, 0.08em). sm = sidebar group label (11px, 0.12em). */
  size?: 'sm' | 'md';
  tone?: 'muted' | 'joy' | 'ink' | 'care';
}

const tones = { muted: 'text-muted', joy: 'text-joy-text', ink: 'text-ink', care: 'text-care-text' };

/** Small caps label like "REACH · 7 DAYS". Write the text in normal case or caps; it is shown uppercase. */
export function Kicker({ as: Comp = 'p', size = 'md', tone = 'muted', className, ...props }: KickerProps) {
  return (
    <Comp
      className={cn(
        'font-semibold uppercase',
        size === 'md' ? 'text-xs tracking-kicker' : 'text-2xs tracking-group',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Alias: section label. */
export const SectionLabel = Kicker;
