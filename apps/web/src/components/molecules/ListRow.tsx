import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconComponent } from '@/components/atoms/Icon';

export type IconTileTone = 'joy' | 'care' | 'neutral' | 'dark' | 'danger';

const tileTones: Record<IconTileTone, string> = {
  joy: 'bg-joy-soft text-ink',
  care: 'bg-care-soft text-care-text',
  neutral: 'bg-surface-sunken text-ink',
  dark: 'bg-media-canvas text-media-text',
  danger: 'bg-danger-soft text-danger-text',
};

export interface IconTileProps {
  icon: IconComponent;
  tone?: IconTileTone;
  className?: string;
}

/** 40px rounded tile holding a 20px icon (Figma Home "Needs you"). */
export function IconTile({ icon, tone = 'joy', className }: IconTileProps) {
  return (
    <span className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-tile', tileTones[tone], className)}>
      <Icon icon={icon} size={20} />
    </span>
  );
}

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  icon?: IconComponent;
  iconTone?: IconTileTone;
  /** Anything in place of the icon tile (an avatar, a time, a dot). */
  leading?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** Right side: a Button, a StatusChip, a menu. */
  action?: React.ReactNode;
  as?: 'div' | 'li';
}

/** Row with icon tile + title + meta + action (Figma Home "Needs you"). */
export function ListRow({ icon, iconTone = 'joy', leading, title, meta, action, as: Comp = 'div', className, ...props }: ListRowProps) {
  return (
    <Comp className={cn('flex w-full items-center gap-3.5 py-1.5', className)} {...props}>
      {leading ?? (icon ? <IconTile icon={icon} tone={iconTone} /> : null)}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-sm font-semibold text-ink">{title}</div>
        {meta ? <div className="truncate text-xs text-muted">{meta}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </Comp>
  );
}
