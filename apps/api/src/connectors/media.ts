/**
 * Reads the media file from storage (through its presigned GET URL) for platforms that need the
 * bytes pushed to them. Streams or ranges only: a big video is never held in memory whole.
 */
import { UPLOAD_TIMEOUT_MS } from './http.js';
import { ConnectorError } from './types.js';

export interface MediaStream {
  body: ReadableStream<Uint8Array>;
  length: number | null;
  contentType: string | null;
}

export async function openMediaStream(url: string): Promise<MediaStream> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  } catch (err) {
    throw new ConnectorError('NO_MEDIA', 'Could not read the media file from storage.', { cause: err });
  }
  if (!res.ok || !res.body) {
    throw new ConnectorError('NO_MEDIA', `Could not read the media file from storage (HTTP ${res.status}).`, { httpStatus: res.status });
  }
  const len = Number(res.headers.get('content-length'));
  return {
    body: res.body,
    length: Number.isFinite(len) && len > 0 ? len : null,
    contentType: res.headers.get('content-type'),
  };
}

/** Bytes `first..last` (inclusive) of the file. */
export async function readMediaRange(url: string, first: number, last: number): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Range: `bytes=${first}-${last}` },
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ConnectorError('NO_MEDIA', 'Could not read the media file from storage.', { cause: err });
  }
  if (!res.ok) {
    throw new ConnectorError('NO_MEDIA', `Could not read the media file from storage (HTTP ${res.status}).`, { httpStatus: res.status });
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const expected = last - first + 1;
  // A server that ignores Range sends the whole file: cut the part out of it.
  if (res.status === 200 && buf.byteLength > expected) return buf.subarray(first, last + 1);
  return buf;
}
