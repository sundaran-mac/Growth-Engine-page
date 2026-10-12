/**
 * Small record builders for INSIGHTS tests (test-only; never imported by app code).
 */
import { randomUUID } from 'node:crypto';
import type { ContentMode, Platform } from '@growth-desk/contract';
import { computeValueScore } from '@growth-desk/contract';
import { db } from '../../db/client.js';
import {
  briefs,
  channelAccounts,
  keywordRules,
  metricSnapshots,
  posts,
} from '../../db/schema/index.js';

let counter = 100;

export async function makeBrief(
  productId: string,
  opts: { mode?: ContentMode; title?: string; version?: number } = {},
) {
  counter += 1;
  const [row] = await db
    .insert(briefs)
    .values({
      code: `REEL-${String(counter).padStart(3, '0')}`,
      productId,
      title: opts.title ?? `Brief ${counter}`,
      mode: opts.mode ?? 'M1',
      version: opts.version ?? 1,
    })
    .returning();
  return row!;
}

export async function makeAccount(
  platform: Platform,
  opts: {
    productId?: string;
    externalAccountId?: string;
    status?: 'connected' | 'manual' | 'needs_approval';
  } = {},
) {
  const [row] = await db
    .insert(channelAccounts)
    .values({
      platform,
      displayName: `${platform} account`,
      productId: opts.productId ?? null,
      externalAccountId: opts.externalAccountId ?? randomUUID(),
      status: opts.status ?? 'connected',
    })
    .returning();
  return row!;
}

export async function makePost(
  briefId: string,
  channelAccountId: string,
  opts: {
    status?: 'draft' | 'scheduled' | 'published' | 'manual_pending';
    scheduledAt?: Date;
    publishedAt?: Date;
    externalId?: string;
    trackedUrl?: string;
  } = {},
) {
  const status = opts.status ?? 'published';
  const [row] = await db
    .insert(posts)
    .values({
      briefId,
      briefVersion: 1,
      channelAccountId,
      status,
      scheduledAt: opts.scheduledAt ?? (status === 'draft' ? null : new Date()),
      publishedAt: status === 'published' ? (opts.publishedAt ?? new Date()) : null,
      externalId: opts.externalId ?? null,
      trackedUrl: opts.trackedUrl ?? null,
    })
    .returning();
  return row!;
}

export async function makeSnapshot(
  postId: string,
  date: string,
  m: Partial<{
    reach: number;
    saves: number;
    shares: number;
    comments: number;
    clicks: number;
    installs: number;
    activations: number;
  }>,
) {
  const values = {
    reach: m.reach ?? 0,
    saves: m.saves ?? 0,
    shares: m.shares ?? 0,
    comments: m.comments ?? 0,
    clicks: m.clicks ?? 0,
    installs: m.installs ?? 0,
    activations: m.activations ?? 0,
  };
  await db
    .insert(metricSnapshots)
    .values({ postId, date, ...values, valueScore: computeValueScore(values) });
}

export async function makeKeywordRule(
  productId: string,
  keyword = 'CIRCLE',
  link: string | null = 'https://live.humini.app/?utm_source=instagram',
) {
  const [row] = await db
    .insert(keywordRules)
    .values({ productId, platform: 'instagram', keyword, replyText: 'Here is the link', link })
    .returning();
  return row!;
}
