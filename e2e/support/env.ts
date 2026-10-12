/**
 * Settings for the end-to-end run. Every value has a local default, so the suite runs against
 * the Docker stack (`npm run docker:up`) with no extra setup.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The web app. Docker nginx serves the SPA and proxies `/api` to the API. */
export const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');

/** Mutations must send an allowed Origin (CSRF guard). The web origin is always allowed. */
export const ORIGIN = new URL(BASE_URL).origin;

export const API_PREFIX = '/api/v1';

export const PASSWORD = process.env.SEED_USER_PASSWORD || 'growthdesk-dev';

/** Seed users the suite signs in as. */
export const USERS = {
  /** Editor, maker on every product. */
  jeeva: { email: 'jeeva@example.com', name: 'Jeeva Santiago' },
  /** Admin and brand approver. */
  elan: { email: 'elan@example.com', name: 'Elan' },
  /** Product owner of Humini Live: approves the claims gate. */
  liveowner: { email: 'liveowner@example.com', name: 'Meera Iyer' },
} as const;

export type RoleKey = keyof typeof USERS;

export const AUTH_DIR = path.resolve(here, '..', '.auth');

export function storageStateFor(role: RoleKey): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/** Seed product names. */
export const LIVE = 'Humini Live';
export const PULSE = 'Humini Pulse';

/** Short unique tag so data made by one run never clashes with another run. */
/**
 * Words for test data. The app blocks ideas, hooks and captions that look like earlier ones
 * (content memory, ADR 0009), so every run must write truly different text, not only a new code.
 */
const WORDS = [
  'amber', 'harbour', 'lantern', 'meadow', 'pebble', 'quartz', 'saffron', 'tundra', 'violet', 'walnut',
  'breeze', 'canyon', 'dune', 'ember', 'fjord', 'glacier', 'hazel', 'island', 'jasmine', 'kettle',
  'lagoon', 'monsoon', 'nutmeg', 'orchid', 'prairie', 'quill', 'river', 'sparrow', 'thistle', 'umber',
  'valley', 'willow', 'yarrow', 'zephyr', 'basil', 'cobalt', 'drizzle', 'falcon', 'granite', 'heron',
  'indigo', 'juniper', 'kestrel', 'lotus', 'maple', 'nectar', 'olive', 'plume', 'raven', 'sienna',
  'tamarind', 'velvet', 'wren', 'acorn', 'bramble', 'cedar', 'dahlia', 'fennel', 'ginger', 'hollow',
];

function pick(n: number): string[] {
  const out = new Set<string>();
  while (out.size < n) out.add(WORDS[Math.floor(Math.random() * WORDS.length)]!);
  return [...out];
}

/** A unique tag made of random words plus a short code, for example "Cedar Quill Ember 7K2". */
export function runTag(): string {
  const words = pick(4).map((w) => w[0]!.toUpperCase() + w.slice(1));
  const code = `${Date.now().toString(36).slice(-3)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
  return `${words.join(' ')} ${code}`;
}

/** A unique sentence for hooks and captions. */
export function runSentence(): string {
  const [a, b, c, d, e] = pick(5);
  return `The ${a} and the ${b} meet by the ${c}, while ${d} waits for ${e}.`;
}
