import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconComponent } from './Icon';

/**
 * scheduled and care are the same green chip ("Scheduled · auto");
 * reminder and joy are the same orange chip ("Reminder · post by hand").
 */
export type StatusTone = 'scheduled' | 'care' | 'reminder' | 'joy' | 'neutral' | 'danger' | 'success' | 'dark';

const tones: Record<StatusTone, string> = {
  scheduled: 'bg-care-soft text-care-text',
  care: 'bg-care-soft text-care-text',
  reminder: 'bg-joy-soft text-joy-text',
  joy: 'bg-joy-soft text-joy-text',
  neutral: 'bg-surface-sunken text-ink',
  danger: 'bg-danger-soft text-danger-text',
  success: 'bg-success-soft text-success-text',
  dark: 'bg-media-canvas text-media-text',
};

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  icon?: IconComponent;
  /** Small dot before the text. */
  dot?: boolean;
}

/** Pill status label from Figma (Home "Going out today"). 11px semibold. */
export function StatusChip({ tone = 'neutral', icon, dot = false, className, children, ...props }: StatusChipProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-2xs font-semibold',
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {icon ? <Icon icon={icon} size={12} /> : null}
      {children}
    </span>
  );
}
