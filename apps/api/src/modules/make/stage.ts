/**
 * The one guarded way MAKE changes a brief stage. Uses the allowed moves from the contract
 * (`BRIEF_STAGE_TRANSITIONS`) and an optimistic check on stage and version, so two people
 * pressing a button at the same moment cannot both win.
 */
import { and, eq } from 'drizzle-orm';
import { BRIEF_STAGE_LABELS, canMoveBriefStage, type BriefStage } from '@growth-desk/contract';
import type { DbOrTx } from '../../db/client.js';
import { briefs } from '../../db/schema/index.js';
import { writeAudit, type AuditEntry } from '../../lib/audit.js';
import { conflict, unprocessable } from '../../lib/errors.js';
import type { BriefRow } from './repo.js';

export function assertStageMove(from: BriefStage, to: BriefStage): void {
  if (!canMoveBriefStage(from, to)) {
    throw unprocessable(
      `A brief cannot move from ${BRIEF_STAGE_LABELS[from]} to ${BRIEF_STAGE_LABELS[to]}.`,
      'STAGE_NOT_ALLOWED',
    );
  }
}

export const versionConflict = () =>
  conflict('Someone else changed this brief. Reload to see the latest version.', 'VERSION_CONFLICT');

export interface TransitionOptions {
  /** Version the user acted on. A different current version gives 409 VERSION_CONFLICT. */
  expectedVersion: number;
  /** Extra columns to set in the same statement (frozenAt, claim results...). */
  set?: Partial<Pick<BriefRow, 'frozenAt' | 'claimFlags' | 'claims'>>;
  audit: Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'>;
  /** Audit action, for example `brief.freeze`. */
  action: string;
}

export async function transitionBriefStage(
  tx: DbOrTx,
  brief: Pick<BriefRow, 'id' | 'stage' | 'version'>,
  to: BriefStage,
  opts: TransitionOptions,
): Promise<BriefRow> {
  if (brief.version !== opts.expectedVersion) throw versionConflict();
  assertStageMove(brief.stage, to);
  const [row] = await tx
    .update(briefs)
    .set({ stage: to, ...opts.set, updatedAt: new Date() })
    .where(
      and(
        eq(briefs.id, brief.id),
        eq(briefs.stage, brief.stage),
        eq(briefs.version, opts.expectedVersion),
      ),
    )
    .returning();
  if (!row) throw versionConflict();
  await writeAudit(
    {
      ...opts.audit,
      action: opts.action,
      entity: 'brief',
      entityId: brief.id,
      before: { stage: brief.stage, version: brief.version },
      after: { stage: row.stage, version: row.version },
    },
    tx,
  );
  return row;
}
