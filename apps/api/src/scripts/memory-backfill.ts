/* eslint-disable no-console -- a command line script: it prints its result to the terminal. */
/**
 * Loads every existing idea, brief hook and published caption into the content memory and adds
 * missing embeddings. Idempotent; safe to run again at any time:
 *   npm run memory:backfill -w @growth-desk/api
 */
import { closeDb } from '../db/client.js';
import { backfillMemory } from '../modules/memory/backfill.js';

try {
  const result = await backfillMemory();
  console.log(
    `Content memory backfill done: ${result.ideas} ideas, ${result.hooks} brief hooks, ${result.captions} captions added; ` +
      `${result.skipped} skipped as repeats; ${result.embedded} embeddings added.`,
  );
} catch (err) {
  console.error('Content memory backfill failed:', err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
