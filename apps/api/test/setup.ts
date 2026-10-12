/**
 * Runs in every test file: closes the pool and the queue after the file.
 */
import { afterAll } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { stopQueue } from '../src/lib/queue.js';

afterAll(async () => {
  await stopQueue();
  await closeDb();
});
