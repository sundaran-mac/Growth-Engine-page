import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Plus } from '@phosphor-icons/react';
import * as React from 'react';
import type { Occasion, PlanItemView } from '@growth-desk/contract';
import { cn } from '@/lib/utils';
import { MODE_PLAN_CLASS, NO_MODE_PLAN_CLASS, calendarWeeks, dayOfMonth, longDate } from '../lib';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface PlanCalendarProps {
  month: string;
  items: PlanItemView[];
  occasions: Occasion[];
  /** False when the plan is frozen or the user cannot edit: no dragging, no adding. */
  editable: boolean;
  onMove: (item: PlanItemView, date: string) => void;
  onAdd: (date: string) => void;
  onOpenItem: (item: PlanItemView) => void;
}

function itemLabel(item: PlanItemView): string {
  return item.mode ? `${item.mode} · ${item.title}` : item.title;
}

function ItemChip({ item, dragging = false }: { item: PlanItemView; dragging?: boolean }) {
  return (
    <span
      className={cn(
        'block w-full rounded-md px-2 py-1.5 text-left text-[10px] font-semibold leading-[1.4] [overflow-wrap:anywhere]',
        item.mode ? MODE_PLAN_CLASS[item.mode] : NO_MODE_PLAN_CLASS,
        item.needsShootSlot && 'ring-2 ring-inset ring-danger/60',
        dragging && 'shadow-popover',
      )}
    >
      {itemLabel(item)}
      {item.briefCode ? <span className="mt-0.5 block font-medium opacity-80">{item.briefCode}</span> : null}
    </span>
  );
}

function DraggableItem({ item, editable, onOpen }: { item: PlanItemView; editable: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled: !editable, data: { item } });
  const extra = [item.needsShootSlot ? 'needs a shoot slot' : null, item.briefCode ? `brief ${item.briefCode}` : null]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      aria-label={`${itemLabel(item)}${extra ? `, ${extra}` : ''}. ${editable ? 'Press space to pick up and move, or enter to edit.' : 'Open.'}`}
      className={cn('focus-ring w-full rounded-md', editable && 'cursor-grab active:cursor-grabbing', isDragging && 'opacity-40')}
      {...attributes}
      {...(editable ? listeners : {})}
    >
      <ItemChip item={item} />
    </button>
  );
}

function DayCell({
  date,
  inMonth,
  editable,
  children,
  onAdd,
}: {
  date: string;
  inMonth: boolean;
  editable: boolean;
  children: React.ReactNode;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: !inMonth || !editable });
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={longDate(date)}
      className={cn(
        'group/day relative flex min-h-[128px] min-w-0 flex-col gap-1.5 border border-hairline p-2 transition-colors',
        !inMonth && 'bg-surface-base/60',
        isOver && 'bg-joy-soft/60',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('text-xs font-semibold', inMonth ? 'text-ink' : 'text-muted')}>{dayOfMonth(date)}</span>
        {inMonth && editable ? (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add a piece on ${longDate(date)}`}
            className="focus-ring inline-flex size-6 items-center justify-center rounded-pill text-muted opacity-0 transition-opacity hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 group-hover/day:opacity-100"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {inMonth ? children : null}
    </div>
  );
}

/** Month calendar, Monday first (Figma 240:1153). Pieces drag between days. */
export function PlanCalendar({ month, items, occasions, editable, onMove, onAdd, onOpenItem }: PlanCalendarProps) {
  const weeks = React.useMemo(() => calendarWeeks(month), [month]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks up and drops; Enter stays free to open the piece.
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );
  const [active, setActive] = React.useState<PlanItemView | null>(null);

  const byDay = React.useMemo(() => {
    const map = new Map<string, PlanItemView[]>();
    for (const i of items) map.set(i.date, [...(map.get(i.date) ?? []), i]);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [items]);

  const occasionsByDay = React.useMemo(() => {
    const map = new Map<string, Occasion[]>();
    for (const o of occasions) map.set(o.date, [...(map.get(o.date) ?? []), o]);
    return map;
  }, [occasions]);

  function handleStart(e: DragStartEvent) {
    setActive(items.find((i) => i.id === e.active.id) ?? null);
  }

  function handleEnd(e: DragEndEvent) {
    setActive(null);
    const item = items.find((i) => i.id === e.active.id);
    const target = e.over?.id;
    if (item && typeof target === 'string' && target !== item.date) onMove(item, target);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setActive(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active: a }) => `Picked up ${itemLabel((a.data.current as { item: PlanItemView }).item)}.`,
          onDragOver: ({ over }) => (over ? `Over ${longDate(String(over.id))}.` : 'Not over a day.'),
          onDragEnd: ({ over }) => (over ? `Moved to ${longDate(String(over.id))}.` : 'Dropped. Nothing moved.'),
          onDragCancel: () => 'Move cancelled.',
        },
      }}
    >
      <div className="overflow-x-auto">
        <div role="grid" aria-label="Month calendar" className="min-w-[640px]">
          <div role="row" className="grid grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div role="columnheader" key={d} className="px-2 pb-2 text-xs font-semibold text-muted">
                {d}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {weeks.map((row) => (
              <div role="row" key={row[0]} className="grid grid-cols-7">
                {row.map((date) => {
                  const inMonth = date.startsWith(month);
                  const dayItems = byDay.get(date) ?? [];
                  const linked = new Set(dayItems.map((i) => i.occasionId).filter(Boolean));
                  const dayOccasions = (occasionsByDay.get(date) ?? []).filter((o) => !linked.has(o.id));
                  return (
                    <DayCell key={date} date={date} inMonth={inMonth} editable={editable} onAdd={() => onAdd(date)}>
                      {dayItems.map((item) => (
                        <DraggableItem key={item.id} item={item} editable={editable} onOpen={() => onOpenItem(item)} />
                      ))}
                      {dayOccasions.map((o) => (
                        <span
                          key={o.id}
                          className="block rounded-md bg-surface-sunken px-2 py-1.5 text-[10px] font-semibold leading-[1.4] text-ink"
                          title={o.notes ?? undefined}
                        >
                          {o.name}
                        </span>
                      ))}
                    </DayCell>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>{active ? <ItemChip item={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
