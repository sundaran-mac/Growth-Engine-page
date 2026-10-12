/**
 * Small editors used by the Product kit screen in edit mode.
 * ChipEditor: add and remove words (never-say, audiences).
 * ItemListEditor: text + spec ref rows (behaviours, not built), add, remove, reorder.
 * LinesEditor: plain lines (truth sources).
 */
import { ArrowDown, ArrowUp, Plus, Trash, X } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { Button } from '@/components/atoms/Button';
import { IconButton } from '@/components/atoms/IconButton';
import { Icon } from '@/components/atoms/Icon';
import { Input } from '@/components/atoms/Input';
import { DURATION, EASE } from '@/components/motion';
import { cn } from '@/lib/utils';

/** Chip enter and exit: a small fade and scale, siblings slide with layout. */
const chipMotion = {
  layout: true,
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.85 },
  transition: { duration: DURATION.fast, ease: EASE },
} as const;

export interface ChipEditorProps {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  tone: 'danger' | 'joy';
  placeholder?: string;
  maxLength?: number;
}

const chipTones = {
  danger: 'bg-danger-soft text-danger-text',
  joy: 'bg-joy-soft text-joy-text',
};

export function ChipEditor({
  label,
  values,
  onChange,
  tone,
  placeholder,
  maxLength = 80,
}: ChipEditorProps) {
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" is already in the list`);
      return;
    }
    onChange([...values, v]);
    setDraft('');
    setError(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2" aria-label={label}>
        <AnimatePresence initial={false} mode="popLayout">
          {values.map((v) => (
            <motion.li
              key={v}
              {...chipMotion}
              className={cn(
                'inline-flex items-center gap-1 rounded-pill py-1 pl-2.5 pr-1 text-2xs font-semibold',
                chipTones[tone],
              )}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="inline-flex size-5 items-center justify-center rounded-full hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${v}`}
              >
                <Icon icon={X} size={12} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
        {values.length === 0 ? <li className="text-13 text-muted">Nothing yet.</li> : null}
      </ul>
      <div className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Add to {label}
        </label>
        <Input
          id={inputId}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={Plus}
          onClick={add}
          disabled={!draft.trim()}
        >
          Add
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SpecItem {
  text: string;
  specRef: string | null;
}

export interface ItemListEditorProps {
  label: string;
  items: SpecItem[];
  onChange: (next: SpecItem[]) => void;
  max: number;
  addLabel: string;
  /** Errors by row index, from validation. */
  errors?: Record<number, string>;
}

export function ItemListEditor({
  label,
  items,
  onChange,
  max,
  addLabel,
  errors = {},
}: ItemListEditorProps) {
  const update = (i: number, patch: Partial<SpecItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [row] = next.splice(i, 1);
    next.splice(i + d, 0, row!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2" aria-label={label}>
        {items.map((it, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`${label} ${i + 1} text`}
                value={it.text}
                maxLength={300}
                onChange={(e) => update(i, { text: e.target.value })}
                className="flex-1"
              />
              <Input
                aria-label={`${label} ${i + 1} spec ref`}
                value={it.specRef ?? ''}
                placeholder="006"
                maxLength={6}
                onChange={(e) =>
                  update(i, {
                    specRef: e.target.value.trim() === '' ? null : e.target.value.trim(),
                  })
                }
                className="w-24"
              />
              <IconButton
                icon={ArrowUp}
                label="Move up"
                size="sm"
                variant="ghost"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              />
              <IconButton
                icon={ArrowDown}
                label="Move down"
                size="sm"
                variant="ghost"
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              />
              <IconButton
                icon={Trash}
                label={`Remove ${label} ${i + 1}`}
                size="sm"
                variant="ghost"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              />
            </div>
            {errors[i] ? (
              <p role="alert" className="text-xs font-medium text-danger-text">
                {errors[i]}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={Plus}
        className="self-start"
        disabled={items.length >= max}
        onClick={() => onChange([...items, { text: '', specRef: null }])}
      >
        {addLabel}
      </Button>
    </div>
  );
}

export function LinesEditor({
  label,
  values,
  onChange,
  max,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2" aria-label={label}>
        {values.map((v, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input
              aria-label={`${label} ${i + 1}`}
              value={v}
              maxLength={200}
              onChange={(e) => onChange(values.map((x, idx) => (idx === i ? e.target.value : x)))}
            />
            <IconButton
              icon={Trash}
              label={`Remove ${label} ${i + 1}`}
              size="sm"
              variant="ghost"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            />
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={Plus}
        className="self-start"
        disabled={values.length >= max}
        onClick={() => onChange([...values, ''])}
      >
        Add source
      </Button>
    </div>
  );
}
