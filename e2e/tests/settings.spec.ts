/**
 * Settings: always shows the product chosen in the switcher, and a posting slot edit persists.
 * The slot list is read before the test and put back after it.
 */
import { Api, type SlotLite } from '../support/api';
import { LIVE, PULSE, runTag, storageStateFor } from '../support/env';
import { chooseProduct, expect, expectHeading, test, toast } from '../support/fixtures';

// Elan is an admin and the named owner of Humini Live, so he may edit settings.
test.use({ storageState: storageStateFor('elan') });

let liveId: string;
let originalSlots: SlotLite[] = [];

test.beforeAll(async () => {
  const api = await Api.as('elan');
  try {
    liveId = (await api.productByName(LIVE)).id;
    originalSlots = await api.slots(liveId);
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  const api = await Api.as('elan');
  try {
    await api.replaceSlots(liveId, originalSlots);
  } finally {
    await api.dispose();
  }
});

test('switching product reloads Settings for that product', async ({ page }) => {
  await chooseProduct(page, liveId);
  await page.goto('/settings');
  await expectHeading(page, 'Settings');
  await expect(page.getByRole('tablist', { name: 'Settings sections' })).toBeVisible();
  await expect(page.getByText(`Settings for ${LIVE}. Change the product in the switcher.`)).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(LIVE);

  await page.getByRole('button', { name: `Product: ${LIVE}. Change product` }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(PULSE) }).click();
  await expect(page.getByText(`Settings for ${PULSE}. Change the product in the switcher.`)).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(PULSE);
});

test('a posting slot edit is saved and still there after reload', async ({ page }) => {
  const label = `E2E ${runTag()}`;
  await chooseProduct(page, liveId);
  await page.goto('/settings?tab=schedule');
  await expectHeading(page, 'Settings');
  await expect(page.getByRole('tab', { name: 'Posting schedule', selected: true })).toBeVisible();

  const slots = page.getByRole('region', { name: 'Posting slots' });
  const firstLabel = slots.getByLabel('Label').first();
  await firstLabel.fill(label);
  await expect(page.getByText('You have unsaved changes.')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(toast(page, 'Posting slots saved')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Posting slots' }).getByLabel('Label').first()).toHaveValue(label);
});
