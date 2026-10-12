import { PencilSimple } from '@phosphor-icons/react';
import * as React from 'react';
import {
  LANGUAGE_LABELS,
  LANGUAGES,
  PLATFORM_LABELS,
  PLATFORMS,
  RATIOS,
  type BriefOptions,
  type UserRef,
} from '@growth-desk/contract';
import { Icon } from '@/components/atoms/Icon';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatApprovers, formatChannels, formatLanguages, formatRatios, toggleIn } from './labels';
import type { BriefEditable, BriefPatch } from './use-brief-autosave';

function FactCard({
  label,
  value,
  readOnly,
  children,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-kicker text-muted">
        {label}
        {!readOnly ? (
          <Icon
            icon={PencilSimple}
            size={12}
            className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        ) : null}
      </span>
      <span className="text-13 font-semibold text-ink">{value}</span>
    </>
  );
  const cardClass =
    'group flex min-w-0 flex-col gap-1 rounded-card border border-hairline bg-surface-card p-4 text-left';
  if (readOnly) return <div className={cardClass}>{body}</div>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${value}. Change`}
          className={cn(cardClass, 'focus-ring hover:border-strong')}
        >
          {body}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex flex-col gap-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function ToggleChips<T extends string>({
  legend,
  all,
  selected,
  labelOf,
  onChange,
}: {
  legend: string;
  all: readonly T[];
  selected: readonly T[];
  labelOf: (v: T) => string;
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-13 font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {all.map((v) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleIn(selected, v, all))}
              className={cn(
                'focus-ring rounded-pill border px-3 py-1 text-xs font-semibold transition-colors',
                on
                  ? 'border-joy bg-joy text-ink'
                  : 'border-hairline bg-surface-card text-muted hover:text-ink',
              )}
            >
              {labelOf(v)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const NONE = '__none__';

function PersonSelect({
  label,
  value,
  people,
  current,
  onChange,
}: {
  label: string;
  value: string | null;
  people: UserRef[];
  /** The person stored now, kept in the list even when no longer an option. */
  current: UserRef | null;
  onChange: (id: string | null) => void;
}) {
  const id = React.useId();
  const list = current && !people.some((p) => p.id === current.id) ? [current, ...people] : people;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose a person" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not set</SelectItem>
          {list.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export interface BriefFactsRowProps {
  values: BriefEditable;
  readOnly: boolean;
  options: BriefOptions | undefined;
  /** People stored on the brief now, for display. */
  people: { owner: UserRef | null; claimsApprover: UserRef | null; brandApprover: UserRef | null };
  onChange: (patch: BriefPatch, opts?: { immediate?: boolean }) => void;
}

/** Figma 240:1454: RATIOS, CAPTIONS, CHANNELS, APPROVERS. Each opens a small editor. */
export function BriefFactsRow({ values, readOnly, options, people, onChange }: BriefFactsRowProps) {
  const pick = (list: UserRef[] | undefined, id: string | null, fallback: UserRef | null) =>
    (id ? list?.find((p) => p.id === id) : null) ?? (fallback?.id === id ? fallback : null);
  const brand = pick(options?.brandApprovers, values.brandApproverId, people.brandApprover);
  const claims = pick(options?.claimsApprovers, values.claimsApproverId, people.claimsApprover);

  return (
    <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-4">
      <FactCard label="Ratios" value={formatRatios(values.ratios)} readOnly={readOnly}>
        <ToggleChips
          legend="Ratios"
          all={RATIOS}
          selected={values.ratios}
          labelOf={(r) => r}
          onChange={(ratios) => onChange({ ratios }, { immediate: true })}
        />
      </FactCard>
      <FactCard
        label="Captions"
        value={formatLanguages(values.captionLanguages)}
        readOnly={readOnly}
      >
        <ToggleChips
          legend="Caption languages"
          all={LANGUAGES}
          selected={values.captionLanguages}
          labelOf={(l) => LANGUAGE_LABELS[l]}
          onChange={(captionLanguages) => onChange({ captionLanguages }, { immediate: true })}
        />
      </FactCard>
      <FactCard label="Channels" value={formatChannels(values.channels)} readOnly={readOnly}>
        <ToggleChips
          legend="Channels"
          all={PLATFORMS}
          selected={values.channels}
          labelOf={(p) => PLATFORM_LABELS[p]}
          onChange={(channels) => onChange({ channels }, { immediate: true })}
        />
      </FactCard>
      <FactCard label="Approvers" value={formatApprovers(brand, claims)} readOnly={readOnly}>
        {options ? (
          <>
            <PersonSelect
              label="Brand approver"
              value={values.brandApproverId}
              people={options.brandApprovers}
              current={people.brandApprover}
              onChange={(brandApproverId) => onChange({ brandApproverId }, { immediate: true })}
            />
            <PersonSelect
              label="Claims approver"
              value={values.claimsApproverId}
              people={options.claimsApprovers}
              current={people.claimsApprover}
              onChange={(claimsApproverId) => onChange({ claimsApproverId }, { immediate: true })}
            />
            <PersonSelect
              label="Owner"
              value={values.ownerId}
              people={options.owners}
              current={people.owner}
              onChange={(ownerId) => onChange({ ownerId }, { immediate: true })}
            />
          </>
        ) : (
          <p className="text-13 text-muted">Loading people...</p>
        )}
      </FactCard>
    </div>
  );
}
