/**
 * Cross-module functions of the MAKE module. Stub created by the lead with the final
 * signatures; the MAKE agent implements the bodies. Other modules import from here only.
 */
import type { Brief } from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import { createBriefFromIdeaTx } from './briefs.service.js';
import { toBriefView } from './repo.js';

export interface CreateBriefFromIdeaInput {
  ideaId: string;
  actorId: string;
  /** Optional plan item to link, when the brief comes from a frozen plan. */
  planItemId?: string;
}

/**
 * Creates a brief (stage `brief`) from an idea, marks the idea `briefed`, writes the audit log.
 * Idempotent: when the idea already has a brief, that brief is returned (and the plan item is
 * linked to it). Errors: 404 NOT_FOUND (idea or plan item), 422 IDEA_PARKED, 400 when the plan
 * item belongs to another product. Pass `tx` to run inside the caller's transaction.
 * The caller checks that the actor may do this.
 */
export async function createBriefFromIdea(input: CreateBriefFromIdeaInput, tx?: DbOrTx): Promise<Brief> {
  if (tx) return toBriefView(await createBriefFromIdeaTx(tx, input), tx);
  const row = await db.transaction((t) => createBriefFromIdeaTx(t, input));
  return toBriefView(row);
}
