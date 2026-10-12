/**
 * API tests run against a real Postgres test database (DATABASE_URL_TEST,
 * default growth_desk_test on the compose Postgres). Start it first: `npm run docker:infra`.
 * Files run one at a time because they share the database.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  ssr: { resolve: { conditions: ['development'] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test' },
  },
});
