/**
 * Audit log helper. Every mutating action calls `writeAudit` (BUILD-PLAN section 4).
 * Pass the transaction handle when the change runs in a transaction, so both commit together.
 */
import type { Request } from 'express';
import { db, type DbOrTx } from '../db/client.js';
import { auditLogs } from '../db/schema/index.js';

export interface AuditEntry {
  actorId: string | null;
  /** Dotted verb, for example `brief.freeze` or `approval.decide`. */
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ip?: string | null;
}

/** Fields that must never land in the audit log. */
const SECRET_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'accessTokenEnc',
  'refreshTokenEnc',
]);

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEYS.has(k) ? '[redacted]' : scrub(v),
      ]),
    );
  }
  return value;
}

export async function writeAudit(entry: AuditEntry, tx: DbOrTx = db): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before === undefined ? null : scrub(entry.before),
    after: entry.after === undefined ? null : scrub(entry.after),
    requestId: entry.requestId ?? null,
    ip: entry.ip ?? null,
  });
}

/** Actor, request id and ip from a request, to spread into `writeAudit`. */
export function auditContext(req: Request): Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'> {
  return {
    actorId: req.user?.id ?? null,
    requestId: req.id ? String(req.id) : null,
    ip: req.ip ?? null,
  };
}
