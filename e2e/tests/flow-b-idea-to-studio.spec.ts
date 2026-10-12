/**
 * Prototype flow B "From idea to studio" (functional doc section 10):
 * Ideas -> open an idea as a brief -> the claim check flags a never-say word and blocks freeze
 * -> fix it -> Freeze brief -> Studio. The idea is made fresh through the API.
 */
import { Api } from '../support/api';
import { LIVE, runSentence, runTag, storageStateFor } from '../support/env';
import { chooseProduct, expect, expectHeading, test, toast } from '../support/fixtures';

test.use({ storageState: storageStateFor('jeeva') });

const ideaTitle = `E2E founder film ${runTag()}`;
let liveId: string;

test.beforeAll(async () => {
  const api = await Api.as('jeeva');
  const live = await api.productByName(LIVE);
  liveId = live.id;
  await api.createIdea(live.id, ideaTitle, 'M1');
  await api.dispose();
});

test('flow B: idea -> brief -> claim check blocks a never-say word -> freeze -> studio', async ({ page }) => {
  await chooseProduct(page, liveId);

  // 1. Ideas -> open the idea as a brief
  await page.goto('/ideas');
  await expectHeading(page, 'Ideas');
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: ideaTitle }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: `Actions for ${ideaTitle}` }).click();
  await page.getByRole('menuitem', { name: 'Open as brief' }).click();
  await expect(toast(page, /Brief [A-Z]+-\d+ created/)).toBeVisible();
  await expect(page).toHaveURL(/\/briefs\/[0-9a-f-]{36}$/);
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toContainText(ideaTitle);
  const code = ((await h1.textContent()) ?? '').split(' · ')[0]!.trim();
  expect(code).toMatch(/^[A-Z]+-\d+$/);

  // 2. Write a hook with a never-say word ("strangers" is on the Humini Live kit)
  const freeze = page.getByRole('button', { name: 'Freeze brief' });
  // Hooks must be unique across runs (content memory), so each run writes a new sentence.
  const uniqueHook = runSentence();
  await page.getByLabel('Hook (0-2 s)').fill(`Meet strangers who feel like family. ${uniqueHook}`);
  if ((await page.getByLabel('Beat 1', { exact: true }).count()) === 0) {
    await page.getByRole('button', { name: 'Add beat' }).click();
  }
  await page.getByLabel('Beat 1', { exact: true }).fill('A heart: the owner sees how many, never who.');
  await page.getByLabel('Ask', { exact: true }).fill('Start a circle today.');

  const claimCheck = page.getByRole('region', { name: 'Claim check' });
  await expect(claimCheck).toContainText('"strangers" is on the never-say list.');
  await expect(claimCheck.getByRole('img', { name: 'Blocks freeze' }).first()).toBeVisible();
  await expect(freeze).toBeDisabled();
  await expect(page.getByText('Fix the red flags in the claim check first.')).toBeVisible();

  // 3. Fix it, wait for the save, then freeze
  await page.getByLabel('Hook (0-2 s)').fill(uniqueHook);
  await expect(claimCheck).not.toContainText('is on the never-say list');
  await expect(page.getByRole('status').filter({ hasText: /^(All changes saved|Saved)$/ })).toBeVisible();
  await expect(freeze).toBeEnabled();
  await freeze.click();
  const confirm = page.getByRole('alertdialog', { name: `Freeze ${code}?` });
  await confirm.getByRole('button', { name: 'Freeze brief' }).click();
  await expect(toast(page, `${code} is frozen`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unfreeze' })).toBeVisible();

  // 4. Studio: the frozen brief is ready to make
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Studio' }).click();
  await expectHeading(page, 'Studio');
  await page
    .getByRole('table', { name: 'Briefs ready to make' })
    .getByRole('row', { name: new RegExp(code) })
    .click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  await expectHeading(page, `Studio · ${code}`);
  await expect(page.getByRole('button', { name: 'Send for review' })).toBeDisabled();
});

test('the server refuses to freeze a brief with a never-say word', async () => {
  const api = await Api.as('jeeva');
  try {
    const brief = await api.createBrief({ productId: liveId, title: `E2E blocked ${runTag()}` });
    await api.updateBrief(brief.id, { hook: `${runSentence()} Talk to strangers.`, beats: ['One beat.'] });
    await api.claimCheck(brief.id);
    const fresh = await api.brief(brief.id);
    const res = await api.ctx.post(`/api/v1/briefs/${brief.id}/freeze`, { data: { version: fresh.version } });
    expect(res.status()).toBe(422);
    expect((await res.json()).code).toBe('CLAIM_CHECK_FAILED');
  } finally {
    await api.dispose();
  }
});
