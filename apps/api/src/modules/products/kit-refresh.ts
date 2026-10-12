/**
 * "Refresh from repo": reads the product repo's docs/specs through the GitHub API and lists
 * the spec files that changed since the kit was signed. Nothing in the kit changes on its own:
 * a person reads the list and edits the kit (spec 001, screen 02).
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { KitRefreshResult } from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { productSettings, products } from '../../db/schema/index.js';
import { featureDisabled, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { notifyMany } from '../../lib/notifications.js';
import { listSpecChangesSince, listSpecFiles, parseGithubRepo } from './github.js';
import { currentKits, loadProduct, recordKitRefresh, type AuditCtx } from './service.js';

export function githubNotConnected() {
  return featureDisabled(
    'GitHub',
    'GitHub is not connected. Set GITHUB_TOKEN to refresh the kit from the repo.',
  );
}

export interface RefreshOptions {
  /** Notify the owner and backup when changes are found (the scheduled job does this). */
  notify?: boolean;
}

export async function refreshKit(
  productId: string,
  ctx: AuditCtx,
  opts: RefreshOptions = {},
): Promise<KitRefreshResult> {
  const token = env.githubToken;
  if (!token) throw githubNotConnected();

  const product = await loadProduct(productId);
  const [settings] = await db
    .select({ githubRepo: productSettings.githubRepo, branch: productSettings.githubBaseBranch })
    .from(productSettings)
    .where(eq(productSettings.productId, productId))
    .limit(1);
  const repo = parseGithubRepo(product.repoUrl) ?? parseGithubRepo(settings?.githubRepo);
  if (!repo) {
    throw unprocessable(
      'This product has no GitHub repo. Add the repo URL in Settings > General first.',
      'REPO_NOT_SET',
    );
  }
  const kit = (await currentKits([productId])).get(productId);
  if (!kit) throw unprocessable('This product has no kit yet.', 'KIT_MISSING');

  const found = kit.signedAt
    ? await listSpecChangesSince(repo, kit.signedAt, token)
    : await listSpecFiles(repo, settings?.branch ?? 'main', token);

  const cited = new Set(
    [...kit.behaviours, ...kit.notBuilt].map((b) => b.specRef).filter((v): v is string => !!v),
  );
  const result: KitRefreshResult = {
    repo: `${repo.owner}/${repo.name}`,
    checkedAt: new Date().toISOString(),
    since: kit.signedAt ? kit.signedAt.toISOString() : null,
    kitVersion: kit.version,
    truncated: found.truncated,
    changes: found.changes.map((c) => ({
      ...c,
      citedInKit: c.specRef ? cited.has(c.specRef) || cited.has(c.specRef.slice(0, 3)) : false,
    })),
  };

  await db.transaction(async (tx) => {
    await recordKitRefresh(productId, result, ctx, tx);
    if (opts.notify && kit.signedAt && result.changes.length > 0) {
      const n = result.changes.length;
      await notifyMany(
        [product.ownerId, product.backupId],
        {
          kind: 'kit_changed',
          title: `${product.name}: ${n} spec ${n === 1 ? 'file' : 'files'} changed since the kit was signed`,
          body: 'Open the kit, check the list and re-sign if the truth changed.',
          link: `/products/${productId}/kit`,
          entity: 'product',
          entityId: productId,
        },
        tx,
      );
    }
  });
  return result;
}

/** Products the daily job checks: a repo URL and a signed current kit. */
export async function productsToRefresh(): Promise<string[]> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(isNotNull(products.repoUrl)));
  const kits = await currentKits(rows.map((r) => r.id));
  return rows.filter((r) => kits.get(r.id)?.signedAt).map((r) => r.id);
}

/** Runs the refresh for every product; one failure never stops the others. */
export async function refreshAllKits(): Promise<{ checked: number; failed: number }> {
  if (!env.githubToken) {
    logger.info('kit.refresh skipped: GitHub is not connected');
    return { checked: 0, failed: 0 };
  }
  let checked = 0;
  let failed = 0;
  for (const id of await productsToRefresh()) {
    try {
      await refreshKit(id, { actorId: null, requestId: null, ip: null }, { notify: true });
      checked += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ err, productId: id }, 'kit.refresh failed for a product');
    }
  }
  return { checked, failed };
}
