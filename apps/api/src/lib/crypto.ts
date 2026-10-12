/**
 * Password hashing (argon2id), token encryption at rest (AES-256-GCM) and session token helpers.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import argon2 from 'argon2';
import { env } from '../config/env.js';

/* ---------- Passwords ---------- */

/** OWASP 2024 baseline for argon2id: 19 MiB memory, 2 iterations, 1 lane. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** A fixed hash used to spend the same time when the email is unknown (no user enumeration). */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/* ---------- Secrets at rest (AES-256-GCM) ---------- */

const ENC_VERSION = 'v1';
const IV_BYTES = 12;

/** Encrypts text. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plaintext: string, key: Buffer = env.encryptionKey): string {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** Decrypts a value made by `encryptSecret`. Throws if it was changed or the key is wrong. */
export function decryptSecret(payload: string, key: Buffer = env.encryptionKey): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== ENC_VERSION) throw new Error('Unknown secret format');
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/* ---------- Tokens ---------- */

/** URL-safe random token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Keyed hash of a session token. Only this value is stored in the database. */
export function hashToken(token: string, secret: string = env.sessionSecret): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
