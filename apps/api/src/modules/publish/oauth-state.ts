/**
 * OAuth `state`: signed (HMAC-SHA256 with SESSION_SECRET), expiring, bound to the user and the
 * product. The PKCE verifier rides inside it encrypted (AES-256-GCM), so nothing is stored
 * server side and nobody who sees the URL can read the verifier.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { OAuthPlatform } from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret, safeEqual } from '../../lib/crypto.js';

export const OAUTH_STATE_TTL_MS = 10 * 60_000;

const payloadSchema = z.object({
  p: z.enum(['meta', 'google', 'linkedin']),
  u: z.uuid(),
  pr: z.uuid().nullable(),
  n: z.string().min(16),
  exp: z.number().int(),
  v: z.string().nullable(),
});

export interface OAuthStatePayload {
  platform: OAuthPlatform;
  userId: string;
  productId: string | null;
  /** Plain PKCE verifier, or null when the provider does not use PKCE. */
  codeVerifier: string | null;
  expiresAt: number;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(`oauth-state:${body}`).digest('base64url');
}

export function createOAuthState(
  input: { platform: OAuthPlatform; userId: string; productId: string | null; codeVerifier: string | null },
  opts: { now?: number; secret?: string; key?: Buffer } = {},
): string {
  const now = opts.now ?? Date.now();
  const payload = {
    p: input.platform,
    u: input.userId,
    pr: input.productId,
    n: randomBytes(16).toString('base64url'),
    exp: now + OAUTH_STATE_TTL_MS,
    v: input.codeVerifier ? encryptSecret(input.codeVerifier, opts.key ?? env.encryptionKey) : null,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, opts.secret ?? env.sessionSecret)}`;
}

export type StateCheck =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_platform' };

export function verifyOAuthState(
  state: string,
  platform: OAuthPlatform,
  opts: { now?: number; secret?: string; key?: Buffer } = {},
): StateCheck {
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, mac] = parts as [string, string];
  if (!safeEqual(mac, sign(body, opts.secret ?? env.sessionSecret))) return { ok: false, reason: 'bad_signature' };
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const parsedPayload = payloadSchema.safeParse(raw);
  if (!parsedPayload.success) return { ok: false, reason: 'malformed' };
  const p = parsedPayload.data;
  if ((opts.now ?? Date.now()) > p.exp) return { ok: false, reason: 'expired' };
  if (p.p !== platform) return { ok: false, reason: 'wrong_platform' };
  let codeVerifier: string | null = null;
  if (p.v) {
    try {
      codeVerifier = decryptSecret(p.v, opts.key ?? env.encryptionKey);
    } catch {
      return { ok: false, reason: 'malformed' };
    }
  }
  return {
    ok: true,
    payload: { platform: p.p, userId: p.u, productId: p.pr, codeVerifier, expiresAt: p.exp },
  };
}

/** RFC 7636: 43 to 128 characters from the unreserved set. */
export function createCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
