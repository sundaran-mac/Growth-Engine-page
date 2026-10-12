/**
 * Seam over lib/storage for document processing: reads and stats stored objects, with test
 * hooks so the settings tests run without object storage. The real reads are
 * `getObjectBytes` and `headObject` in lib/storage.ts.
 */
import { getObjectBytes, headObject } from '../../lib/storage.js';

export type ObjectReader = (key: string, maxBytes: number) => Promise<Buffer>;

const storageReader: ObjectReader = (key, maxBytes) => getObjectBytes(key, maxBytes);

let reader: ObjectReader = storageReader;

/** Whole object as bytes; fails with OBJECT_TOO_LARGE above `maxBytes`. */
export function readObject(key: string, maxBytes: number): Promise<Buffer> {
  return reader(key, maxBytes);
}

/** Test hook: swap the reader (pass null to restore). */
export function setObjectReaderForTests(fake: ObjectReader | null): void {
  reader = fake ?? storageReader;
}

export type ObjectStat = (
  key: string,
) => Promise<{ sizeBytes: number; contentType: string | null } | null>;

let stat: ObjectStat = headObject;

/** Size and type of a stored object, or null when it is missing. */
export function statObject(key: string): ReturnType<ObjectStat> {
  return stat(key);
}

/** Test hook: swap the stat call (pass null to restore). */
export function setObjectStatForTests(fake: ObjectStat | null): void {
  stat = fake ?? headObject;
}
