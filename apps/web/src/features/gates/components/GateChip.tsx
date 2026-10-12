import type { Approval } from '@growth-desk/contract';
import { cn } from '@/lib/utils';
import { GATE_NAMES, GATE_STATE_TEXT, gateState } from '../format';

const tones = {
  approved: { box: 'bg-care-soft', state: 'text-care-text' },
  changes: { box: 'bg-danger-soft', state: 'text-danger-text' },
  yours: { box: 'bg-joy-soft', state: 'text-joy-text' },
  waiting: { box: 'bg-surface-sunken', state: 'text-muted' },
} as const;

export interface GateChipProps {
  approval: Approval;
  /** Approval ids the signed-in user may decide now. */
  decidableIds: ReadonlySet<string>;
  className?: string;
}

/** "Brand · Elan  Approved" (Figma 241:1513). */
export function GateChip({ approval, decidableIds, className }: GateChipProps) {
  const state = gateState(approval, decidableIds);
  const who = approval.decidedBy?.name ?? approval.approver?.name ?? 'No approver';
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-tile px-3.5 py-2.5 text-13',
        tones[state].box,
        className,
      )}
      data-state={state}
    >
      <span className="font-semibold text-ink">
        {GATE_NAMES[approval.gate]} · {who}
      </span>
      <span className={tones[state].state}>{GATE_STATE_TEXT[state]}</span>
      {state !== 'approved' && approval.escalatedAt ? (
        <span className="text-muted">· with backup</span>
      ) : null}
    </div>
  );
}
