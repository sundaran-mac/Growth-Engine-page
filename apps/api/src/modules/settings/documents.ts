/**
 * Knowledge documents per product: files (browser uploads to storage), web pages (fetched with
 * the SSRF guard), notes, and spec files synced from the product repo. The `document.process`
 * job extracts text and asks Claude for a short summary.
 */
import { randomUUID } from 'node:crypto';
import { and, count, desc, eq } from 'drizzle-orm';
import type {
  CreateProductDocument,
  CreateProductDocumentResponse,
  ListResponse,
  ProductDocument,
  SyncRepoSpecsResponse,
  UpdateProductDocument,
} from '@growth-desk/contract';
import { MAX_DOCUMENT_BYTES } from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import { productDocuments, users } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { generateText, isClaudeEnabled } from '../../lib/claude.js';
import { AppError, conflict, featureDisabled, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { deleteObject, isStorageEnabled, presignPut, sanitizeFileName } from '../../lib/storage.js';
import { estimateTokens } from './context.js';
import { extractKindFor, extractText, normaliseText } from './extract.js';
import { isGithubEnabled, listSpecFiles } from './github.js';
import { readObject, statObject } from './object-read.js';
import { documentProcessJob } from './queue.js';
import { safeFetch } from './safe-fetch.js';
import { ensureSettingsRow, getProductOr404, type AuditCtx } from './service.js';

type DocRow = typeof productDocuments.$inferSelect;

/** Text sent to Claude for the summary (the start of the document). */
/** The long dash, never allowed in Growth Desk text. */
const EM_DASH = String.fromCharCode(0x2014);

const SUMMARY_INPUT_CHARS = 40_000;

const docColumns = {
  doc: productDocuments,
  uploaderName: users.name,
  uploaderInitials: users.initials,
};

function toDto(
  row: DocRow,
  uploader: { name: string | null; initials: string | null },
): ProductDocument {
  return {
    id: row.id,
    productId: row.productId,
    title: row.title,
    kind: row.kind,
    storageKey: row.storageKey,
    sourceUrl: row.sourceUrl,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    summary: row.summary,
    tokenEstimate: row.tokenEstimate,
    pinned: row.pinned,
    error: row.error,
    uploadedBy:
      row.uploadedById && uploader.name
        ? { id: row.uploadedById, name: uploader.name, initials: uploader.initials ?? '' }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getDocumentDto(id: string, tx: DbOrTx = db): Promise<ProductDocument> {
  const [r] = await tx
    .select(docColumns)
    .from(productDocuments)
    .leftJoin(users, eq(users.id, productDocuments.uploadedById))
    .where(eq(productDocuments.id, id));
  if (!r) throw notFound('Document');
  return toDto(r.doc, { name: r.uploaderName, initials: r.uploaderInitials });
}

export async function getDocumentRow(id: string, tx: DbOrTx = db): Promise<DocRow> {
  const [row] = await tx.select().from(productDocuments).where(eq(productDocuments.id, id));
  if (!row) throw notFound('Document');
  return row;
}

export async function listDocuments(
  productId: string,
  limit: number,
  offset: number,
): Promise<ListResponse<ProductDocument>> {
  await getProductOr404(productId);
  const rows = await db
    .select(docColumns)
    .from(productDocuments)
    .leftJoin(users, eq(users.id, productDocuments.uploadedById))
    .where(eq(productDocuments.productId, productId))
    .orderBy(
      desc(productDocuments.pinned),
      desc(productDocuments.createdAt),
      desc(productDocuments.id),
    )
    .limit(limit)
    .offset(offset);
  const [total] = await db
    .select({ n: count() })
    .from(productDocuments)
    .where(eq(productDocuments.productId, productId));
  return {
    items: rows.map((r) => toDto(r.doc, { name: r.uploaderName, initials: r.uploaderInitials })),
    total: total?.n ?? 0,
  };
}

function defaultUrlTitle(raw: string): string {
  const u = new URL(raw);
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  return `${u.hostname}${path}`.slice(0, 160);
}

async function enqueueProcess(documentId: string): Promise<void> {
  await documentProcessJob.send({ documentId }, { singletonKey: documentId });
}

export async function createDocument(
  productId: string,
  input: CreateProductDocument,
  ctx: AuditCtx,
): Promise<CreateProductDocumentResponse> {
  await getProductOr404(productId);
  const actorId = ctx.actorId ?? null;
  let upload: CreateProductDocumentResponse['upload'] = null;
  let id: string;

  if (input.kind === 'file') {
    if (!isStorageEnabled()) throw featureDisabled('File storage');
    id = randomUUID();
    const key = `products/${productId}/documents/${id}-${sanitizeFileName(input.fileName)}`;
    const signed = await presignPut({
      key,
      contentType: input.mimeType,
      contentLength: input.sizeBytes,
    });
    await db.transaction(async (tx) => {
      await tx.insert(productDocuments).values({
        id,
        productId,
        title: input.title ?? input.fileName.replace(/\.[^.]+$/, '').slice(0, 160),
        kind: 'file',
        storageKey: key,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: 'uploading',
        pinned: input.pinned ?? false,
        uploadedById: actorId,
      });
      await writeAudit(
        {
          ...ctx,
          action: 'document.create',
          entity: 'product_document',
          entityId: id,
          after: { kind: 'file', key },
        },
        tx,
      );
    });
    upload = {
      url: signed.url,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresIn: signed.expiresIn,
    };
  } else if (input.kind === 'url') {
    id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(productDocuments).values({
        id,
        productId,
        title: input.title ?? defaultUrlTitle(input.url),
        kind: 'url',
        sourceUrl: input.url,
        status: 'processing',
        pinned: input.pinned ?? false,
        uploadedById: actorId,
      });
      await writeAudit(
        {
          ...ctx,
          action: 'document.create',
          entity: 'product_document',
          entityId: id,
          after: { kind: 'url', url: input.url },
        },
        tx,
      );
    });
    await enqueueProcess(id);
  } else {
    id = randomUUID();
    const text = normaliseText(input.text);
    await db.transaction(async (tx) => {
      await tx.insert(productDocuments).values({
        id,
        productId,
        title: input.title,
        kind: 'note',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        status: 'processing',
        extractedText: text,
        tokenEstimate: estimateTokens(text),
        pinned: input.pinned ?? false,
        uploadedById: actorId,
      });
      await writeAudit(
        {
          ...ctx,
          action: 'document.create',
          entity: 'product_document',
          entityId: id,
          after: { kind: 'note', title: input.title },
        },
        tx,
      );
    });
    await enqueueProcess(id);
  }
  return { document: await getDocumentDto(id), upload };
}

/** The browser finished the PUT: check the object, then process it. */
export async function completeDocumentUpload(id: string, ctx: AuditCtx): Promise<ProductDocument> {
  const row = await getDocumentRow(id);
  if (row.kind !== 'file' || !row.storageKey)
    throw unprocessable('Only file uploads can be completed.', 'DOCUMENT_NOT_UPLOAD');
  if (row.status !== 'uploading')
    throw conflict('This upload is already complete.', 'DOCUMENT_ALREADY_COMPLETE');
  const info = await statObject(row.storageKey);
  if (!info)
    throw unprocessable(
      'The file is not in storage yet. Upload it, then try again.',
      'UPLOAD_MISSING',
    );
  if (info.sizeBytes > MAX_DOCUMENT_BYTES) {
    throw unprocessable('The file is larger than 20 MB.', 'DOCUMENT_TOO_LARGE');
  }
  await db.transaction(async (tx) => {
    await tx
      .update(productDocuments)
      .set({ status: 'processing', sizeBytes: info.sizeBytes, error: null, updatedAt: new Date() })
      .where(eq(productDocuments.id, id));
    await writeAudit(
      {
        ...ctx,
        action: 'document.complete',
        entity: 'product_document',
        entityId: id,
        after: { sizeBytes: info.sizeBytes },
      },
      tx,
    );
  });
  await enqueueProcess(id);
  return getDocumentDto(id);
}

export async function updateDocument(
  id: string,
  patch: UpdateProductDocument,
  ctx: AuditCtx,
): Promise<ProductDocument> {
  await db.transaction(async (tx) => {
    const before = await getDocumentRow(id, tx);
    await tx
      .update(productDocuments)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(productDocuments.id, id));
    await writeAudit(
      {
        ...ctx,
        action: 'document.update',
        entity: 'product_document',
        entityId: id,
        before: { title: before.title, pinned: before.pinned },
        after: patch,
      },
      tx,
    );
  });
  return getDocumentDto(id);
}

export async function deleteDocument(id: string, ctx: AuditCtx): Promise<void> {
  const row = await getDocumentRow(id);
  await db.transaction(async (tx) => {
    await tx.delete(productDocuments).where(eq(productDocuments.id, id));
    await writeAudit(
      {
        ...ctx,
        action: 'document.delete',
        entity: 'product_document',
        entityId: id,
        before: {
          title: row.title,
          kind: row.kind,
          storageKey: row.storageKey,
          sourceUrl: row.sourceUrl,
        },
      },
      tx,
    );
  });
  if (row.storageKey && isStorageEnabled()) {
    // Best effort: the record is gone; a left-over object is logged for clean-up.
    await deleteObject(row.storageKey).catch((err: unknown) =>
      logger.warn({ err, key: row.storageKey }, 'document object not deleted'),
    );
  }
}

export async function reprocessDocument(id: string, ctx: AuditCtx): Promise<ProductDocument> {
  const row = await getDocumentRow(id);
  if (row.status === 'uploading')
    throw unprocessable('Finish the upload first.', 'DOCUMENT_NOT_UPLOADED');
  if (row.status === 'processing')
    throw conflict('This document is already being processed.', 'DOCUMENT_PROCESSING');
  await db.transaction(async (tx) => {
    await tx
      .update(productDocuments)
      .set({ status: 'processing', error: null, updatedAt: new Date() })
      .where(eq(productDocuments.id, id));
    await writeAudit(
      { ...ctx, action: 'document.reprocess', entity: 'product_document', entityId: id },
      tx,
    );
  });
  await enqueueProcess(id);
  return getDocumentDto(id);
}

/** Reads `docs/specs/**.md` from the product repo into Knowledge (add new, update changed). */
export async function syncRepoSpecs(
  productId: string,
  ctx: AuditCtx,
): Promise<SyncRepoSpecsResponse> {
  const settings = await ensureSettingsRow(productId);
  if (!isGithubEnabled())
    throw featureDisabled('GitHub', 'GitHub is not connected (GITHUB_TOKEN is not set).');
  if (!settings.githubRepo) {
    throw unprocessable('Set the GitHub repo in Claude and weekly run first.', 'REPO_NOT_SET');
  }
  const files = await listSpecFiles(settings.githubRepo, settings.githubBaseBranch);
  const result = { added: 0, updated: 0, unchanged: 0 };
  const toProcess: string[] = [];
  await db.transaction(async (tx) => {
    for (const f of files) {
      const text = normaliseText(f.text);
      if (!text) continue;
      const [existing] = await tx
        .select()
        .from(productDocuments)
        .where(
          and(
            eq(productDocuments.productId, productId),
            eq(productDocuments.kind, 'repo_spec'),
            eq(productDocuments.sourceUrl, f.url),
          ),
        );
      if (existing && existing.extractedText === text) {
        result.unchanged += 1;
        continue;
      }
      const base = {
        extractedText: text,
        tokenEstimate: estimateTokens(text),
        sizeBytes: Buffer.byteLength(text, 'utf8'),
        status: 'processing' as const,
        error: null,
        summary: null,
      };
      if (existing) {
        await tx
          .update(productDocuments)
          .set({ ...base, updatedAt: new Date() })
          .where(eq(productDocuments.id, existing.id));
        toProcess.push(existing.id);
        result.updated += 1;
      } else {
        const id = randomUUID();
        await tx.insert(productDocuments).values({
          id,
          productId,
          title: f.path.replace(/^docs\/specs\//i, 'Spec ').replace(/\.md$/i, ''),
          kind: 'repo_spec',
          sourceUrl: f.url,
          mimeType: 'text/markdown',
          uploadedById: ctx.actorId ?? null,
          ...base,
        });
        toProcess.push(id);
        result.added += 1;
      }
    }
    await writeAudit(
      {
        ...ctx,
        action: 'document.sync_repo',
        entity: 'product',
        entityId: productId,
        after: { repo: settings.githubRepo, ...result },
      },
      tx,
    );
  });
  for (const id of toProcess) await enqueueProcess(id);
  return result;
}

/* ---------- Processing (job) ---------- */

const SUMMARY_SYSTEM = [
  'You summarise product documents for a marketing team.',
  'Write 120 to 200 words in plain, simple English.',
  'Keep only facts the document states: what the product does, for whom, and any limits.',
  'Never invent features. Never use the long dash character. No headings, no lists.',
].join(' ');

async function summarise(
  productId: string,
  title: string,
  text: string,
): Promise<{ summary: string | null; note: string | null }> {
  if (!isClaudeEnabled())
    return { summary: null, note: 'Summary skipped: Claude is not connected.' };
  try {
    const { text: summary } = await generateText({
      productId,
      feature: 'knowledge.summary',
      system: SUMMARY_SYSTEM,
      prompt: `Document title: ${title}\n\n<document>\n${text.slice(0, SUMMARY_INPUT_CHARS)}\n</document>\n\nWrite the summary now.`,
      maxTokens: 800,
      effort: 'low',
    });
    return { summary: summary.replaceAll(EM_DASH, ', ').trim() || null, note: null };
  } catch (err) {
    const detail = err instanceof AppError ? (err.detail ?? err.title) : 'Claude did not answer.';
    return { summary: null, note: `Summary failed: ${detail}` };
  }
}

async function textFor(row: DocRow): Promise<string> {
  if (row.kind === 'note' || row.kind === 'repo_spec') {
    if (!row.extractedText) throw unprocessable('This document has no text.', 'DOCUMENT_EMPTY');
    return row.extractedText;
  }
  if (row.kind === 'file') {
    if (!row.storageKey) throw unprocessable('The file is missing.', 'UPLOAD_MISSING');
    const kind = extractKindFor(row.mimeType, row.storageKey);
    if (!kind)
      throw unprocessable('This file type is not supported.', 'DOCUMENT_TYPE_NOT_SUPPORTED');
    const body = await readObject(row.storageKey, MAX_DOCUMENT_BYTES);
    return extractText(body, kind);
  }
  // url
  const res = await safeFetch(row.sourceUrl!);
  const kind = extractKindFor(res.contentType, new URL(res.url).pathname);
  if (!kind) throw unprocessable('This page type is not supported.', 'DOCUMENT_TYPE_NOT_SUPPORTED');
  return extractText(res.body, kind);
}

/** Job body. Never throws for document problems: they land on the row as `failed`. */
export async function processDocument(documentId: string): Promise<void> {
  const [row] = await db.select().from(productDocuments).where(eq(productDocuments.id, documentId));
  if (!row) return; // deleted meanwhile
  if (row.status !== 'processing') return; // already handled (idempotent)
  let text: string;
  try {
    text = await textFor(row);
  } catch (err) {
    const message =
      err instanceof AppError ? (err.detail ?? err.title) : 'The text could not be read.';
    if (!(err instanceof AppError)) logger.error({ err, documentId }, 'document extract failed');
    await db
      .update(productDocuments)
      .set({ status: 'failed', error: message, updatedAt: new Date() })
      .where(eq(productDocuments.id, documentId));
    return;
  }
  const { summary, note } = await summarise(row.productId, row.title, text);
  await db
    .update(productDocuments)
    .set({
      status: 'ready',
      extractedText: text,
      tokenEstimate: estimateTokens(text),
      summary,
      error: note,
      updatedAt: new Date(),
    })
    .where(and(eq(productDocuments.id, documentId), eq(productDocuments.status, 'processing')));
}
