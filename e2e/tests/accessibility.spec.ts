/**
 * Accessibility smoke with axe on Home, Brief and Approvals.
 * Every violation is attached to the report. The test fails on serious or critical issues,
 * except color-contrast: the Figma muted token (#9c938a) is known to fail and is a design decision.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { Api } from '../support/api';
import { LIVE, runTag, storageStateFor } from '../support/env';
import { chooseProduct, expect, expectHeading, test } from '../support/fixtures';

test.use({ storageState: storageStateFor('jeeva') });

const KNOWN = new Set(['color-contrast']);

async function audit(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Let toasts and skeletons settle before the scan.
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  await testInfo.attach(`axe-${name}.json`, { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  for (const v of summary) {
    testInfo.annotations.push({ type: `axe ${v.impact ?? 'unknown'}`, description: `${name}: ${v.id} (${v.nodes} nodes) ${v.help}` });
  }
  const blocking = summary.filter((v) => !KNOWN.has(v.id) && (v.impact === 'serious' || v.impact === 'critical'));
  expect(blocking, `serious or critical axe violations on ${name}`).toEqual([]);
}

let liveId: string;
let briefId: string;

test.beforeAll(async () => {
  const api = await Api.as('jeeva');
  try {
    liveId = (await api.productByName(LIVE)).id;
    const brief = await api.createBrief({ productId: liveId, title: `E2E axe ${runTag()}`, kind: 'reel', mode: 'M1' });
    briefId = brief.id;
  } finally {
    await api.dispose();
  }
});

test('Home has no serious accessibility violations', async ({ page }, testInfo) => {
  await chooseProduct(page, liveId);
  await page.goto('/');
  await expectHeading(page, /Good (morning|afternoon|evening)/);
  await audit(page, testInfo, 'home');
});

test('Brief has no serious accessibility violations', async ({ page }, testInfo) => {
  await chooseProduct(page, liveId);
  await page.goto(`/briefs/${briefId}`);
  await expect(page.getByRole('region', { name: 'Script' })).toBeVisible();
  await audit(page, testInfo, 'brief');
});

test('Approvals has no serious accessibility violations', async ({ page }, testInfo) => {
  await chooseProduct(page, liveId);
  await page.goto('/approvals?scope=all');
  await expectHeading(page, 'Approvals');
  await audit(page, testInfo, 'approvals');
});
