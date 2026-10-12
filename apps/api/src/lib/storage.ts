/**
 * Object storage over the S3 API: Cloudflare R2 in production, MinIO locally.
 * Browsers upload straight to storage with presigned URLs; big video never passes the API.
 */
import { randomUUID } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AssetKind } from '@growth-desk/contract';
import { env, type StorageConfig } from '../config/env.js';
import { AppError, featureDisabled } from './errors.js';

/* ---------- Limits ---------- */

export const MiB = 1024 * 1024;
/** Above this size the browser must use multipart upload. */
export const MAX_SINGLE_PUT_BYTES = 100 * MiB;
/** Hard cap for one asset. */
export const MAX_ASSET_BYTES = 5 * 1024 * MiB;
/** S3 rules: every part except the last is at least 5 MiB; at most 10,000 parts. */
export const MIN_PART_BYTES = 5 * MiB;
export const DEFAULT_PART_BYTES = 16 * MiB;
export const MAX_PARTS = 10_000;
/** Presigned URL lifetimes in seconds. */
export const PUT_URL_TTL = 15 * 60;
export const PART_URL_TTL = 60 * 60;
export const GET_URL_TTL = 15 * 60;

/* ---------- Keys ---------- */

/** Lower case, safe characters only, keeps the extension. Never empty. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-\./g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return cleaned || 'file';
}

/** `briefs/<briefId>/<kind>/<uuid>-<file-name>`: unique, grouped by brief, safe for URLs. */
export function buildAssetKey(input: {
  briefId: string;
  kind: AssetKind;
  fileName: string;
  id?: string;
}): string {
  return `briefs/${input.briefId}/${input.kind}/${input.id ?? randomUUID()}-${sanitizeFileName(input.fileName)}`;
}

/** Suggested part size so the file fits in MAX_PARTS parts. */
export function choosePartSize(totalBytes: number): number {
  const needed = Math.ceil(totalBytes / MAX_PARTS);
  return Math.max(DEFAULT_PART_BYTES, Math.ceil(needed / MiB) * MiB);
}

/* ---------- Clients ---------- */

interface Clients {
  config: StorageConfig;
  /** Server-side calls (inside Docker this is http://minio:9000). */
  internal: S3Client;
  /** Presigning only: the URL host must be the one the browser can reach. */
  presigner: S3Client;
}

let clients: Clients | null = null;

function makeClient(config: StorageConfig, endpoint: string): S3Client {
  return new S3Client({
    region: config.region,
    endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 and MinIO do not need the newer default checksum headers on presigned PUTs.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function getClients(): Clients {
  if (!env.storage) throw featureDisabled('File storage');
  clients ??= {
    config: env.storage,
    internal: makeClient(env.storage, env.storage.endpoint),
    presigner: makeClient(env.storage, env.storage.publicEndpoint),
  };
  return clients;
}

export function isStorageEnabled(): boolean {
  return env.storage !== null;
}

function storageError(action: string, cause: unknown): AppError {
  return new AppError({
    status: 502,
    code: 'STORAGE_FAILED',
    title: 'Storage error',
    detail: `Could not ${action}. Try again.`,
    cause,
  });
}

/* ---------- Single upload ---------- */

export async function presignPut(input: {
  key: string;
  contentType: string;
  contentLength?: number;
  expiresIn?: number;
}): Promise<{ url: string; expiresIn: number }> {
  const { config, presigner } = getClients();
  if (input.contentLength !== undefined && input.contentLength > MAX_SINGLE_PUT_BYTES) {
    throw new AppError({
      status: 400,
      code: 'UPLOAD_TOO_LARGE',
      title: 'Use multipart upload',
      detail: `Files over ${MAX_SINGLE_PUT_BYTES / MiB} MiB must use multipart upload.`,
    });
  }
  const expiresIn = input.expiresIn ?? PUT_URL_TTL;
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: input.key,
    ContentType: input.contentType,
    ...(input.contentLength !== undefined ? { ContentLength: input.contentLength } : {}),
  });
  return { url: await getSignedUrl(presigner, command, { expiresIn }), expiresIn };
}

/* ---------- Multipart upload ---------- */

export async function createMultipart(input: {
  key: string;
  contentType: string;
}): Promise<{ uploadId: string }> {
  const { config, internal } = getClients();
  try {
    const out = await internal.send(
      new CreateMultipartUploadCommand({
        Bucket: config.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
    );
    if (!out.UploadId) throw new Error('No UploadId returned');
    return { uploadId: out.UploadId };
  } catch (err) {
    throw storageError('start the upload', err);
  }
}

export async function presignPart(input: {
  key: string;
  uploadId: string;
  partNumber: number;
  expiresIn?: number;
}): Promise<{ url: string; partNumber: number; expiresIn: number }> {
  const { config, presigner } = getClients();
  if (!Number.isInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > MAX_PARTS) {
    throw new AppError({ status: 400, code: 'VALIDATION_FAILED', title: 'Bad part number' });
  }
  const expiresIn = input.expiresIn ?? PART_URL_TTL;
  const command = new UploadPartCommand({
    Bucket: config.bucket,
    Key: input.key,
    UploadId: input.uploadId,
    PartNumber: input.partNumber,
  });
  return {
    url: await getSignedUrl(presigner, command, { expiresIn }),
    partNumber: input.partNumber,
    expiresIn,
  };
}

export async function completeMultipart(input: {
  key: string;
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}): Promise<{ etag: string | null }> {
  const { config, internal } = getClients();
  const parts = [...input.parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag }));
  try {
    const out = await internal.send(
      new CompleteMultipartUploadCommand({
        Bucket: config.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    return { etag: out.ETag ?? null };
  } catch (err) {
    throw storageError('finish the upload', err);
  }
}

export async function abortMultipart(input: { key: string; uploadId: string }): Promise<void> {
  const { config, internal } = getClients();
  try {
    await internal.send(
      new AbortMultipartUploadCommand({
        Bucket: config.bucket,
        Key: input.key,
        UploadId: input.uploadId,
      }),
    );
  } catch (err) {
    throw storageError('cancel the upload', err);
  }
}

/* ---------- Read, check, delete ---------- */

export async function presignGet(input: {
  key: string;
  expiresIn?: number;
  /** Sets Content-Disposition so the browser downloads with this name. */
  downloadName?: string;
}): Promise<{ url: string; expiresIn: number }> {
  const { config, presigner } = getClients();
  const expiresIn = input.expiresIn ?? GET_URL_TTL;
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: input.key,
    ...(input.downloadName
      ? {
          ResponseContentDisposition: `attachment; filename="${sanitizeFileName(input.downloadName)}"`,
        }
      : {}),
  });
  return { url: await getSignedUrl(presigner, command, { expiresIn }), expiresIn };
}

/** Public CDN URL when R2_PUBLIC_BASE_URL is set; otherwise null (use presignGet). */
export function getPublicUrl(key: string): string | null {
  const base = env.storage?.publicBaseUrl;
  return base ? `${base}/${key.split('/').map(encodeURIComponent).join('/')}` : null;
}

export interface ObjectInfo {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

/** Object metadata, or null when it does not exist. */
export async function headObject(key: string): Promise<ObjectInfo | null> {
  const { config, internal } = getClients();
  try {
    const out = await internal.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return {
      sizeBytes: out.ContentLength ?? 0,
      contentType: out.ContentType ?? null,
      etag: out.ETag ?? null,
      lastModified: out.LastModified ?? null,
    };
  } catch (err) {
    if (err instanceof NotFound) return null;
    if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
    throw storageError('read the file details', err);
  }
}

/** Default time limit for a server-side read of one object. */
export const GET_OBJECT_TIMEOUT_MS = 60_000;

function tooLarge(maxBytes: number): AppError {
  const limit =
    maxBytes >= MiB ? `${Math.floor((maxBytes / MiB) * 10) / 10} MB` : `${maxBytes} bytes`;
  return new AppError({
    status: 422,
    code: 'OBJECT_TOO_LARGE',
    title: 'File too large',
    detail: `The file is larger than ${limit}.`,
  });
}

/**
 * Reads a body chunk by chunk and stops as soon as it passes `maxBytes`, so a huge object
 * never sits in memory. Exported for tests.
 */
export async function readStreamCapped(
  body: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
  onTooLarge?: () => void,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      onTooLarge?.();
      throw tooLarge(maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

function isAsyncIterable(v: unknown): v is AsyncIterable<Uint8Array | string> {
  return typeof v === 'object' && v !== null && Symbol.asyncIterator in v;
}

/**
 * Server-side read of a whole object, for small files only (document text extraction).
 * Streams the body and aborts the download when it passes `maxBytes` (OBJECT_TOO_LARGE, 422).
 * A missing object is OBJECT_NOT_FOUND (404); other storage problems are STORAGE_FAILED (502).
 */
export async function getObjectBytes(
  key: string,
  maxBytes: number,
  opts: { timeoutMs?: number } = {},
): Promise<Buffer> {
  const { config, internal } = getClients();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? GET_OBJECT_TIMEOUT_MS);
  try {
    const out = await internal.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
      abortSignal: controller.signal,
    });
    if (out.ContentLength !== undefined && out.ContentLength > maxBytes) {
      controller.abort();
      throw tooLarge(maxBytes);
    }
    const body: unknown = out.Body;
    if (!isAsyncIterable(body)) throw new Error('Storage returned no readable body');
    return await readStreamCapped(body, maxBytes, () => controller.abort());
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (
      err instanceof NoSuchKey ||
      (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404)
    ) {
      throw new AppError({
        status: 404,
        code: 'OBJECT_NOT_FOUND',
        title: 'File not found',
        detail: 'The file is not in storage.',
        cause: err,
      });
    }
    throw storageError('read the file', err);
  } finally {
    clearTimeout(timer);
  }
}

export async function deleteObject(key: string): Promise<void> {
  const { config, internal } = getClients();
  try {
    await internal.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (err) {
    throw storageError('delete the file', err);
  }
}

/** Health check: can we reach the bucket? */
export async function checkStorage(): Promise<void> {
  const { config, internal } = getClients();
  await internal.send(new HeadBucketCommand({ Bucket: config.bucket }), {
    abortSignal: AbortSignal.timeout(3000),
  });
}
