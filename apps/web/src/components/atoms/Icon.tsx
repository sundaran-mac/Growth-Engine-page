import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export type IconComponent = PhosphorIcon;

export interface IconProps {
  /** A Phosphor icon component, for example `House` from '@phosphor-icons/react'. */
  icon: PhosphorIcon;
  /** Pixel size. Figma uses 16, 18, 20 and 24. */
  size?: number;
  weight?: IconWeight;
  /** Give a label only when the icon carries meaning on its own. Otherwise it is hidden from screen readers. */
  label?: string;
  className?: string;
}

/** Phosphor icon wrapper: decorative by default, labelled when `label` is set. */
export function Icon({ icon: Glyph, size = 20, weight = 'regular', label, className }: IconProps) {
  return label ? (
    <Glyph size={size} weight={weight} className={cn('shrink-0', className)} role="img" aria-label={label} />
  ) : (
    <Glyph size={size} weight={weight} className={cn('shrink-0', className)} aria-hidden="true" focusable="false" />
  );
}
