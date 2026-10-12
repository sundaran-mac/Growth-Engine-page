import { Readable } from 'node:stream';
import { NoSuchKey, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PARTS,
  MAX_SINGLE_PUT_BYTES,
  MiB,
  buildAssetKey,
  choosePartSize,
  getObjectBytes,
  getPublicUrl,
  presignGet,
  presignPart,
  presignPut,
  readStreamCapped,
  sanitizeFileName,
} from './storage.js';

describe('sanitizeFileName', () => {
  it('keeps safe names and the extension', () => {
    expect(sanitizeFileName('REEL-031 Master (9x16).MP4')).toBe('reel-031-master-9x16.mp4');
  });
  it('drops paths, accents and odd characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\x\\Café poster.png')).toBe('cafe-poster.png');
    expect(sanitizeFileName('தமிழ்.png')).toBe('png');
    expect(sanitizeFileName('...')).toBe('file');
  });
  it('limits the length', () => {
    expect(sanitizeFileName(`${'a'.repeat(300)}.mp4`).length).toBeLessThanOrEqual(120);
  });
});

describe('buildAssetKey', () => {
  it('groups by brief and kind, with a unique id', () => {
    const key = buildAssetKey({
      briefId: 'b1',
      kind: 'video',
      fileName: 'Master Cut.mp4',
      id: 'u1',
    });
    expect(key).toBe('briefs/b1/video/u1-master-cut.mp4');
    const a = buildAssetKey({ briefId: 'b1', kind: 'poster', fileName: 'x.png' });
    const b = buildAssetKey({ briefId: 'b1', kind: 'poster', fileName: 'x.png' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^briefs\/b1\/poster\/[0-9a-f-]{36}-x\.png$/);
  });
});

describe('choosePartSize', () => {
  it('uses 16 MiB parts for normal files', () => {
    expect(choosePartSize(500 * MiB)).toBe(16 * MiB);
  });
  it('grows parts so a huge file fits in the part limit', () => {
    const size = 400 * 1024 * MiB;
    expect(Math.ceil(size / choosePartSize(size))).toBeLessThanOrEqual(MAX_PARTS);
  });
});

describe('presigned URLs (no network)', () => {
  it('signs a PUT for the public endpoint', async () => {
    const { url, expiresIn } = await presignPut({
      key: 'briefs/b/video/x.mp4',
      contentType: 'video/mp4',
      contentLength: 10,
    });
    const u = new URL(url);
    expect(u.host).toBe('localhost:9000');
    expect(u.pathname).toBe('/growth-desk/briefs/b/video/x.mp4');
    expect(u.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(expiresIn).toBe(900);
  });
  it('refuses a single PUT above the limit', async () => {
    await expect(
      presignPut({ key: 'k', contentType: 'video/mp4', contentLength: MAX_SINGLE_PUT_BYTES + 1 }),
    ).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE' });
  });
  it('signs a part and a GET with a download name', async () => {
    const part = await presignPart({ key: 'k', uploadId: 'up1', partNumber: 3 });
    expect(new URL(part.url).searchParams.get('partNumber')).toBe('3');
    const get = await presignGet({ key: 'k', downloadName: 'My File.mp4' });
    expect(new URL(get.url).searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="my-file.mp4"',
    );
  });
  it('rejects a bad part number', async () => {
    await expect(presignPart({ key: 'k', uploadId: 'u', partNumber: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
  it('has no public URL without R2_PUBLIC_BASE_URL', () => {
    expect(getPublicUrl('a/b.png')).toBeNull();
  });
});

describe('readStreamCapped', () => {
  it('joins the chunks when under the limit', async () => {
    const buf = await readStreamCapped(Readable.from([Buffer.from('ab'), 'cd']), 4);
    expect(buf.toString()).toBe('abcd');
  });

  it('stops at the first chunk past the limit and calls onTooLarge', async () => {
    let pulled = 0;
    async function* chunks() {
      for (let i = 0; i < 100; i++) {
        pulled++;
        yield Buffer.alloc(10);
      }
    }
    const onTooLarge = vi.fn();
    await expect(readStreamCapped(chunks(), 25, onTooLarge)).rejects.toMatchObject({
      code: 'OBJECT_TOO_LARGE',
      status: 422,
      detail: 'The file is larger than 25 bytes.',
    });
    expect(onTooLarge).toHaveBeenCalledOnce();
    expect(pulled).toBe(3);
  });
});

describe('getObjectBytes (S3 client mocked, no network)', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockSend(impl: (input: unknown, opts: { abortSignal?: AbortSignal }) => unknown) {
    return vi
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(((cmd: { input: unknown }, opts: { abortSignal?: AbortSignal }) =>
        Promise.resolve().then(() => impl(cmd.input, opts))) as never);
  }

  it('returns the bytes of a small object', async () => {
    const send = mockSend(() => ({ ContentLength: 5, Body: Readable.from([Buffer.from('hello')]) }));
    const buf = await getObjectBytes('docs/a.md', 1024);
    expect(buf.toString()).toBe('hello');
    expect(send.mock.calls[0]![0]).toMatchObject({ input: { Key: 'docs/a.md' } });
  });

  it('refuses at once when the stated size is over the limit, and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    mockSend((_input, opts) => {
      signal = opts.abortSignal;
      return { ContentLength: 3 * 1024 * 1024, Body: Readable.from([]) };
    });
    await expect(getObjectBytes('docs/big.pdf', 2 * 1024 * 1024)).rejects.toMatchObject({
      code: 'OBJECT_TOO_LARGE',
      detail: 'The file is larger than 2 MB.',
    });
    expect(signal?.aborted).toBe(true);
  });

  it('aborts while streaming when the size is unknown and the body runs over', async () => {
    let signal: AbortSignal | undefined;
    mockSend((_input, opts) => {
      signal = opts.abortSignal;
      return { Body: Readable.from([Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)]) };
    });
    await expect(getObjectBytes('docs/x.txt', 10)).rejects.toMatchObject({
      code: 'OBJECT_TOO_LARGE',
    });
    expect(signal?.aborted).toBe(true);
  });

  it('maps a missing key to OBJECT_NOT_FOUND and other failures to STORAGE_FAILED', async () => {
    mockSend(() => {
      throw new NoSuchKey({ message: 'gone', $metadata: { httpStatusCode: 404 } });
    });
    await expect(getObjectBytes('docs/missing.md', 10)).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
      status: 404,
    });
    vi.restoreAllMocks();
    mockSend(() => {
      throw new Error('socket hang up');
    });
    await expect(getObjectBytes('docs/a.md', 10)).rejects.toMatchObject({
      code: 'STORAGE_FAILED',
      status: 502,
    });
  });
});
