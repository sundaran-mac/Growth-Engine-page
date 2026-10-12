import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Dot colour when the product has no colour set (border/strong). */
const FALLBACK = '#d4ccbc';

export interface ProductDotProps {
  /** Product colour from the API (`product.color`). */
  color?: string | null;
  /** Product name next to the dot. Leave out to show only the dot. */
  name?: React.ReactNode;
  /** Muted text after the name, for example "9 pieces this week". */
  meta?: React.ReactNode;
  size?: number;
  className?: string;
}

/** 10px colour dot + product name, as in the Figma sidebar switcher and Home "Products" card. */
export function ProductDot({ color, name, meta, size = 10, className }: ProductDotProps) {
  const dot = (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: color || FALLBACK }}
    />
  );
  if (!name && !meta) return dot;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      {dot}
      {name ? <span className="truncate text-sm font-semibold text-ink">{name}</span> : null}
      {meta ? <span className="truncate text-xs text-muted">{meta}</span> : null}
    </span>
  );
}
