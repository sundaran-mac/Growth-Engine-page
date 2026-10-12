/**
 * Lead detail (Figma 242:1620): source, who, first offer, owner, next step, move and log, and
 * the activity log.
 */
import * as React from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { LEAD_STAGES, PLATFORM_LABELS, type LeadStage, type LeadView } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Kicker } from '@/components/atoms/Kicker';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Panel } from '@/components/organisms/Panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLeadActivities } from '../api';
import { nextStageOf, sourceLine, STAGE_LABELS } from '../labels';
import { ProductChip } from './SalesBoard';

function nextStepText(lead: LeadView): string {
  if (!lead.nextStep && !lead.nextStepAt) return 'Not set';
  const when = lead.nextStepAt
    ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(
        new Date(lead.nextStepAt),
      )
    : null;
  return [lead.nextStep, when].filter(Boolean).join(' · ');
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // Figma: label and value are siblings with the same 12px gap as the rest of the panel.
    <>
      <Kicker as="dt" size="sm" className="tracking-kicker">
        {label}
      </Kicker>
      <dd className="text-sm font-medium text-ink">{children}</dd>
    </>
  );
}

function when(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export interface LeadDetailPanelProps {
  lead: LeadView;
  canEdit: boolean;
  moving: boolean;
  onMove: (to: LeadStage) => void;
  onLog: () => void;
  onEdit: () => void;
}

export function LeadDetailPanel({
  lead,
  canEdit,
  moving,
  onMove,
  onLog,
  onEdit,
}: LeadDetailPanelProps) {
  const activities = useLeadActivities(lead.id);
  const next = nextStageOf(lead.stage);
  const source = [
    sourceLine(lead),
    lead.sourcePostBriefCode
      ? `from ${lead.sourcePostBriefCode}${lead.sourcePostPlatform ? ` on ${PLATFORM_LABELS[lead.sourcePostPlatform]}` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Panel
      title={lead.organisation}
      aria-label={`Lead ${lead.organisation}`}
      actions={
        canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={PencilSimple}
            // Keep the header as tall as the 18px title (Figma has no button here).
            className="-my-1.5"
            onClick={onEdit}
            aria-label={`Edit ${lead.organisation}`}
          >
            Edit
          </Button>
        ) : null
      }
    >
      <div className="flex gap-2">
        <ProductChip lead={lead} />
        <StatusChip tone="neutral" className="uppercase">
          {STAGE_LABELS[lead.stage]}
        </StatusChip>
      </div>
      <dl className="flex flex-col gap-3">
        <Item label="Source">{source}</Item>
        <Item label="Who">{lead.who ?? 'Not set'}</Item>
        <Item label="First offer">{lead.firstOffer ?? 'Not set'}</Item>
        <Item label="Owner">{lead.owner?.name ?? lead.ownerNote ?? 'Not set'}</Item>
        <Item label="Next step">{nextStepText(lead)}</Item>
      </dl>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {next ? (
            <Button loading={moving} onClick={() => onMove(next)}>
              Move to {STAGE_LABELS[next]}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onLog}>
            Log call
          </Button>
          <Select
            value={lead.stage}
            onValueChange={(v) => v !== lead.stage && onMove(v as LeadStage)}
          >
            <SelectTrigger className="h-9 w-auto min-w-[140px]" aria-label="Move to stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="mt-2 flex flex-col gap-2 border-t border-hairline pt-4">
        <Kicker as="h3" size="sm" className="tracking-kicker">
          Activity
        </Kicker>
        {activities.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : activities.isError ? (
          <ErrorState
            error={activities.error}
            onRetry={() => void activities.refetch()}
            className="py-6"
          />
        ) : activities.data.items.length === 0 ? (
          <p className="text-13 text-muted">Nothing logged yet.</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {activities.data.items.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5">
                <span className="text-13 text-ink">
                  {a.kind === 'stage_change'
                    ? `Moved ${a.fromStage ? STAGE_LABELS[a.fromStage] : ''} to ${a.toStage ? STAGE_LABELS[a.toStage] : ''}${a.body ? `: ${a.body}` : ''}`
                    : `${a.kind[0]!.toUpperCase()}${a.kind.slice(1)}: ${a.body ?? ''}`}
                </span>
                <span className="text-2xs text-muted">
                  {a.actor?.name ?? 'Growth Desk'} · {when(a.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
