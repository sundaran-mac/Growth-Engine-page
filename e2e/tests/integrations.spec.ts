/**
 * Integrations: status cards are visible, and Connect explains clearly when keys are missing.
 * Local Docker runs with no Meta, Google or LinkedIn keys (health reports them as false).
 */
import type { Page } from '@playwright/test';
import { API_PREFIX, storageStateFor } from '../support/env';
import { expect, expectHeading, test } from '../support/fixtures';

test.use({ storageState: storageStateFor('elan') });

const CHANNELS = ['Instagram', 'Facebook Page', 'YouTube', 'LinkedIn', 'WhatsApp'];
const CHIP = /Connected|Needs app approval|Manual|Not connected|Error|Hand-off|Check first|Not set up|Off/;

function card(page: Page, name: string) {
  return page
    .getByRole('list', { name: 'Integrations' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

test('status cards are visible for every channel and tool', async ({ page }) => {
  await page.goto('/integrations');
  await expectHeading(page, 'Integrations and team');
  for (const name of [...CHANNELS, 'Claude', 'GitHub']) {
    const c = card(page, name);
    await expect(c, `card for ${name}`).toBeVisible();
    await expect(c).toContainText(CHIP);
  }
});

test('Connect shows a clear message when the platform keys are missing', async ({ page, request }) => {
  const health = await (await request.get(`${API_PREFIX}/health`)).json();
  test.skip(health.features?.meta === true, 'Meta keys are set on this server, so Connect would leave the app');

  await page.goto('/integrations');
  await expectHeading(page, 'Integrations and team');
  const instagram = card(page, 'Instagram');
  await instagram.getByRole('button', { name: /^(Connect|Reconnect)$/ }).click();

  const message = page.getByText(/Instagram cannot connect yet|turned off because its keys are not set|not set up on the server yet/).first();
  await expect(message).toBeVisible();
  await expect(page.getByText(/Validation failed/)).toHaveCount(0);
  await expect(page).toHaveURL(/\/integrations/);
});
