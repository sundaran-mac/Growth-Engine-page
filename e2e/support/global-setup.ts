/**
 * Signs in once per role through the API and saves the cookie as Playwright storage state.
 * Tests then start already signed in: `test.use({ storageState: storageStateFor('elan') })`.
 */
import fs from 'node:fs/promises';
import { request, type FullConfig } from '@playwright/test';
import { API_PREFIX, AUTH_DIR, BASE_URL, ORIGIN, PASSWORD, USERS, storageStateFor, type RoleKey } from './env';

async function signIn(role: RoleKey): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: ORIGIN } });
  try {
    const res = await ctx.post(`${API_PREFIX}/auth/login`, {
      data: { email: USERS[role].email, password: PASSWORD },
    });
    if (!res.ok()) {
      throw new Error(
        `Sign in as ${USERS[role].email} failed: ${res.status()} ${await res.text()}. ` +
          'Is the stack up and seeded? Try `npm run docker:up`.',
      );
    }
    await ctx.storageState({ path: storageStateFor(role) });
  } finally {
    await ctx.dispose();
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const health = await fetch(`${BASE_URL}${API_PREFIX}/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`The API is not reachable at ${BASE_URL}${API_PREFIX}/health. Start the stack first.`);
  }
  await fs.mkdir(AUTH_DIR, { recursive: true });
  for (const role of Object.keys(USERS) as RoleKey[]) {
    await signIn(role);
  }
}
