import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hashToken,
  randomToken,
  safeEqual,
  verifyPassword,
} from './crypto.js';

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('s3cret pass');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 's3cret pass')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
  it('returns false for a broken hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('secrets at rest', () => {
  const key = randomBytes(32);
  it('round-trips text', () => {
    const enc = encryptSecret('meta-access-token-123', key);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('meta-access-token-123');
    expect(decryptSecret(enc, key)).toBe('meta-access-token-123');
  });
  it('uses a new IV every time', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });
  it('fails on tampered data or the wrong key', () => {
    const enc = encryptSecret('token', key);
    const parts = enc.split('.');
    const data = Buffer.from(parts[3]!, 'base64url');
    data[0] = data[0]! ^ 0xff;
    const tampered = [...parts.slice(0, 3), data.toString('base64url')].join('.');
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
    expect(() => decryptSecret('v0.x.y.z', key)).toThrow(/format/);
  });
  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptSecret('x', randomBytes(16))).toThrow();
  });
});

describe('tokens', () => {
  it('makes long random URL-safe tokens', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });
  it('hashes tokens with a secret', () => {
    expect(hashToken('abc', 'k1')).toBe(hashToken('abc', 'k1'));
    expect(hashToken('abc', 'k1')).not.toBe(hashToken('abc', 'k2'));
  });
  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
