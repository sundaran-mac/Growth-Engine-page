/**
 * App shell: every sidebar item opens its screen, the product switcher scopes and persists,
 * and the Cmd+K palette navigates.
 */
import { LIVE, PULSE, storageStateFor } from '../support/env';
import { expect, expectHeading, test } from '../support/fixtures';

test.use({ storageState: storageStateFor('jeeva') });

/** Sidebar label -> expected h1 on that screen (apps/web/src/app/nav.ts). */
const SCREENS: { label: string; path: RegExp; heading: string | RegExp }[] = [
  { label: 'Home', path: /\/$/, heading: /Good (morning|afternoon|evening)/ },
  { label: 'Products', path: /\/products$/, heading: 'Products' },
  { label: 'Ideas', path: /\/ideas/, heading: 'Ideas' },
  { label: 'Plan', path: /\/plan/, heading: /plan · / },
  { label: 'Briefs', path: /\/briefs$/, heading: 'Briefs' },
  { label: 'Studio', path: /\/studio$/, heading: 'Studio' },
  { label: 'Review', path: /\/review$/, heading: 'Review' },
  { label: 'Approvals', path: /\/approvals/, heading: 'Approvals' },
  { label: 'Publish', path: /\/publish$/, heading: 'Publish' },
  { label: 'Schedule', path: /\/schedule/, heading: /^Schedule/ },
  { label: 'Analytics', path: /\/analytics/, heading: /^Analytics/ },
  { label: 'Sales', path: /\/sales/, heading: 'Sales pipeline' },
  { label: 'Settings', path: /\/settings/, heading: 'Settings' },
  { label: 'Integrations', path: /\/integrations/, heading: 'Integrations and team' },
];

test.describe('shell', () => {
  for (const screen of SCREENS) {
    test(`sidebar "${screen.label}" opens its screen`, async ({ page }) => {
      // Start on a screen with no in-page links that share a sidebar name.
      await page.goto(screen.label === 'Products' ? '/briefs' : '/products');
      // Approvals carries a live count in its name ("Approvals, 3 waiting").
      await page
        .getByRole('link', { name: new RegExp(`^${screen.label}(\\s*,\\s*\\d+ waiting)?$`) })
        .first()
        .click();
      await expect(page).toHaveURL(screen.path);
      await expectHeading(page, screen.heading);
      await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
    });
  }

  test('product switcher changes the product and keeps it after reload', async ({ page }) => {
    await page.goto('/briefs');
    await expectHeading(page, 'Briefs');

    await page.getByRole('button', { name: /^(Product: .*\. Change product|Choose a product)$/ }).click();
    await page.getByRole('menuitemradio', { name: new RegExp(PULSE) }).click();

    await expect(page.getByRole('button', { name: `Product: ${PULSE}. Change product` })).toBeVisible();
    await expect(page.getByText(`One piece, fully written down · ${PULSE}`)).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: `Product: ${PULSE}. Change product` })).toBeVisible();

    await page.getByRole('button', { name: `Product: ${PULSE}. Change product` }).click();
    await page.getByRole('menuitemradio', { name: new RegExp(LIVE) }).click();
    await expect(page.getByText(`One piece, fully written down · ${LIVE}`)).toBeVisible();
  });

  test('Cmd+K opens the palette, finds a screen, and switches product', async ({ page }) => {
    await page.goto('/products');
    await expectHeading(page, 'Products');

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder('Search everything').fill('Sales');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sales/);
    await expectHeading(page, 'Sales pipeline');
    await expect(palette).toBeHidden();

    await page.getByRole('button', { name: 'Search everything' }).first().click();
    await page.getByRole('dialog').getByPlaceholder('Search everything').fill(PULSE);
    await page.getByRole('option', { name: new RegExp(PULSE) }).click();
    await expect(page.getByRole('button', { name: `Product: ${PULSE}. Change product` })).toBeVisible();
  });

  test('an unknown route shows the not found screen inside the shell', async ({ page }) => {
    await page.goto('/this-does-not-exist');
    await expectHeading(page, 'Page not found');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });
});
