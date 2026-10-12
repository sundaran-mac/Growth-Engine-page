/**
 * Test data builders for the publish module tests (not a test file itself).
 */
import { randomUUID } from 'node:crypto';
import type { BriefStage, ChannelAction, ChannelStatus, Platform } from '@growth-desk/contract';
import { db } from '../../db/client.js';
import { approvals, assets, briefs, channelAccounts, products } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { encryptSecret } from '../../lib/crypto.js';

let codeSeq = 100;

export async function makeBrief(opts: {
  productId: string;
  stage?: BriefStage;
  version?: number;
  channels?: Platform[];
  ownerId?: string | null;
  approved?: { claims?: boolean; brand?: boolean };
}): Promise<{ id: string; code: string }> {
  codeSeq += 1;
  const code = `REEL-${codeSeq}`;
  const version = opts.version ?? 1;
  const [row] = await db
    .insert(briefs)
    .values({
      code,
      kind: 'reel',
      productId: opts.productId,
      title: '60 seconds with Elan',
      mode: 'M1',
      stage: opts.stage ?? 'approved',
      hook: 'Why we built Live',
      ask: 'Try it tonight',
      ratios: ['9:16'],
      captionLanguages: ['en', 'ta'],
      channels: opts.channels ?? ['instagram', 'linkedin', 'whatsapp'],
      ownerId: opts.ownerId ?? null,
      version,
    })
    .returning({ id: briefs.id });
  const id = row!.id;
  const approved = { claims: true, brand: true, ...opts.approved };
  for (const gate of ['claims', 'brand'] as const) {
    const ok = approved[gate];
    await db.insert(approvals).values({
      briefId: id,
      version,
      gate,
      decision: ok ? 'approved' : 'pending',
      decidedAt: ok ? new Date() : null,
      dueAt: new Date(Date.now() + 86_400_000),
    });
  }
  return { id, code };
}

export async function makeChannel(opts: {
  platform: Platform;
  status?: ChannelStatus;
  withToken?: boolean;
  actions?: ChannelAction[];
  productId?: string | null;
  externalAccountId?: string | null;
  refresh?: boolean;
  expiresAt?: Date | null;
  connectedById?: string | null;
}): Promise<{ id: string }> {
  const withToken = opts.withToken ?? true;
  const [row] = await db
    .insert(channelAccounts)
    .values({
      platform: opts.platform,
      displayName: `Test ${opts.platform}`,
      status: opts.status ?? 'connected',
      allowedActions: opts.actions ?? ['publish'],
      productId: opts.productId ?? null,
      externalAccountId: opts.externalAccountId === undefined ? (withToken ? `ext-${randomUUID().slice(0, 8)}` : null) : opts.externalAccountId,
      accessTokenEnc: withToken ? encryptSecret('access-token-plain') : null,
      refreshTokenEnc: opts.refresh ? encryptSecret('refresh-token-plain') : null,
      expiresAt: opts.expiresAt ?? null,
      connectedById: opts.connectedById ?? null,
    })
    .returning({ id: channelAccounts.id });
  return { id: row!.id };
}

export async function makeAsset(briefId: string, opts: { kind?: 'video' | 'poster' | 'cutdown'; ratio?: string } = {}): Promise<{ id: string }> {
  const [row] = await db
    .insert(assets)
    .values({
      briefId,
      kind: opts.kind ?? 'video',
      ratio: opts.ratio ?? '9:16',
      storageKey: `briefs/${briefId}/video/${randomUUID()}-master.mp4`,
      fileName: 'master.mp4',
      mimeType: opts.kind === 'poster' ? 'image/jpeg' : 'video/mp4',
      sizeBytes: 10,
      durationMs: 58_000,
      status: 'ready',
    })
    .returning({ id: assets.id });
  return { id: row!.id };
}

export async function setProductOwner(productId: string, ownerId: string): Promise<void> {
  await db.update(products).set({ ownerId }).where(eq(products.id, productId));
}
