import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { startQueue } from '../../lib/queue.js';

const app = createApp();

describe('health', () => {
  it('live answers without dependencies', async () => {
    await request(app).get('/api/v1/health/live').expect(200, { status: 'ok' });
  });

  describe('with the queue running', () => {
    beforeAll(async () => {
      await startQueue({ worker: false });
    });

    it('reports database, storage and queue', async () => {
      const res = await request(app).get('/api/v1/health');
      const body = healthResponseSchema.parse(res.body);
      expect(body.checks.database.status).toBe('up');
      expect(body.checks.queue.status).toBe('up');
      // Storage is up when MinIO runs (npm run docker:infra), else the API is degraded, not down.
      expect(['up', 'down']).toContain(body.checks.storage.status);
      expect(res.status).toBe(200);
      expect(body.status).toBe(body.checks.storage.status === 'up' ? 'ok' : 'degraded');
      expect(body.features.claude).toBe(false);
    });
  });
});
