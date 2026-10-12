/**
 * Studio assets: direct-to-storage uploads (single PUT up to 50 MB, multipart above),
 * complete, abort, presigned GET, delete. Big files never pass through the API.
 *
 * Storage key: products/<productId>/briefs/<briefId>/<assetId>/<safe-file-name>
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, lt } from 'drizzle-orm';
import {
  UPLOAD_SINGLE_MAX_BYTES,
  isBriefMaking,
  uploadPartSize,
  type MakeAsset,
  type UpdateAssetInput,
  type AssetListResponse,
  type AssetUrlResponse,
  type CompleteUploadInput,
  type CreateUploadResponse,
  type UploadPlan,
  type createUploadSchema,
} from '@growth-desk/contract';
import type { z } from 'zod';
import { db } from '../../db/client.js';
import { assets, posts } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { badRequest, conflict, featureDisabled, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  PART_URL_TTL,
  PUT_URL_TTL,
  abortMultipart,
  completeMultipart,
  createMultipart,
  deleteObject,
  headObject,
  isStorageEnabled,
  presignGet,
  presignPart,
  presignPut,
  sanitizeFileName,
} from '../../lib/storage.js';
import { assertMakeAccess, auditOf, type Actor } from './access.js';
import { loadBriefFor } from './briefs.service.js';
import { findBrief, toAssetView, toAssetViews, type AssetRow, type BriefRow } from './repo.js';

type CreateUploadBody = z.output<typeof createUploadSchema>;

export function assetStorageKey(input: {
  productId: string;
  briefId: string;
  assetId: string;
  fileName: string;
}): string {
  return `products/${input.productId}/briefs/${input.briefId}/${input.assetId}/${sanitizeFileName(input.fileName)}`;
}

export function partCount(sizeBytes: number, partSize: number): number {
  return Math.ceil(sizeBytes / partSize);
}

function assertStorage(): void {
  if (!isStorageEnabled()) throw featureDisabled('File storage');
}

function assertMaking(brief: BriefRow): void {
  if (!isBriefMaking(brief.stage)) {
    throw unprocessable(
      'Files can only change while the brief is frozen or being made.',
      'STAGE_NOT_ALLOWED',
    );
  }
}

async function loadAssetFor(
  actor: Actor,
  assetId: string,
  level: 'read' | 'write',
): Promise<{ asset: AssetRow; brief: BriefRow }> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) throw notFound('Asset');
  const brief = await findBrief(asset.briefId);
  if (!brief) throw notFound('Brief');
  assertMakeAccess(actor, brief.productId, level);
  return { asset, brief };
}

/* ---------- List and read ---------- */

export async function listAssets(actor: Actor, briefId: string): Promise<AssetListResponse> {
  await loadBriefFor(actor, briefId, 'read');
  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.briefId, briefId))
    .orderBy(asc(assets.kind), asc(assets.createdAt));
  return { items: await toAssetViews(rows), total: rows.length };
}

export async function assetUrl(actor: Actor, assetId: string): Promise<AssetUrlResponse> {
  const { asset } = await loadAssetFor(actor, assetId, 'read');
  if (asset.status !== 'ready') {
    throw unprocessable('This file is not ready yet.', 'ASSET_NOT_READY');
  }
  assertStorage();
  return presignGet({ key: asset.storageKey });
}

/* ---------- Create upload ---------- */

export async function createUpload(
  actor: Actor,
  body: CreateUploadBody,
): Promise<CreateUploadResponse> {
  const brief = await loadBriefFor(actor, body.briefId, 'write');
  assertMaking(brief);
  if (body.kind !== 'caption' && !body.ratio) {
    throw badRequest('Pick the ratio of this file.', 'VALIDATION_FAILED', [
      { path: 'body.ratio', message: 'Required for video, cut-down and poster files.' },
    ]);
  }
  assertStorage();

  const assetId = randomUUID();
  const key = assetStorageKey({
    productId: brief.productId,
    briefId: brief.id,
    assetId,
    fileName: body.fileName,
  });
  const multipart = body.sizeBytes > UPLOAD_SINGLE_MAX_BYTES;
  const uploadId = multipart ? (await createMultipart({ key, contentType: body.mimeType })).uploadId : null;

  let row: AssetRow;
  try {
    row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(assets)
        .values({
          id: assetId,
          briefId: brief.id,
          kind: body.kind,
          ratio: body.kind === 'caption' ? null : body.ratio,
          storageKey: key,
          fileName: body.fileName,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
          durationMs: body.durationMs,
          width: body.width,
          height: body.height,
          status: 'uploading',
          uploadId,
          licence: body.licence,
          consentOnFile: body.consentOnFile,
          aiGenerated: body.aiGenerated,
          loudnessLufs: body.loudnessLufs,
          briefVersion: brief.version,
          createdById: actor.user.id,
        })
        .returning();
      await writeAudit(
        { ...auditOf(actor), action: 'asset.upload_start', entity: 'asset', entityId: assetId, after: created },
        tx,
      );
      return created!;
    });
  } catch (err) {
    if (uploadId) await abortMultipart({ key, uploadId }).catch(() => undefined);
    throw err;
  }

  let upload: UploadPlan;
  if (uploadId) {
    const partSize = uploadPartSize(body.sizeBytes);
    const n = partCount(body.sizeBytes, partSize);
    const parts = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        presignPart({ key, uploadId, partNumber: i + 1, expiresIn: PART_URL_TTL }),
      ),
    );
    upload = {
      mode: 'multipart',
      partSize,
      parts: parts.map((p) => ({ partNumber: p.partNumber, url: p.url })),
      expiresIn: PART_URL_TTL,
    };
  } else {
    const put = await presignPut({
      key,
      contentType: body.mimeType,
      contentLength: body.sizeBytes,
      expiresIn: PUT_URL_TTL,
    });
    upload = {
      mode: 'single',
      url: put.url,
      method: 'PUT',
      headers: { 'Content-Type': body.mimeType },
      expiresIn: put.expiresIn,
    };
  }
  return { asset: await toAssetView(row), upload };
}

/* ---------- Complete ---------- */

function checkParts(asset: AssetRow, parts: CompleteUploadInput['parts']): { partNumber: number; etag: string }[] {
  if (!parts || parts.length === 0) {
    throw badRequest('Send every uploaded part with its ETag.', 'VALIDATION_FAILED', [
      { path: 'body.parts', message: 'Required for a multipart upload.' },
    ]);
  }
  const expected = partCount(asset.sizeBytes ?? 0, uploadPartSize(asset.sizeBytes ?? 0));
  const numbers = new Set(parts.map((p) => p.partNumber));
  if (numbers.size !== parts.length || parts.length !== expected || [...numbers].some((n) => n > expected)) {
    throw badRequest(`Expected parts 1 to ${expected}, each once.`, 'UPLOAD_PARTS_INVALID');
  }
  return parts;
}

export async function completeUpload(
  actor: Actor,
  assetId: string,
  body: CompleteUploadInput,
): Promise<MakeAsset> {
  const { asset, brief } = await loadAssetFor(actor, assetId, 'write');
  if (asset.status !== 'uploading') {
    throw conflict('This upload is already finished or cancelled.', 'UPLOAD_NOT_OPEN');
  }
  assertMaking(brief);
  assertStorage();

  if (asset.uploadId) {
    await completeMultipart({
      key: asset.storageKey,
      uploadId: asset.uploadId,
      parts: checkParts(asset, body.parts),
    });
  }
  const info = await headObject(asset.storageKey);
  if (!info) {
    throw conflict('The file has not reached storage yet. Upload it, then try again.', 'UPLOAD_NOT_FOUND');
  }

  const sizeOk = asset.sizeBytes === null || info.sizeBytes === asset.sizeBytes;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(assets)
      .set({
        status: sizeOk ? 'ready' : 'failed',
        uploadId: null,
        sizeBytes: info.sizeBytes,
      })
      .where(and(eq(assets.id, asset.id), eq(assets.status, 'uploading')))
      .returning();
    if (!updated) throw conflict('This upload is already finished or cancelled.', 'UPLOAD_NOT_OPEN');
    await writeAudit(
      {
        ...auditOf(actor),
        action: sizeOk ? 'asset.upload_complete' : 'asset.upload_failed',
        entity: 'asset',
        entityId: asset.id,
        before: { status: asset.status, sizeBytes: asset.sizeBytes },
        after: { status: updated.status, sizeBytes: updated.sizeBytes },
      },
      tx,
    );
    return updated;
  });
  if (!sizeOk) {
    await deleteObject(asset.storageKey).catch((err: unknown) =>
      logger.warn({ err, assetId: asset.id }, 'could not delete a bad upload'),
    );
    throw unprocessable(
      'The stored file size does not match the file you picked. Upload it again.',
      'UPLOAD_SIZE_MISMATCH',
    );
  }
  return toAssetView(row);
}

/* ---------- Edit metadata ---------- */

export async function updateAsset(
  actor: Actor,
  assetId: string,
  body: UpdateAssetInput,
): Promise<MakeAsset> {
  const { asset, brief } = await loadAssetFor(actor, assetId, 'write');
  assertMaking(brief);
  const set: Partial<typeof assets.$inferInsert> = {};
  if (body.loudnessLufs !== undefined) set.loudnessLufs = body.loudnessLufs;
  if (body.licence !== undefined) set.licence = body.licence?.trim() ? body.licence.trim() : null;
  if (body.consentOnFile !== undefined) set.consentOnFile = body.consentOnFile;
  if (body.aiGenerated !== undefined) set.aiGenerated = body.aiGenerated;
  if (body.ratio !== undefined) {
    if (body.ratio === null && asset.kind !== 'caption') {
      throw badRequest('Pick the ratio of this file.', 'VALIDATION_FAILED', [
        { path: 'body.ratio', message: 'Required for video, cut-down and poster files.' },
      ]);
    }
    set.ratio = body.ratio;
  }
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(assets).set(set).where(eq(assets.id, asset.id)).returning();
    const keys = Object.keys(set) as (keyof typeof set)[];
    await writeAudit(
      {
        ...auditOf(actor),
        action: 'asset.update',
        entity: 'asset',
        entityId: asset.id,
        before: Object.fromEntries(keys.map((k) => [k, asset[k as keyof AssetRow]])),
        after: Object.fromEntries(keys.map((k) => [k, updated![k as keyof AssetRow]])),
      },
      tx,
    );
    return updated!;
  });
  return toAssetView(row);
}

/* ---------- Abort and delete ---------- */

export async function abortUpload(actor: Actor, assetId: string): Promise<void> {
  const { asset } = await loadAssetFor(actor, assetId, 'write');
  if (asset.status !== 'uploading') {
    throw conflict('Only an open upload can be cancelled.', 'UPLOAD_NOT_OPEN');
  }
  assertStorage();
  if (asset.uploadId) {
    await abortMultipart({ key: asset.storageKey, uploadId: asset.uploadId });
  } else {
    await deleteObject(asset.storageKey);
  }
  await db.transaction(async (tx) => {
    await tx.delete(assets).where(eq(assets.id, asset.id));
    await writeAudit(
      { ...auditOf(actor), action: 'asset.upload_abort', entity: 'asset', entityId: asset.id, before: asset },
      tx,
    );
  });
}

export async function deleteAsset(actor: Actor, assetId: string): Promise<void> {
  const { asset, brief } = await loadAssetFor(actor, assetId, 'write');
  assertMaking(brief);
  const [used] = await db.select({ id: posts.id }).from(posts).where(eq(posts.assetId, asset.id)).limit(1);
  if (used) throw conflict('A post uses this file, so it cannot be deleted.', 'ASSET_IN_USE');
  assertStorage();
  // Row and audit in one transaction; the object delete runs inside it, so a storage error
  // rolls the row back and nothing is left half-deleted.
  await db.transaction(async (tx) => {
    await tx.delete(assets).where(eq(assets.id, asset.id));
    await writeAudit(
      { ...auditOf(actor), action: 'asset.delete', entity: 'asset', entityId: asset.id, before: asset },
      tx,
    );
    if (asset.uploadId) {
      await abortMultipart({ key: asset.storageKey, uploadId: asset.uploadId });
    } else {
      await deleteObject(asset.storageKey);
    }
  });
}

/* ---------- Job: asset.probe ---------- */

/** Reads the object size and type and marks the asset ready or failed. Safe to run twice. */
export async function probeAsset(assetId: string): Promise<'ready' | 'failed' | 'skipped'> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  // Open uploads are finished by POST /assets/:id/complete or cleaned by the sweep.
  if (!asset || asset.status === 'uploading' || !isStorageEnabled()) return 'skipped';
  const info = await headObject(asset.storageKey);
  if (!info) {
    if (asset.status === 'failed') return 'failed';
    await db.update(assets).set({ status: 'failed' }).where(eq(assets.id, asset.id));
    await writeAudit({
      actorId: null,
      action: 'asset.probe_missing',
      entity: 'asset',
      entityId: asset.id,
      before: { status: asset.status },
      after: { status: 'failed' },
    });
    return 'failed';
  }
  const typeOk = !info.contentType || info.contentType.split(';')[0]!.trim() === asset.mimeType;
  const status = typeOk ? 'ready' : 'failed';
  if (asset.status !== status || asset.sizeBytes !== info.sizeBytes) {
    await db
      .update(assets)
      .set({ status, sizeBytes: info.sizeBytes })
      .where(eq(assets.id, asset.id));
    await writeAudit({
      actorId: null,
      action: 'asset.probe',
      entity: 'asset',
      entityId: asset.id,
      before: { status: asset.status, sizeBytes: asset.sizeBytes },
      after: { status, sizeBytes: info.sizeBytes, contentType: info.contentType },
    });
  }
  return status;
}

/** Cancels uploads left open for more than `olderThanHours` (default 24 h). */
export async function sweepStaleUploads(olderThanHours = 24): Promise<number> {
  if (!isStorageEnabled()) return 0;
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const stale = await db
    .select()
    .from(assets)
    .where(and(eq(assets.status, 'uploading'), lt(assets.createdAt, cutoff)))
    .limit(100);
  let cleaned = 0;
  for (const asset of stale) {
    try {
      if (asset.uploadId) await abortMultipart({ key: asset.storageKey, uploadId: asset.uploadId });
      else await deleteObject(asset.storageKey);
      await db.transaction(async (tx) => {
        await tx.update(assets).set({ status: 'failed', uploadId: null }).where(eq(assets.id, asset.id));
        await writeAudit(
          {
            actorId: null,
            action: 'asset.upload_expired',
            entity: 'asset',
            entityId: asset.id,
            before: { status: 'uploading' },
            after: { status: 'failed' },
          },
          tx,
        );
      });
      cleaned += 1;
    } catch (err) {
      logger.warn({ err, assetId: asset.id }, 'could not clean a stale upload');
    }
  }
  return cleaned;
}
