/**
 * Cross-module functions of the SETTINGS module. Signatures fixed by the lead; bodies by the
 * SETTINGS agent. Other modules import from here only.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Platform } from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import { productDocuments, productKits, products } from '../../db/schema/index.js';
import { notFound } from '../../lib/errors.js';
import { assembleContext, DEFAULT_CONTEXT_TOKENS } from './context.js';
import { computeNextFreeSlots, ensureSettingsRow } from './service.js';

export interface ProductContext {
  /** Plain text block ready to place in a Claude prompt. */
  text: string;
  tokenEstimate: number;
  documentIds: string[];
}

/** Kit + pinned documents + summaries, newest first, cut to the token budget. */
export async function buildProductContext(
  productId: string,
  opts?: { maxTokens?: number },
): Promise<ProductContext> {
  const [product] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw notFound('Product');
  const [kit] = await db
    .select()
    .from(productKits)
    .where(eq(productKits.productId, productId))
    .orderBy(desc(productKits.version))
    .limit(1);
  const docs = await db
    .select({
      id: productDocuments.id,
      title: productDocuments.title,
      pinned: productDocuments.pinned,
      text: productDocuments.extractedText,
      summary: productDocuments.summary,
    })
    .from(productDocuments)
    .where(
      and(eq(productDocuments.productId, productId), inArray(productDocuments.status, ['ready'])),
    )
    .orderBy(desc(productDocuments.createdAt), desc(productDocuments.id));
  return assembleContext(
    {
      productName: product.name,
      kit: kit
        ? {
            promise: kit.promise,
            behaviours: kit.behaviours,
            neverSay: kit.neverSay,
            notBuilt: kit.notBuilt,
            audiences: kit.audiences,
            activationEvent: kit.activationEvent,
          }
        : null,
      pinned: docs
        .filter((d) => d.pinned && d.text)
        .map((d) => ({ id: d.id, title: d.title, text: d.text! })),
      others: docs
        .filter((d) => !d.pinned && d.summary)
        .map((d) => ({ id: d.id, title: d.title, text: d.summary! })),
    },
    opts?.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
  );
}

export interface SlotTime {
  /** UTC instant. */
  at: Date;
  audienceTimezone: string;
  slotId: string;
}

/** Next free posting slots for a product and platform, never before the launch date. */
export async function nextFreeSlots(
  productId: string,
  platform: Platform,
  from: Date,
  count: number,
  tx?: DbOrTx,
): Promise<SlotTime[]> {
  const found = await computeNextFreeSlots(productId, [platform], from, count, tx ?? db);
  return found.map((c) => ({ at: c.at, audienceTimezone: c.audienceTimezone, slotId: c.slotId }));
}

export interface ProductSettingsView {
  productId: string;
  timezone: string;
  launchDate: string | null;
  autoSchedule: boolean;
  approvalSlaHours: number;
  utmCampaignPrefix: string | null;
  trackingBaseUrl: string | null;
  claudeMonthlyTokenCap: number | null;
}

export async function getProductSettings(
  productId: string,
  tx?: DbOrTx,
): Promise<ProductSettingsView> {
  const row = await ensureSettingsRow(productId, tx ?? db);
  return {
    productId: row.productId,
    timezone: row.timezone,
    launchDate: row.launchDate,
    autoSchedule: row.autoSchedule,
    approvalSlaHours: row.approvalSlaHours,
    utmCampaignPrefix: row.utmCampaignPrefix,
    trackingBaseUrl: row.trackingBaseUrl,
    claudeMonthlyTokenCap: row.claudeMonthlyTokenCap,
  };
}
