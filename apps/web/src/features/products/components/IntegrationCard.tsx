import type * as React from 'react';
import { Icon, type IconComponent } from '@/components/atoms/Icon';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { StaggerItem } from '@/components/motion';
import { Skeleton } from '@/components/ui/skeleton';

export interface IntegrationCardProps {
  icon: IconComponent;
  name: string;
  description: string | null;
  statusLabel: string;
  statusTone: StatusTone;
  /** Extra line under the chip (handle, why it is off, last error). */
  note?: React.ReactNode;
  /** Connect or disconnect buttons. */
  actions?: React.ReactNode;
}

/**
 * One card on the Integrations grid (Figma 242:1642): icon tile, name, description, status chip.
 * Renders a StaggerItem, so the parent list should be a `Stagger as="ul"`.
 */
export function IntegrationCard({
  icon,
  name,
  description,
  statusLabel,
  statusTone,
  note,
  actions,
}: IntegrationCardProps) {
  return (
    <StaggerItem
      as="li"
      className="flex min-w-0 flex-col gap-2 rounded-card border border-hairline bg-surface-card p-5"
    >
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-sunken text-ink">
          <Icon icon={icon} size={20} />
        </span>
        <h3 className="truncate text-[15px] font-bold leading-[1.4] text-ink">{name}</h3>
      </div>
      {description ? <p className="text-13 text-muted">{description}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={statusTone}>{statusLabel}</StatusChip>
      </div>
      {note ? <div className="text-xs text-muted">{note}</div> : null}
      {actions ? <div className="mt-auto flex flex-wrap gap-2 pt-1">{actions}</div> : null}
    </StaggerItem>
  );
}

export function IntegrationCardSkeleton() {
  return (
    <li
      className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-card p-5"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-9 rounded-[10px]" />
        <Skeleton className="h-5 w-32" />
      </div>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-6 w-24 rounded-pill" />
    </li>
  );
}
