/**
 * Small pieces shared by the Settings tabs. Placeholder design until Jeeva designs Settings in
 * Figma; built in the house style (Poppins, cream surface, white hairline cards, pill buttons,
 * joy orange accents).
 */
import { LockSimple } from '@phosphor-icons/react';
import * as React from 'react';
import { WEEKDAY_LABELS, type Platform } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { WEEKDAY_ORDER } from '../draft';
import { PLATFORM_ICONS, platformLabel, timeZoneOptions } from '../format';

/* ---------- Unsaved changes ---------- */

/** Sticky bar at the bottom of a form with unsaved changes. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  disabled = false,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <div
      className={cn(
        'sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-surface-card px-5 py-3 shadow-overlay transition-opacity',
        dirty ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!dirty}
    >
      <p className="text-sm font-medium text-ink" role="status">
        {dirty ? 'You have unsaved changes.' : ''}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onDiscard}
          disabled={!dirty || saving}
          tabIndex={dirty ? 0 : -1}
        >
          Discard
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          loading={saving}
          disabled={!dirty}
          tabIndex={dirty ? 0 : -1}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

export function ReadOnlyNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="flex items-center gap-2 rounded-tile bg-surface-sunken px-4 py-3 text-13 text-muted">
      <Icon icon={LockSimple} size={16} />
      Read only. Only the product owner or an admin can change these settings.
    </p>
  );
}

/** Two-column row inside a card: label and help on the left, control on the right. */
export function SettingRow({
  title,
  help,
  children,
  htmlFor,
}: {
  title: string;
  help?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid gap-3 border-t border-hairline py-4 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-8">
      <div className="flex flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
            {title}
          </label>
        ) : (
          <span className="text-sm font-semibold text-ink">{title}</span>
        )}
        {help ? <p className="text-xs text-muted">{help}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ---------- Chips and badges ---------- */

/** Pill toggle (aria-pressed), used for modes and languages. */
export function ChipToggle({
  pressed,
  onPressedChange,
  disabled,
  children,
  className,
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'focus-ring inline-flex h-9 items-center rounded-pill border px-3.5 text-13 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        pressed
          ? 'border-joy bg-joy-soft text-joy-text'
          : 'border-strong bg-surface-card text-ink hover:bg-surface-sunken',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PlatformBadge({
  platform,
  showLabel = true,
  className,
}: {
  platform: Platform;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-sm font-semibold text-ink', className)}
    >
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-tile bg-surface-sunken">
        <Icon
          icon={PLATFORM_ICONS[platform]}
          size={16}
          label={showLabel ? undefined : platformLabel(platform)}
        />
      </span>
      {showLabel ? platformLabel(platform) : null}
    </span>
  );
}

/* ---------- Selects ---------- */

export function TimeZoneSelect({
  id,
  value,
  onChange,
  disabled,
  label,
}: {
  id?: string;
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const options = React.useMemo(() => timeZoneOptions(value), [value]);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue placeholder="Choose a time zone" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {tz.replace(/_/g, ' ')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Monday-first weekday picker. Values follow JS getDay (0 = Sunday). */
export function WeekdaySelect({
  id,
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  id?: string;
  value: number;
  onChange: (d: number) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {WEEKDAY_ORDER.map((d) => (
          <SelectItem key={d} value={String(d)}>
            {WEEKDAY_LABELS[d]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TabSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-card bg-surface-sunken" />
      ))}
    </div>
  );
}
