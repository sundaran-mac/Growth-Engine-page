/**
 * Human brief codes: REEL-031, POSTER-008. One counter row per prefix, bumped atomically.
 */
import { sql } from 'drizzle-orm';
import { BRIEF_KIND_PREFIX, type BriefKind } from '@growth-desk/contract';
import { db, type DbOrTx } from '../db/client.js';
import { briefCodeCounters } from '../db/schema/index.js';

export function formatBriefCode(prefix: string, value: number): string {
  if (!/^[A-Z]+$/.test(prefix)) throw new Error(`Bad code prefix: ${prefix}`);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Bad code number: ${value}`);
  return `${prefix}-${String(value).padStart(3, '0')}`;
}

export function parseBriefCode(code: string): { prefix: string; value: number } | null {
  const m = /^([A-Z]+)-(\d{3,})$/.exec(code);
  return m ? { prefix: m[1]!, value: Number(m[2]) } : null;
}

/** Next code for a kind. Safe under concurrency (single upsert statement). */
export async function nextBriefCode(kind: BriefKind, tx: DbOrTx = db): Promise<string> {
  const prefix = BRIEF_KIND_PREFIX[kind];
  const [row] = await tx
    .insert(briefCodeCounters)
    .values({ prefix, lastValue: 1 })
    .onConflictDoUpdate({
      target: briefCodeCounters.prefix,
      set: { lastValue: sql`${briefCodeCounters.lastValue} + 1` },
    })
    .returning({ value: briefCodeCounters.lastValue });
  return formatBriefCode(prefix, row!.value);
}

/** Makes sure the counter is at least `value` (used by the seed after inserting fixed codes). */
export async function bumpBriefCodeCounter(
  prefix: string,
  value: number,
  tx: DbOrTx = db,
): Promise<void> {
  await tx
    .insert(briefCodeCounters)
    .values({ prefix, lastValue: value })
    .onConflictDoUpdate({
      target: briefCodeCounters.prefix,
      set: { lastValue: sql`greatest(${briefCodeCounters.lastValue}, ${value})` },
    });
}
