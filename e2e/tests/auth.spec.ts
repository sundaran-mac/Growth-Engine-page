/**
 * Sign in, wrong password, sign out, and the redirect to /login for signed-out visitors.
 * These tests start signed out (no storage state).
 */
import { PASSWORD, USERS } from '../support/env';
import { expect, expectHeading, test } from '../support/fixtures';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('auth', () => {
  test('a signed-out visitor is sent to /login and comes back after signing in', async ({ page }) => {
    await page.goto('/ideas');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expectHeading(page, 'Sign in');

    await page.getByLabel('Email').fill(USERS.jeeva.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/ideas$/);
    await expectHeading(page, 'Ideas');
  });

  test('a wrong password shows a clear error and stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.jeeva.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // 429 appears only if this test ran more than 10 times in 15 minutes (auth rate limit).
    await expect(page.getByRole('alert')).toHaveText(/Email or password is wrong\.|Too many tries/);
    await expect(page).toHaveURL(/\/login/);
  });

  test('empty fields show field errors without calling the API', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  test('sign out ends the session and protected screens redirect to /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.jeeva.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expectHeading(page, /Good (morning|afternoon|evening)/);

    await page.getByRole('button', { name: `Account: ${USERS.jeeva.name}` }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/approvals');
    await expect(page).toHaveURL(/\/login/);
    await expectHeading(page, 'Sign in');
  });
});
