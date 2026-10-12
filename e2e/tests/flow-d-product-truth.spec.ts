/**
 * Prototype flow D "A product's truth" (functional doc section 10):
 * Products -> Open product kit -> promise, behaviours, never-say -> Sign kit -> Ideas.
 */
import { Api } from '../support/api';
import { LIVE, runTag } from '../support/env';
import { chooseProduct, expect, expectHeading, test, toast } from '../support/fixtures';

const word = `e2e-${runTag().toLowerCase()}`;

test.afterAll(async () => {
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

test('flow D: a product owner reads, changes and signs the kit, then goes to Ideas', async ({ pageAs }) => {
  const api = await Api.as('liveowner');
  const live = await api.productByName(LIVE);
  await api.dispose();

  const page = await pageAs('liveowner');
  await chooseProduct(page, live.id);

  // 1. Products -> Open product kit
  await page.goto('/products');
  await expectHeading(page, 'Products');
  await page.getByRole('article', { name: LIVE }).getByRole('link', { name: /Open product kit/ }).click();
  await expectHeading(page, `${LIVE} · product kit`);

  // 2. Promise, behaviours, never-say
  await expect(page.getByRole('region', { name: 'Promise' })).toContainText('Be there for your people');
  await expect(page.getByRole('region', { name: 'Three true behaviours' })).toContainText('006');
  await expect(page.getByRole('region', { name: 'Never say' })).toContainText('anonymous');

  // 3. Sign kit (a signed kit must change first, so the owner adds one word)
  await page.getByRole('button', { name: 'Edit kit' }).click();
  await page.getByLabel('Add to Never say').fill(word);
  await page.getByRole('region', { name: 'Never say' }).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save kit' }).click();
  await expect(toast(page, /Saved as version \d+/)).toBeVisible();

  await page.getByRole('button', { name: 'Sign kit' }).click();
  const dialog = page.getByRole('alertdialog', { name: /Sign kit version \d+\?/ });
  await dialog.getByRole('button', { name: 'Sign kit' }).click();
  await expect(toast(page, /Kit version \d+ signed/)).toBeVisible();
  await expect(page.getByText(/signed by Meera Iyer on/)).toBeVisible();

  // -> Ideas. The prototype goes from the signed kit to Ideas; the app has no link there yet,
  // so the sidebar is used (reported to the lead).
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ideas' }).click();
  await expectHeading(page, 'Ideas');
  await expect(page.getByRole('button', { name: `Product: ${LIVE}. Change product` })).toBeVisible();
});
