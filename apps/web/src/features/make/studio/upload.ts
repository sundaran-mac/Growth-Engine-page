/**
 * Browser upload engine for Studio assets.
 * The file goes straight to storage with presigned URLs; it never passes through our API.
 * - Single PUT for small files, multipart (parallel parts, ETags, retries) for large ones.
 * - Cancel aborts every request in flight and tells the API to drop the upload.
 * The transport is injectable so tests can run without real network calls.
 */
import type {
  MakeAsset,
  CompleteUploadInput,
  CreateUploadInput,
  CreateUploadResponse,
} from '@growth-desk/contract';
import { abortUpload, completeUpload, createUpload } from '../api';

export interface PutResult {
  etag: string | null;
}

export interface PutTransport {
  put(
    url: string,
    body: Blob,
    headers: Record<string, string>,
    onProgress: (loadedBytes: number) => void,
    signal: AbortSignal,
  ): Promise<PutResult>;
}

export class UploadAbortedError extends Error {
  constructor() {
    super('Upload cancelled.');
    this.name = 'UploadAbortedError';
  }
}

export class UploadFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadFailedError';
  }
}

/** XMLHttpRequest PUT with upload progress. No cookies go to storage. */
export const xhrTransport: PutTransport = {
  put(url, body, headers, onProgress, signal) {
    return new Promise<PutResult>((resolve, reject) => {
      if (signal.aborted) {
        reject(new UploadAbortedError());
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      xhr.withCredentials = false;
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded);
      };
      const onAbort = () => xhr.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      xhr.onload = () => {
        signal.removeEventListener('abort', onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(body.size);
          resolve({ etag: xhr.getResponseHeader('ETag') });
        } else {
          reject(new UploadFailedError(`Storage refused the file (HTTP ${xhr.status}).`));
        }
      };
      xhr.onerror = () => {
        signal.removeEventListener('abort', onAbort);
        reject(new UploadFailedError('Network error while sending the file.'));
      };
      xhr.onabort = () => {
        signal.removeEventListener('abort', onAbort);
        reject(new UploadAbortedError());
      };
      xhr.send(body);
    });
  },
};

export interface UploadDeps {
  createUpload: (input: CreateUploadInput) => Promise<CreateUploadResponse>;
  completeUpload: (assetId: string, input: CompleteUploadInput) => Promise<MakeAsset>;
  abortUpload: (assetId: string) => Promise<unknown>;
  transport: PutTransport;
}

export const defaultUploadDeps: UploadDeps = {
  createUpload,
  completeUpload,
  abortUpload,
  transport: xhrTransport,
};

export interface RunUploadOptions {
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  /** Called once the API has created the asset row. */
  onCreated?: (asset: MakeAsset) => void;
  signal?: AbortSignal;
  deps?: Partial<UploadDeps>;
  /** Parallel part uploads for multipart (2 to 3 is kind to home connections). */
  concurrency?: number;
  /** Tries per part, including the first one. */
  partAttempts?: number;
}

const PART_RETRY_DELAY_MS = 800;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new UploadAbortedError());
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new UploadAbortedError());
      },
      { once: true },
    );
  });
}

/** Creates the asset, sends the bytes, completes it. Returns the ready asset. */
export async function runUpload(
  input: CreateUploadInput,
  file: Blob,
  options: RunUploadOptions = {},
): Promise<MakeAsset> {
  const deps: UploadDeps = { ...defaultUploadDeps, ...options.deps };
  const signal = options.signal ?? new AbortController().signal;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  const attempts = Math.max(1, options.partAttempts ?? 3);
  const total = file.size || 1;
  const report = (loaded: number) => options.onProgress?.(Math.min(1, loaded / total));

  if (signal.aborted) throw new UploadAbortedError();
  const created = await deps.createUpload(input);
  const assetId = created.asset.id;
  options.onCreated?.(created.asset);

  try {
    if (signal.aborted) throw new UploadAbortedError();
    const plan = created.upload;
    if (plan.mode === 'single') {
      await deps.transport.put(plan.url, file, plan.headers, report, signal);
      report(total);
      return await deps.completeUpload(assetId, {});
    }

    // Multipart: every part except the last is exactly partSize bytes.
    const loadedByPart = new Map<number, number>();
    const emit = () => report([...loadedByPart.values()].reduce((a, b) => a + b, 0));
    const etags = new Map<number, string>();
    const queue = [...plan.parts].sort((a, b) => a.partNumber - b.partNumber);

    const sendPart = async (part: { partNumber: number; url: string }) => {
      const start = (part.partNumber - 1) * plan.partSize;
      const blob = file.slice(start, Math.min(start + plan.partSize, file.size));
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (signal.aborted) throw new UploadAbortedError();
        try {
          const res = await deps.transport.put(
            part.url,
            blob,
            {},
            (loaded) => {
              loadedByPart.set(part.partNumber, loaded);
              emit();
            },
            signal,
          );
          if (!res.etag) {
            throw new UploadFailedError(
              'Storage did not return an ETag for a part. The bucket CORS must expose the ETag header.',
            );
          }
          loadedByPart.set(part.partNumber, blob.size);
          emit();
          etags.set(part.partNumber, res.etag);
          return;
        } catch (err) {
          if (err instanceof UploadAbortedError) throw err;
          lastError = err;
          loadedByPart.set(part.partNumber, 0);
          emit();
          if (attempt < attempts) await delay(PART_RETRY_DELAY_MS * attempt, signal);
        }
      }
      throw lastError instanceof Error ? lastError : new UploadFailedError('A part did not upload.');
    };

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        await sendPart(next);
      }
    });
    await Promise.all(workers);

    const parts = [...etags.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([partNumber, etag]) => ({ partNumber, etag }));
    return await deps.completeUpload(assetId, { parts });
  } catch (err) {
    // Best effort: drop the half-done upload so it does not linger in storage.
    try {
      await deps.abortUpload(assetId);
    } catch {
      /* the asset.probe sweep cleans up anything left */
    }
    throw err;
  }
}

export interface MediaInfo {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

const EMPTY_INFO: MediaInfo = { durationMs: null, width: null, height: null };

/** Reads duration and size in the browser. Never throws; unknown values come back as null. */
export function readMediaInfo(file: File, timeoutMs = 5000): Promise<MediaInfo> {
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if ((!isVideo && !isImage) || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(EMPTY_INFO);
  }
  return new Promise<MediaInfo>((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(EMPTY_INFO);
      return;
    }
    let done = false;
    const finish = (info: MediaInfo) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(info);
    };
    const timer = setTimeout(() => finish(EMPTY_INFO), timeoutMs);
    if (isVideo) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.onloadedmetadata = () =>
        finish({
          durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
        });
      video.onerror = () => finish(EMPTY_INFO);
      video.src = url;
    } else {
      const img = new Image();
      img.onload = () =>
        finish({ durationMs: null, width: img.naturalWidth || null, height: img.naturalHeight || null });
      img.onerror = () => finish(EMPTY_INFO);
      img.src = url;
    }
  });
}

/** "48.3 MB", "820 KB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** "0:12" or "1:02:05". */
export function formatTimecode(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
