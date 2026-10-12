import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../app.js';
import { validate } from '../middleware/validate.js';
import { AppError, errorHandler, notFoundHandler } from './errors.js';

function miniApp() {
  const app = express();
  app.use(express.json());
  app.get('/app-error', () => {
    throw new AppError({
      status: 422,
      code: 'CLAIM_CHECK_FAILED',
      title: 'Claim check failed',
      detail: 'Fix the red flag first.',
    });
  });
  app.get('/zod', () => {
    z.object({ a: z.string() }).parse({ a: 1 });
  });
  app.get('/boom', async () => {
    throw new Error('secret internal detail');
  });
  app.get('/pg-unique', () => {
    throw Object.assign(new Error('duplicate key'), { code: '23505' });
  });
  app.post('/validated', validate({ body: z.object({ title: z.string().min(1) }) }), (req, res) => {
    res.json(req.body);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('error handler (RFC 7807)', () => {
  const app = miniApp();

  it('turns AppError into problem+json', async () => {
    const res = await request(app).get('/app-error').expect(422);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: expect.stringContaining('claim-check-failed'),
      title: 'Claim check failed',
      status: 422,
      code: 'CLAIM_CHECK_FAILED',
      detail: 'Fix the red flag first.',
      instance: '/app-error',
    });
  });

  it('maps zod errors to field errors', async () => {
    const res = await request(app).get('/zod').expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([{ path: 'a', message: expect.any(String) }]);
  });

  it('hides internal errors', async () => {
    const res = await request(app).get('/boom').expect(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });

  it('maps a Postgres unique violation to 409', async () => {
    const res = await request(app).get('/pg-unique').expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('validates bodies with the part name in the path', async () => {
    const res = await request(app).post('/validated').send({ title: '' }).expect(400);
    expect(res.body.errors[0].path).toBe('body.title');
    await request(app)
      .post('/validated')
      .send({ title: 'ok', extra: 1 })
      .expect(200, { title: 'ok' });
  });

  it('answers bad JSON with 400', async () => {
    const res = await request(app)
      .post('/validated')
      .set('content-type', 'application/json')
      .send('{bad')
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('answers unknown routes with 404 problem', async () => {
    const res = await request(app).get('/nope').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('the real app returns 404 problem for unknown API routes', async () => {
    const res = await request(createApp()).get('/api/v1/does-not-exist').expect(404);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
