/**
 * Screenshot one screen at the Figma frame size (1440 x 960) for visual comparison.
 *   node e2e/scripts/shot.mjs <path> <out.png> [role=jeeva] [base=http://localhost:5173]
 * Uses the saved login state from e2e/.auth/<role>.json (made by the E2E global setup).
 * Motion is reduced so the picture is taken after content settles.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [, , route = '/', out = 'shot.png', role = 'jeeva', base = 'http://localhost:5173'] = process.argv;
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  storageState: path.join(here, '..', '.auth', `${role}.json`),
  reducedMotion: 'reduce',
});
const page = await context.newPage();
await page.goto(new URL(route, base).toString(), { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(`saved ${out}`);
