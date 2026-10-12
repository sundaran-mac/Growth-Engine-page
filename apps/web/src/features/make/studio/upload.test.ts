import { describe, expect, it, vi } from 'vitest';
import type { CreateUploadInput, CreateUploadResponse } from '@growth-desk/contract';
import { formatBytes, formatTimecode, runUpload, UploadAbortedError, type PutTransport, type UploadDeps } from './upload';
import { makeAsset } from './fixtures.test-util';

const input: CreateUploadInput = {
  briefId: '11111111-1111-4111-8111-111111111111',
  kind: 'video',
  ratio: '9:16',
  fileName: 'master.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 25,
};

function deps(upload: CreateUploadResponse['upload'], transport: PutTransport): UploadDeps & {
  completeUpload: ReturnType<typeof vi.fn>;
  abortUpload: ReturnType<typeof vi.fn>;
} {
  const asset = makeAsset({ status: 'uploading' });
  return {
    createUpload: vi.fn(async () => ({ asset, upload })),
    completeUpload: vi.fn(async () => makeAsset()),
    abortUpload: vi.fn(async () => undefined),
    transport,
  };
}

describe('runUpload', () => {
  it('uses one PUT for a single upload and completes with no parts', async () => {
    const put = vi.fn<PutTransport['put']>(async (_u, body, _h, onProgress) => {
      onProgress(body.size);
      return { etag: '"e"' };
    });
    const d = deps({ mode: 'single', url: 'https://s3/put', method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, expiresIn: 900 }, { put });
    const progress: number[] = [];
    const asset = await runUpload(input, new Blob(['x'.repeat(25)]), { deps: d, onProgress: (p) => progress.push(p) });
    expect(asset.status).toBe('ready');
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]![0]).toBe('https://s3/put');
    expect(put.mock.calls[0]![2]).toEqual({ 'Content-Type': 'video/mp4' });
    expect(d.completeUpload).toHaveBeenCalledWith(makeAsset().id, {});
    expect(progress.at(-1)).toBe(1);
  });

  it('slices multipart parts, collects ETags in order and completes', async () => {
    const sizes: Record<string, number> = {};
    const put = vi.fn<PutTransport['put']>(async (url, body) => {
      sizes[url] = body.size;
      return { etag: `"etag-${url.slice(-1)}"` };
    });
    const d = deps(
      {
        mode: 'multipart',
        partSize: 10,
        parts: [
          { partNumber: 1, url: 'https://s3/p1' },
          { partNumber: 2, url: 'https://s3/p2' },
          { partNumber: 3, url: 'https://s3/p3' },
        ],
        expiresIn: 3600,
      },
      { put },
    );
    await runUpload(input, new Blob(['x'.repeat(25)]), { deps: d, concurrency: 2 });
    expect(sizes).toEqual({ 'https://s3/p1': 10, 'https://s3/p2': 10, 'https://s3/p3': 5 });
    expect(d.completeUpload).toHaveBeenCalledWith(makeAsset().id, {
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
        { partNumber: 3, etag: '"etag-3"' },
      ],
    });
    expect(d.abortUpload).not.toHaveBeenCalled();
  });

  it('retries a failed part, then aborts the upload when it keeps failing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const put = vi.fn<PutTransport['put']>(async () => {
      throw new Error('boom');
    });
    const d = deps({ mode: 'multipart', partSize: 10, parts: [{ partNumber: 1, url: 'https://s3/p1' }], expiresIn: 3600 }, { put });
    await expect(runUpload(input, new Blob(['x'.repeat(5)]), { deps: d, partAttempts: 2 })).rejects.toThrow('boom');
    expect(put).toHaveBeenCalledTimes(2);
    expect(d.abortUpload).toHaveBeenCalledWith(makeAsset().id);
    expect(d.completeUpload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('fails when storage hides the ETag header', async () => {
    const put = vi.fn<PutTransport['put']>(async () => ({ etag: null }));
    const d = deps({ mode: 'multipart', partSize: 10, parts: [{ partNumber: 1, url: 'u' }], expiresIn: 1 }, { put });
    await expect(runUpload(input, new Blob(['x']), { deps: d, partAttempts: 1 })).rejects.toThrow(/ETag/);
    expect(d.abortUpload).toHaveBeenCalled();
  });

  it('cancel aborts and tells the API', async () => {
    const controller = new AbortController();
    const put = vi.fn<PutTransport['put']>(async () => {
      controller.abort();
      throw new UploadAbortedError();
    });
    const d = deps({ mode: 'single', url: 'u', method: 'PUT', headers: {}, expiresIn: 1 }, { put });
    await expect(runUpload(input, new Blob(['x']), { deps: d, signal: controller.signal })).rejects.toBeInstanceOf(UploadAbortedError);
    expect(d.abortUpload).toHaveBeenCalled();
  });
});

describe('formatters', () => {
  it('formats bytes and timecodes', () => {
    expect(formatBytes(48_300_000)).toBe('46.1 MB');
    expect(formatBytes(null)).toBe('Unknown size');
    expect(formatTimecode(12_000)).toBe('0:12');
    expect(formatTimecode(58_400)).toBe('0:58');
    expect(formatTimecode(3_725_000)).toBe('1:02:05');
  });
});
