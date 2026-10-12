/**
 * Prototype flow C "Plan the month" (functional doc section 10):
 * Plan -> check the mix and occasions -> Freeze month -> Briefs.
 * Uses a far-future month that only this suite touches; beforeAll makes it a fresh draft
 * (unfreezing as admin when a previous run froze it).
 */
import { Api } from '../support/api';
import { LIVE, storageStateFor } from '../support/env';
import { chooseProduct, expect, expectHeading, test, toast } from '../support/fixtures';

test.use({ storageState: storageStateFor('elan') });

const MONTH = '2030-06';
const MONTH_NAME = 'June';
let liveId: string;

test.beforeAll(async () => {
  const api = await Api.as('elan');
  try {
    liveId = (await api.productByName(LIVE)).id;
    let plan = await api.plan(liveId, MONTH);
    if (plan?.status === 'frozen') await api.post(`/plans/${plan.id}/unfreeze`);
    if (!plan) plan = await api.createPlan(liveId, MONTH);
    if (plan.items.length < 2) {
      await api.addPlanItem(plan.id, { date: '2030-06-04', title: 'E2E founder film', mode: 'M1', channel: 'instagram' });
      await api.addPlanItem(plan.id, { date: '2030-06-12', title: 'E2E poster', mode: 'M4', channel: 'facebook' });
    }
  } finally {
    await api.dispose();
  }
});

test('flow C: open the plan, check the mix, freeze the month, go to Briefs', async ({ page }) => {
  await chooseProduct(page, liveId);

  // 1. Open plan
  await page.goto(`/plan?month=${MONTH}`);
  await expectHeading(page, `${MONTH_NAME} plan · ${LIVE}`);
  await expect(page.getByRole('grid', { name: 'Month calendar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /E2E founder film/ }).first()).toBeVisible();

  // 2. Check the mix and the occasions
  await page.getByRole('button', { name: 'Mix check' }).click();
  const checks = page.getByRole('complementary', { name: 'Plan checks' });
  await expect(checks.getByRole('heading', { name: 'Mix check' })).toBeVisible();
  await expect(checks.getByRole('heading', { name: 'Occasions this month' })).toBeVisible();
  await expect(checks.getByRole('heading', { name: /^(Nothing to fix|\d+ things? to fix)$/ })).toBeVisible();

  // 3. Freeze month -> Briefs
  await page.getByRole('button', { name: 'Freeze month' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Freeze the ${MONTH_NAME} plan?` });
  await confirm.getByRole('button', { name: 'Freeze month' }).click();
  await expect(toast(page, `${MONTH_NAME} plan frozen`)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Pieces cannot move.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Freeze month' })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Briefs' }).click();
  await expectHeading(page, 'Briefs');
});

test('a month with no plan offers to start one', async ({ page }) => {
  await chooseProduct(page, liveId);
  // A month far enough ahead that no run ever creates it.
  await page.goto('/plan?month=2099-01');
  await expectHeading(page, `January plan · ${LIVE}`);
  await expect(page.getByText('No January plan yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start the January plan' })).toBeVisible();
});
