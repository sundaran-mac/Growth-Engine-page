import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';
import { createOriginCheck } from './origin-check.js';

function appWith() {
  const app = express();
  app.use('/api/v1', createOriginCheck(['http://localhost:8080'], ['/api/v1/webhooks/']));
  app.all('/api/v1/*rest', (_req, res) => res.status(204).end());
  app.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).end();
  });
  return app;
}

describe('originCheck', () => {
  it('lets safe methods through without an origin', async () => {
    await request(appWith()).get('/api/v1/briefs').expect(204);
  });
  it('allows a mutation from an allowed origin', async () => {
    await request(appWith()).post('/api/v1/briefs').set('Origin', 'http://localhost:8080').expect(204);
  });
  it('refuses a mutation from another origin or with no origin', async () => {
    await request(appWith()).post('/api/v1/briefs').set('Origin', 'https://evil.example').expect(403);
    await request(appWith()).post('/api/v1/briefs').expect(403);
  });
  it('exempts webhooks when mounted under the API prefix', async () => {
    await request(appWith()).post('/api/v1/webhooks/meta?x=1').expect(204);
  });
  it('does not exempt look-alike paths', async () => {
    await request(appWith()).post('/api/v1/webhooksx/meta').expect(403);
  });
});
