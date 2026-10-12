import { LockSimple } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { ApprovalDecision, PublishGate } from '@growth-desk/contract';
import { Icon } from '@/components/atoms/Icon';

const DECISION: Record<ApprovalDecision, string> = {
  pending: 'waiting',
  approved: 'approved',
  changes_requested: 'changes requested',
};

function gateText(decision: ApprovalDecision | null): string {
  return decision ? DECISION[decision] : 'not sent';
}

/** Shown when publishing is blocked: both gates must approve the current version. */
export function GateBanner({ gate }: { gate: PublishGate }) {
  if (gate.allowed) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger-soft px-5 py-4 text-danger-text"
    >
      <Icon icon={LockSimple} size={20} className="mt-0.5" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">Publishing is locked</p>
        <p className="text-13">
          {gate.reason ??
            'Both gates must approve the current version before anything is scheduled.'}
        </p>
        <p className="text-xs">
          Claims gate: {gateText(gate.claims)} · Brand gate: {gateText(gate.brand)} ·{' '}
          <Link
            to="/approvals"
            className="focus-ring rounded-sm font-medium underline underline-offset-2"
          >
            Open approvals
          </Link>
        </p>
      </div>
    </div>
  );
}
