import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-1 text-2xs font-semibold',
  {
    variants: {
      tone: {
        care: 'bg-care-soft text-care-text',
        joy: 'bg-joy-soft text-joy-text',
        neutral: 'bg-surface-sunken text-ink',
        danger: 'bg-danger-soft text-danger-text',
        success: 'bg-success-soft text-success-text',
        dark: 'bg-media-canvas text-media-text',
        solid: 'bg-joy text-ink',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
