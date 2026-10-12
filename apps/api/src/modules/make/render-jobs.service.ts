/**
 * Render jobs are hand-off records: a maker renders in their own tool (reel studio, CapCut...)
 * and updates the job here by hand, or by attaching the uploaded result.
 */
import { and, asc, eq } from 'drizzle-orm';
import {
  canMoveRenderJob,
  isBriefMaking,
  type CreateRenderJobInput,
  type HandoffTool,
  type HandoffToolKey,
  type RenderJob,
  type RenderJobListResponse,
  type RenderJobStatus,
  type UpdateRenderJobInput,
} from '@growth-desk/contract';
import { db } from '../../db/client.js';
import { assets, renderJobs } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { assertMakeAccess, auditOf, type Actor } from './access.js';
import { loadBriefFor } from './briefs.service.js';
import { findBrief, toRenderJobView, type RenderJobRow } from './repo.js';

export async function listRenderJobs(actor: Actor, briefId: string): Promise<RenderJobListResponse> {
  await loadBriefFor(actor, briefId, 'read');
  const rows = await db
    .select()
    .from(renderJobs)
    .where(eq(renderJobs.briefId, briefId))
    .orderBy(asc(renderJobs.createdAt));
  return { items: rows.map(toRenderJobView), total: rows.length };
}

async function assertAssetOfBrief(assetId: string, briefId: string, mustBeReady: boolean): Promise<void> {
  const [asset] = await db
    .select({ id: assets.id, status: assets.status })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.briefId, briefId)));
  if (!asset) throw badRequest('That file does not belong to this brief.');
  if (mustBeReady && asset.status !== 'ready') {
    throw unprocessable('That file is not ready yet.', 'ASSET_NOT_READY');
  }
}

export async function createRenderJob(
  actor: Actor,
  briefId: string,
  input: Required<Pick<CreateRenderJobInput, 'kind' | 'label'>> & {
    tool: string | null;
    assetId: string | null;
  },
): Promise<RenderJob> {
  const brief = await loadBriefFor(actor, briefId, 'write');
  if (!isBriefMaking(brief.stage)) {
    throw unprocessable('Add render jobs while the brief is frozen or being made.', 'STAGE_NOT_ALLOWED');
  }
  if (input.assetId) await assertAssetOfBrief(input.assetId, brief.id, false);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(renderJobs)
      .values({
        briefId: brief.id,
        kind: input.kind,
        label: input.label,
        tool: input.tool,
        assetId: input.assetId,
        status: 'queued',
        progress: 0,
      })
      .returning();
    await writeAudit(
      { ...auditOf(actor), action: 'render_job.create', entity: 'render_job', entityId: created!.id, after: created },
      tx,
    );
    return created!;
  });
  return toRenderJobView(row);
}

/** Pure: the next row values for a status move, or an error message. */
export function nextRenderJobState(
  job: Pick<RenderJobRow, 'status' | 'progress' | 'error' | 'startedAt' | 'finishedAt'>,
  input: UpdateRenderJobInput,
  now: Date,
): { ok: true; set: Partial<RenderJobRow> } | { ok: false; message: string } {
  const set: Partial<RenderJobRow> = {};
  let to: RenderJobStatus | undefined = input.status;
  // Attaching a ready result without a status means the job is done.
  if (to === undefined && input.assetId && job.status !== 'done') to = 'done';
  // A progress number alone is a progress update of a running job.
  if (to === undefined && input.progress !== undefined) to = 'running';

  if (to === undefined) return { ok: true, set }; // label only
  if (!canMoveRenderJob(job.status, to)) {
    return { ok: false, message: `A ${job.status} job cannot move to ${to}.` };
  }
  if (input.progress !== undefined && to !== 'running') {
    return { ok: false, message: 'Progress can only change while the job is running.' };
  }

  set.status = to;
  switch (to) {
    case 'running':
      set.startedAt = job.startedAt ?? now;
      set.progress = input.progress ?? (job.status === 'running' ? job.progress : 0);
      set.error = null;
      set.finishedAt = null;
      break;
    case 'done':
      set.progress = 100;
      set.error = null;
      set.startedAt = job.startedAt ?? now;
      set.finishedAt = now;
      break;
    case 'failed': {
      const error = input.error ?? job.error;
      if (!error) return { ok: false, message: 'Say what went wrong.' };
      set.error = error;
      set.finishedAt = now;
      break;
    }
    case 'cancelled':
      set.finishedAt = now;
      break;
    case 'queued':
      set.progress = 0;
      set.error = null;
      set.startedAt = null;
      set.finishedAt = null;
      break;
  }
  return { ok: true, set };
}

export async function updateRenderJob(
  actor: Actor,
  jobId: string,
  input: UpdateRenderJobInput,
): Promise<RenderJob> {
  const [job] = await db.select().from(renderJobs).where(eq(renderJobs.id, jobId)).limit(1);
  if (!job) throw notFound('Render job');
  const brief = await findBrief(job.briefId);
  if (!brief) throw notFound('Brief');
  assertMakeAccess(actor, brief.productId, 'write');
  if (input.assetId) await assertAssetOfBrief(input.assetId, brief.id, true);

  const next = nextRenderJobState(job, input, new Date());
  if (!next.ok) throw unprocessable(next.message, 'RENDER_JOB_STATUS_NOT_ALLOWED');
  const set: Partial<typeof renderJobs.$inferInsert> = { ...next.set };
  if (input.label !== undefined) set.label = input.label;
  if (input.assetId !== undefined) set.assetId = input.assetId;

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(renderJobs)
      .set(set)
      .where(and(eq(renderJobs.id, job.id), eq(renderJobs.status, job.status)))
      .returning();
    if (!updated) throw conflict('Someone else updated this job. Reload and try again.', 'VERSION_CONFLICT');
    await writeAudit(
      {
        ...auditOf(actor),
        action: 'render_job.update',
        entity: 'render_job',
        entityId: job.id,
        before: { status: job.status, progress: job.progress, error: job.error, assetId: job.assetId },
        after: { status: updated.status, progress: updated.progress, error: updated.error, assetId: updated.assetId },
      },
      tx,
    );
    return updated;
  });
  return toRenderJobView(row);
}

/* ---------- Hand-off tools ---------- */

const HANDOFF_DEFAULTS: { key: HandoffToolKey; name: string; description: string; env: string; url: string | null }[] = [
  { key: 'figma', name: 'Figma', description: 'Posters and screens', env: 'HANDOFF_FIGMA_URL', url: 'https://www.figma.com/files' },
  { key: 'capcut', name: 'CapCut', description: 'Finish, trends, music', env: 'HANDOFF_CAPCUT_URL', url: 'https://www.capcut.com/' },
  { key: 'adobe-express', name: 'Adobe Express', description: 'Photo work, resizes', env: 'HANDOFF_ADOBE_EXPRESS_URL', url: 'https://new.express.adobe.com/' },
  { key: 'reel-studio', name: 'Reel studio', description: 'Code-rendered motion', env: 'HANDOFF_REEL_STUDIO_URL', url: null },
];

function safeHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost') ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Hand-off links. Each URL can be set with an env var (HANDOFF_<TOOL>_URL); https only. */
export function handoffTools(source: Record<string, string | undefined> = process.env): HandoffTool[] {
  return HANDOFF_DEFAULTS.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    url: safeHttpsUrl(source[t.env]) ?? t.url,
  }));
}
