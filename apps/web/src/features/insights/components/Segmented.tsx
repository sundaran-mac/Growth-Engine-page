/**
 * Small pill segmented control (single choice) on Radix Toggle Group. Built here because the
 * shared kit has no toggle group yet (reported to the lead for promotion).
 */
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border border-hairline bg-surface-card p-1',
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className="focus-ring rounded-pill px-3 py-1.5 text-13 font-semibold text-muted transition-colors hover:text-ink data-[state=on]:bg-media-canvas data-[state=on]:text-media-text"
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
