import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, DotsSixVertical, Plus, Trash } from '@phosphor-icons/react';
import * as React from 'react';
import { BRIEF_BEATS_MAX, BRIEF_TEXT_MAX } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { IconButton } from '@/components/atoms/IconButton';
import { Textarea } from '@/components/atoms/Input';
import { cn } from '@/lib/utils';
import type { BriefPatch } from './use-brief-autosave';

const fieldClass =
  'min-h-[44px] resize-none rounded-[10px] border-transparent bg-surface-base text-sm font-medium [field-sizing:content] read-only:cursor-default read-only:focus-visible:ring-0';

interface TextFieldProps {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  placeholder?: string;
  trailing?: React.ReactNode;
  dragHandle?: React.ReactNode;
}

function BriefTextField({ label, value, readOnly, onChange, onBlur, placeholder, trailing, dragHandle }: TextFieldProps) {
  const id = React.useId();
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex min-h-6 items-center gap-1">
        {dragHandle}
        <label htmlFor={id} className="flex-1 text-2xs font-semibold uppercase tracking-kicker text-muted">
          {label}
        </label>
        {trailing}
      </div>
      <Textarea
        id={id}
        rows={1}
        value={value}
        readOnly={readOnly}
        maxLength={BRIEF_TEXT_MAX}
        placeholder={readOnly ? undefined : placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={fieldClass}
      />
    </div>
  );
}

interface SortableBeatProps {
  id: string;
  index: number;
  count: number;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}

function SortableBeat({ id, index, count, value, readOnly, onChange, onBlur, onMove, onRemove }: SortableBeatProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: readOnly,
  });
  const label = `Beat ${index + 1}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('list-none', isDragging && 'relative z-10 opacity-80')}
    >
      <BriefTextField
        label={label}
        value={value}
        readOnly={readOnly}
        onChange={onChange}
        onBlur={onBlur}
        placeholder="One line the viewer hears or sees"
        dragHandle={
          readOnly ? null : (
            <button
              type="button"
              ref={setActivatorNodeRef}
              aria-label={`Drag ${label}`}
              className="focus-ring -ml-1 inline-flex size-6 cursor-grab items-center justify-center rounded-md text-muted hover:text-ink"
              {...attributes}
              {...listeners}
            >
              <DotsSixVertical size={14} aria-hidden="true" />
            </button>
          )
        }
        trailing={
          readOnly ? null : (
            <div className="flex items-center">
              <IconButton icon={ArrowUp} label={`Move ${label} up`} variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(index - 1)} />
              <IconButton
                icon={ArrowDown}
                label={`Move ${label} down`}
                variant="ghost"
                size="sm"
                disabled={index === count - 1}
                onClick={() => onMove(index + 1)}
              />
              <IconButton icon={Trash} label={`Remove ${label}`} variant="ghost" size="sm" onClick={onRemove} />
            </div>
          )
        }
      />
    </li>
  );
}

export interface BriefEditorCardProps {
  hook: string | null;
  beats: string[];
  ask: string | null;
  readOnly: boolean;
  onChange: (patch: BriefPatch) => void;
  /** Save now (on blur). */
  onFlush: () => void;
}

const nullIfEmpty = (v: string) => (v.trim() === '' ? null : v);

/** Figma 240:1433: HOOK, BEAT n and ASK on sunken fields inside one card. */
export function BriefEditorCard({ hook, beats, ask, readOnly, onChange, onFlush }: BriefEditorCardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = beats.map((_, i) => `beat-${i}`);

  const setBeat = (i: number, v: string) => onChange({ beats: beats.map((b, j) => (j === i ? v : b)) });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= beats.length) return;
    onChange({ beats: arrayMove(beats, from, to) });
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
  };

  return (
    <section aria-label="Script" className="flex w-full flex-col gap-3 rounded-card border border-hairline bg-surface-card p-6">
      <BriefTextField
        label="Hook (0-2 s)"
        value={hook ?? ''}
        readOnly={readOnly}
        onChange={(v) => onChange({ hook: nullIfEmpty(v) })}
        onBlur={onFlush}
        placeholder="The first line. Make them stay."
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol aria-label="Beats" className="flex flex-col gap-3">
            {beats.map((b, i) => (
              <SortableBeat
                key={ids[i]}
                id={ids[i]!}
                index={i}
                count={beats.length}
                value={b}
                readOnly={readOnly}
                onChange={(v) => setBeat(i, v)}
                onBlur={onFlush}
                onMove={(to) => move(i, to)}
                onRemove={() => onChange({ beats: beats.filter((_, j) => j !== i) })}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {!readOnly && beats.length < BRIEF_BEATS_MAX ? (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={Plus}
          className="self-start"
          onClick={() => onChange({ beats: [...beats, ''] })}
        >
          Add beat
        </Button>
      ) : null}
      <BriefTextField
        label="Ask"
        value={ask ?? ''}
        readOnly={readOnly}
        onChange={(v) => onChange({ ask: nullIfEmpty(v) })}
        onBlur={onFlush}
        placeholder="What should the viewer do next?"
      />
    </section>
  );
}
