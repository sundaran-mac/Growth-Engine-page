/**
 * Products: the list, opening a kit, editing a never-say chip, and signing as the owner.
 * Seed data is changed only by adding a tagged word; afterAll removes it and signs the kit again.
 */
import { Api } from '../support/api';
import { LIVE, runTag, storageStateFor } from '../support/env';
import { chooseProduct, expect, expectHeading, test, toast } from '../support/fixtures';

const word = `e2e-${runTag().toLowerCase()}`;

test.describe('products', () => {
  test.use({ storageState: storageStateFor('jeeva') });

  test.afterAll(async () => {
    // Remove every e2e word and leave the Live kit signed by its owner, as the seed had it.
    const owner = await Api.as('liveowner');
    try {
      const live = await owner.productByName(LIVE);
      const kit = await owner.kit(live.id);
      const clean = kit.neverSay.filter((w) => !w.startsWith('e2e-'));
      const saved = clean.length !== kit.neverSay.length ? await owner.saveKit(live.id, kit, { neverSay: clean }) : kit;
      if (saved.status === 'draft') await owner.post(`/products/${live.id}/kit/sign`);
    } finally {
      await owner.dispose();
    }
  });

  test('lists every product with its kit readiness', async ({ page }) => {
    await page.goto('/products');
    await expectHeading(page, 'Products');
    for (const name of ['Humini Live', 'Humini Pulse', 'Humini Proof']) {
      const card = page.getByRole('article', { name });
      await expect(card).toBeVisible();
      await expect(card.getByRole('progressbar', { name: 'Kit completeness' })).toBeVisible();
      await expect(card.getByRole('link', { name: /Open product kit/ })).toBeVisible();
    }
  });

  test('opens the kit and edits a never-say chip', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('article', { name: LIVE }).getByRole('link', { name: /Open product kit/ }).click();
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]+\/kit$/);
    await expectHeading(page, `${LIVE} · product kit`);
    for (const section of ['Promise', 'Three true behaviours', 'Never say']) {
      await expect(page.getByRole('region', { name: section })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Never say' })).toContainText('strangers');

    await page.getByRole('button', { name: 'Edit kit' }).click();
    const input = page.getByLabel('Add to Never say');
    await input.fill(word);
    await input.press('Enter');
    const chips = page.getByRole('list', { name: 'Never say' });
    await expect(chips.getByText(word, { exact: true })).toBeVisible();

    // Duplicates are refused, ignoring case.
    await input.fill(word.toUpperCase());
    await input.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'is already in the list' })).toBeVisible();
    await input.fill('');

    await page.getByRole('button', { name: 'Save kit' }).click();
    await expect(toast(page, /Saved as version \d+|Kit saved/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Never say' })).toContainText(word);

    // An editor is not the owner: the kit now waits for the owner's signature.
    await expect(page.getByText('Waiting for the owner to sign')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign kit' })).toHaveCount(0);
  });

  test('the product owner signs the kit', async ({ pageAs }) => {
    const owner = await Api.as('liveowner');
    const live = await owner.productByName(LIVE);
    let kit = await owner.kit(live.id);
    if (kit.status !== 'draft') {
      // Make an unsigned version to sign (the previous test may have been skipped or retried).
      kit = await owner.saveKit(live.id, kit, { neverSay: [...kit.neverSay.filter((w) => w !== word), word] });
    }
    await owner.dispose();

    const page = await pageAs('liveowner');
    await chooseProduct(page, live.id);
    await page.goto(`/products/${live.id}/kit`);
    await expectHeading(page, `${LIVE} · product kit`);
    await page.getByRole('button', { name: 'Sign kit' }).click();
    const dialog = page.getByRole('alertdialog', { name: `Sign kit version ${kit.version}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Sign kit' }).click();
    await expect(toast(page, `Kit version ${kit.version} signed`)).toBeVisible();
    await expect(page.getByText(`Signed · v${kit.version}`)).toBeVisible();
  });
});
