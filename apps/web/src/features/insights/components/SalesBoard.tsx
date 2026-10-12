/**
 * Sales kanban (Figma 242:1486): one column per stage, drag a card to move the lead
 * (mouse, touch or keyboard: focus a card, Space to pick up, arrows to move, Space to drop).
 */
import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { LeadStage, LeadView } from '@growth-desk/contract';
import { StatusChip } from '@/components/atoms/StatusChip';
import { cn } from '@/lib/utils';
import { productChipTone } from '../format';
import { sourceLine, STAGE_LABELS } from '../labels';

export function ProductChip({
  lead,
}: {
  lead: Pick<LeadView, 'productShortName' | 'productColor'>;
}) {
  return (
    <StatusChip tone={productChipTone(lead.productColor)} className="uppercase">
      {lead.productShortName}
    </StatusChip>
  );
}

function LeadCard({
  lead,
  selected,
  draggable,
  onSelect,
}: {
  lead: LeadView;
  selected: boolean;
  draggable: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { stage: lead.stage },
    disabled: !draggable,
  });
  return (
    <li>
      <button
        type="button"
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform) }}
        {...listeners}
        {...attributes}
        onClick={() => onSelect(lead.id)}
        aria-pressed={selected}
        aria-label={`${lead.organisation}, ${lead.productShortName}, ${STAGE_LABELS[lead.stage]}. Open details${draggable ? ', or press Space to move' : ''}.`}
        className={cn(
          'focus-ring flex w-full flex-col items-start gap-1.5 rounded-[14px] p-3.5 text-left transition-shadow',
          selected ? 'bg-joy-soft' : 'border border-hairline bg-surface-card hover:shadow-popover',
          isDragging && 'z-10 cursor-grabbing shadow-popover',
          draggable && !isDragging && 'cursor-grab',
        )}
      >
        <span className="text-13 font-semibold text-ink">{lead.organisation}</span>
        <ProductChip lead={lead} />
        <span className="text-2xs text-muted">{sourceLine(lead)}</span>
      </button>
    </li>
  );
}

function Column({
  stage,
  leads,
  selectedId,
  acceptsDrops,
  canMove,
  onSelect,
}: {
  stage: LeadStage;
  leads: LeadView[];
  selectedId: string | null;
  acceptsDrops: boolean;
  canMove: (lead: LeadView) => boolean;
  onSelect: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const headingId = `stage-${stage}`;
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        'flex w-[170px] shrink-0 flex-col gap-2.5 self-start rounded-2xl bg-surface-sunken p-3 transition-colors',
        isOver && 'ring-2 ring-joy',
      )}
    >
      <h2
        id={headingId}
        className="flex items-center justify-between text-2xs font-semibold uppercase tracking-[0.08em] text-muted"
      >
        {STAGE_LABELS[stage]}
        <span aria-label={`${leads.length} leads`}>{leads.length}</span>
      </h2>
      {leads.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-strong px-3 py-4 text-center text-2xs text-muted">
          {acceptsDrops ? 'Drop a lead here' : 'No leads'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {leads.map((l) => (
            <LeadCard
              key={l.id}
              lead={l}
              selected={l.id === selectedId}
              draggable={canMove(l)}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export interface SalesBoardProps {
  stages: readonly LeadStage[];
  leads: LeadView[];
  selectedId: string | null;
  canMove: (lead: LeadView) => boolean;
  onSelect: (id: string) => void;
  onMove: (lead: LeadView, to: LeadStage) => void;
}

export function SalesBoard({
  stages,
  leads,
  selectedId,
  canMove,
  onSelect,
  onMove,
}: SalesBoardProps) {
  const sensors = useSensors(
    // A small distance keeps a plain click working as "open details".
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const byStage = React.useMemo(() => {
    const map = new Map<LeadStage, LeadView[]>(stages.map((s) => [s, []]));
    for (const l of leads) map.get(l.stage)?.push(l);
    return map;
  }, [leads, stages]);

  const acceptsDrops = leads.some(canMove);

  function handleDragEnd(e: DragEndEvent) {
    const to = e.over?.id as LeadStage | undefined;
    const lead = leads.find((l) => l.id === e.active.id);
    if (!lead || !to || to === lead.stage) return;
    onMove(lead, to);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${leads.find((l) => l.id === active.id)?.organisation ?? 'lead'}.`,
          onDragOver: ({ over }) =>
            over ? `Over ${STAGE_LABELS[over.id as LeadStage]}.` : 'Not over a stage.',
          onDragEnd: ({ over }) =>
            over ? `Moved to ${STAGE_LABELS[over.id as LeadStage]}.` : 'Dropped.',
          onDragCancel: () => 'Move cancelled.',
        },
      }}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
          const items = byStage.get(stage) ?? [];
          return (
            <Column
              key={stage}
              stage={stage}
              leads={items}
              selectedId={selectedId}
              acceptsDrops={acceptsDrops}
              canMove={canMove}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </DndContext>
  );
}
