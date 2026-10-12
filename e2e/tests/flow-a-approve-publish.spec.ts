/**
 * Prototype flow A "Approve and publish a reel" (functional doc section 10):
 * Home "Needs you" -> Approvals: the product owner approves claims, Elan approves brand -> Publish rows.
 * The piece is made fresh through the API (a poster, so a tiny PNG can be the master).
 */
import { Api, briefWaitingForApproval, type BriefLite } from '../support/api';
import { LIVE, runTag } from '../support/env';
import { chooseProduct, expect, expectHeading, test, toast } from '../support/fixtures';

let brief: BriefLite;
let liveId: string;

test.beforeAll(async () => {
  brief = await briefWaitingForApproval(`E2E poster ${runTag()}`);
  const api = await Api.as('elan');
  liveId = (await api.productByName(LIVE)).id;
  await api.dispose();
});

test('flow A: both gates approve on the Approvals screen and Publish shows the rows', async ({ pageAs }) => {
  // 1. Home -> Needs you, as the Live product owner
  const owner = await pageAs('liveowner');
  await chooseProduct(owner, liveId);
  await owner.goto('/');
  await expectHeading(owner, /Good (morning|afternoon|evening), Meera/);
  const needsYou = owner.getByRole('region', { name: 'Needs you' });
  const row = needsYou.getByRole('listitem').filter({ hasText: brief.code });
  await expect(row).toContainText('Approve claims');
  await row.getByRole('link', { name: 'Review' }).click();

  // 2. Approvals -> Approve claims (owner)
  await expect(owner).toHaveURL(/\/approvals/);
  await expectHeading(owner, 'Approvals');
  await owner
    .getByRole('list', { name: 'Pieces waiting for approval' })
    .getByRole('button', { name: new RegExp(brief.code) })
    .click();
  await expect(owner.getByRole('region', { name: `${brief.code} · claims in this piece` })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Approve brand' })).toHaveCount(0);
  await owner.getByRole('button', { name: 'Approve claims' }).click();
  await expect(toast(owner, 'Claims approved')).toBeVisible();
  await expect(toast(owner, 'Waiting for the other gate.')).toBeVisible();

  // 2b. Approve brand (Elan)
  const elan = await pageAs('elan');
  await chooseProduct(elan, liveId);
  await elan.goto('/approvals');
  await expectHeading(elan, 'Approvals');
  await elan
    .getByRole('list', { name: 'Pieces waiting for approval' })
    .getByRole('button', { name: new RegExp(brief.code) })
    .click();
  await elan.getByRole('button', { name: 'Approve brand' }).click();
  await expect(toast(elan, 'Brand approved')).toBeVisible();
  await expect(toast(elan, /Both gates are approved\. \d+ draft posts are ready on Publish\./)).toBeVisible();

  // 3. Publish -> the piece has a row per channel
  await elan.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Publish' }).click();
  await expectHeading(elan, 'Publish');
  await elan
    .getByRole('table', { name: 'Pieces ready to publish, scheduled or live' })
    .getByRole('row', { name: new RegExp(brief.code) })
    .click();
  await expect(elan).toHaveURL(new RegExp(`/publish/${brief.id}$`));
  await expectHeading(elan, `Publish · ${brief.code}`);
  const rows = elan.getByRole('table', { name: /^Channels for this piece/ }).getByRole('row');
  // Header row plus at least one channel row (the brief targets Instagram).
  await expect(rows.nth(1)).toBeVisible();
  await expect(rows.filter({ hasText: 'Instagram' }).first()).toBeVisible();
  await expect(elan.getByText('Publishing is locked')).toHaveCount(0);
});

test('a reviewer who is not a named approver cannot approve', async ({ pageAs }) => {
  const fresh = await briefWaitingForApproval(`E2E poster ${runTag()}`);
  const page = await pageAs('jeeva');
  await chooseProduct(page, liveId);
  await page.goto('/approvals?scope=all');
  await expectHeading(page, 'Approvals');
  await page
    .getByRole('list', { name: 'Pieces waiting for approval' })
    .getByRole('button', { name: new RegExp(fresh.code) })
    .click();
  await expect(page.getByText('You are not the named approver for an open gate on this piece.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Approve (claims|brand)$/ })).toHaveCount(0);

  // Clean up: the owner sends the piece back, so it leaves every approval queue.
  const owner = await Api.as('liveowner');
  await owner.requestChangesOnMyGate(fresh.id);
  await owner.dispose();
});
