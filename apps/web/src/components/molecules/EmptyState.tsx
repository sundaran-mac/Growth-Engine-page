import { Sparkle } from '@phosphor-icons/react';
import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconComponent } from '@/components/atoms/Icon';

export interface EmptyStateProps {
  icon?: IconComponent;
  title: string;
  description?: React.ReactNode;
  /** Usually one Button. */
  action?: React.ReactNode;
  /** Draw inside a card (default) or bare. */
  bordered?: boolean;
  className?: string;
}

export function EmptyState({ icon = Sparkle, title, description, action, bordered = true, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        bordered && 'rounded-card border border-dashed border-strong bg-surface-card',
        className,
      )}
    >
      <span className="inline-flex size-12 items-center justify-center rounded-tile bg-joy-soft text-joy-text">
        <Icon icon={icon} size={24} />
      </span>
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2 flex items-center gap-3">{action}</div> : null}
    </div>
  );
}
