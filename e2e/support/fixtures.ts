/**
 * Shared test fixtures.
 * - `pageAs(role)`: a fresh signed-in page for another seed user, inside the same test.
 * - `chooseProduct(page, productId)`: sets the sidebar product before the app loads, so every
 *   product-scoped screen opens on that product (the switcher keeps its choice in localStorage).
 */
import { test as base, expect, type Page } from '@playwright/test';
import { BASE_URL, storageStateFor, type RoleKey } from './env';

/** Same key and shape as apps/web/src/stores/ui.ts (zustand persist, version 1). */
const UI_STORAGE_KEY = 'growth-desk:ui';

export async function chooseProduct(page: Page, productId: string): Promise<void> {
  await page.addInitScript(
    ([key, id]) => {
      try {
        window.localStorage.setItem(key, JSON.stringify({ state: { selectedProductId: id }, version: 1 }));
      } catch {
        /* storage blocked: the app falls back to the first product */
      }
    },
    [UI_STORAGE_KEY, productId] as const,
  );
}

/** Waits for the page h1 (every screen renders its title in the top bar). */
export async function expectHeading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** A sonner toast with this text. */
export function toast(page: Page, text: string | RegExp) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).first();
}

interface Fixtures {
  pageAs: (role: RoleKey) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  pageAs: async ({ browser }, use) => {
    const opened: { close: () => Promise<void> }[] = [];
    await use(async (role) => {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        storageState: storageStateFor(role),
        viewport: { width: 1440, height: 900 },
        timezoneId: 'Asia/Kolkata',
      });
      opened.push(context);
      return context.newPage();
    });
    for (const c of opened) await c.close();
  },
});

export { expect };
