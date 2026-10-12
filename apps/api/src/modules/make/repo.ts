/**
 * MAKE data access: rows to contract views, kit lookup, user references.
 */
import { desc, eq, inArray } from 'drizzle-orm';
import type { Brief, MakeAsset, RenderJob, UserRef } from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import { briefs, productKits, users } from '../../db/schema/index.js';
import type { assets, renderJobs } from '../../db/schema/index.js';
import type { ClaimCheckKit } from './claim-check.js';

export type BriefRow = typeof briefs.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type RenderJobRow = typeof renderJobs.$inferSelect;

export async function userRefs(
  ids: readonly (string | null | undefined)[],
  tx: DbOrTx = db,
): Promise<Map<string, UserRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.name, initials: users.initials })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

const ref = (map: Map<string, UserRef>, id: string | null): UserRef | null =>
  id ? (map.get(id) ?? null) : null;

export async function toBriefViews(rows: BriefRow[], tx: DbOrTx = db): Promise<Brief[]> {
  const refs = await userRefs(
    rows.flatMap((r) => [r.ownerId, r.claimsApproverId, r.brandApproverId]),
    tx,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    kind: r.kind,
    productId: r.productId,
    ideaId: r.ideaId,
    title: r.title,
    mode: r.mode,
    stage: r.stage,
    hook: r.hook,
    beats: r.beats,
    ask: r.ask,
    ratios: r.ratios,
    captionLanguages: r.captionLanguages,
    channels: r.channels,
    owner: ref(refs, r.ownerId),
    claimsApprover: ref(refs, r.claimsApproverId),
    brandApprover: ref(refs, r.brandApproverId),
    version: r.version,
    claimFlags: r.claimFlags,
    claims: r.claims,
    claudeSuggestions: {
      captions: r.claudeSuggestions?.captions ?? [],
      altHooks: r.claudeSuggestions?.altHooks ?? [],
      bRoll: r.claudeSuggestions?.bRoll ?? [],
      generatedAt: r.claudeSuggestions?.generatedAt ?? null,
    },
    frozenAt: r.frozenAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function toBriefView(row: BriefRow, tx: DbOrTx = db): Promise<Brief> {
  const [view] = await toBriefViews([row], tx);
  return view!;
}

export async function findBrief(id: string, tx: DbOrTx = db): Promise<BriefRow | null> {
  const [row] = await tx.select().from(briefs).where(eq(briefs.id, id)).limit(1);
  return row ?? null;
}

/** Latest kit version of a product, as the claim check needs it. */
export async function loadKit(
  productId: string,
  tx: DbOrTx = db,
): Promise<(ClaimCheckKit & { version: number }) | null> {
  const [kit] = await tx
    .select({
      version: productKits.version,
      promise: productKits.promise,
      behaviours: productKits.behaviours,
      neverSay: productKits.neverSay,
      notBuilt: productKits.notBuilt,
    })
    .from(productKits)
    .where(eq(productKits.productId, productId))
    .orderBy(desc(productKits.version))
    .limit(1);
  return kit ?? null;
}

export async function toAssetViews(rows: AssetRow[], tx: DbOrTx = db): Promise<MakeAsset[]> {
  const refs = await userRefs(
    rows.map((r) => r.createdById),
    tx,
  );
  return rows.map((r) => ({
    id: r.id,
    briefId: r.briefId,
    kind: r.kind,
    ratio: (r.ratio as MakeAsset['ratio']) ?? null,
    storageKey: r.storageKey,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    durationMs: r.durationMs,
    width: r.width,
    height: r.height,
    status: r.status,
    licence: r.licence,
    consentOnFile: r.consentOnFile,
    aiGenerated: r.aiGenerated,
    briefVersion: r.briefVersion,
    loudnessLufs: r.loudnessLufs ?? null,
    createdBy: ref(refs, r.createdById),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function toAssetView(row: AssetRow, tx: DbOrTx = db): Promise<MakeAsset> {
  const [view] = await toAssetViews([row], tx);
  return view!;
}

export function toRenderJobView(r: RenderJobRow): RenderJob {
  return {
    id: r.id,
    briefId: r.briefId,
    assetId: r.assetId,
    kind: r.kind,
    label: r.label,
    tool: r.tool,
    status: r.status,
    progress: r.progress,
    error: r.error,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
