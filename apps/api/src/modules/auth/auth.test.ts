import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { meResponseSchema, SESSION_COOKIE_NAME } from '@growth-desk/contract';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { auditLogs, sessions } from '../../db/schema/index.js';
import { errorHandler } from '../../lib/errors.js';
import {
  fromParams,
  requireAuth,
  requireBrandApprover,
  requireProductRole,
  requireRole,
} from '../../middleware/auth.js';
import {
  TEST_ORIGIN,
  addMember,
  createTestProduct,
  createTestUser,
  loginAgent,
  truncateAll,
} from '../../../test/helpers.js';

const app = createApp();

describe('auth', () => {
  beforeEach(truncateAll);

  it('signs in, sets a safe cookie and returns me', async () => {
    const user = await createTestUser({
      role: 'editor',
      name: 'Jeeva Santiago',
      email: 'Jeeva@Example.com',
    });
    const product = await createTestProduct();
    await addMember(product.id, user.id, 'maker');

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: '  JEEVA@example.com ', password: user.password })
      .expect(200);

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const body = meResponseSchema.parse(res.body);
    expect(body.user).toMatchObject({
      email: 'jeeva@example.com',
      initials: 'JS',
      role: 'editor',
      isBrandApprover: false,
    });
    expect(body.memberships).toEqual([{ productId: product.id, productRole: 'maker' }]);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const [stored] = await db.select().from(sessions);
    expect(stored?.tokenHash).toHaveLength(64);
    expect(cookie).not.toContain(stored!.tokenHash);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'auth.login'));
    expect(audit).toHaveLength(1);
  });

  it('GET /auth/me works with the cookie and fails without it', async () => {
    const user = await createTestUser();
    const agent = await loginAgent(app, user);
    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(meResponseSchema.parse(me.body).user.id).toBe(user.id);

    const res = await request(app).get('/api/v1/auth/me').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=forged`)
      .expect(401);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const user = await createTestUser();
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: user.email, password: 'nope' })
      .expect(401);
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'ghost@example.com', password: 'nope' })
      .expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body).toMatchObject({ code: wrong.body.code, detail: wrong.body.detail });
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('refuses an inactive user', async () => {
    const user = await createTestUser({ isActive: false });
    await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: user.email, password: user.password })
      .expect(401);
  });

  it('validates the login body', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      'body.email',
      'body.password',
    ]);
  });

  it('blocks mutations from another origin or with no origin', async () => {
    const user = await createTestUser();
    const evil = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: user.email, password: user.password })
      .expect(403);
    expect(evil.body.code).toBe('ORIGIN_NOT_ALLOWED');
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(403);
    await request(app)
      .post('/api/v1/auth/login')
      .set('Referer', `${TEST_ORIGIN}/login`)
      .send({ email: user.email, password: user.password })
      .expect(200);
  });

  it('logs out: deletes the session and clears the cookie', async () => {
    const user = await createTestUser();
    const agent = await loginAgent(app, user);
    const res = await agent.post('/api/v1/auth/logout').expect(204);
    expect(String(res.headers['set-cookie'])).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=;`));
    expect(await db.select().from(sessions)).toHaveLength(0);
    await agent.get('/api/v1/auth/me').expect(401);
    await request(app).post('/api/v1/auth/logout').set('Origin', TEST_ORIGIN).expect(204);
  });

  it('replaces the old session on a new sign-in', async () => {
    const user = await createTestUser();
    const agent = await loginAgent(app, user);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('rejects an expired session', async () => {
    const user = await createTestUser();
    const agent = await loginAgent(app, user);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('slides the expiry forward when the session is used', async () => {
    const user = await createTestUser();
    const agent = await loginAgent(app, user);
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await db.update(sessions).set({ lastSeenAt: old, expiresAt: new Date(Date.now() + 60_000) });
    const res = await agent.get('/api/v1/auth/me').expect(200);
    expect(String(res.headers['set-cookie'])).toContain(SESSION_COOKIE_NAME);
    const [s] = await db.select().from(sessions);
    expect(s!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);
  });
});

describe('access guards', () => {
  beforeEach(truncateAll);

  function guardedApp() {
    const a = express();
    a.use((req, _res, next) => {
      req.cookies = Object.fromEntries(
        (req.headers.cookie ?? '')
          .split(';')
          .filter(Boolean)
          .map((c) => c.trim().split('=') as [string, string]),
      );
      next();
    });
    a.get('/editors', requireAuth, requireRole('editor'), (_req, res) => res.json({ ok: true }));
    a.get('/brand', requireAuth, requireBrandApprover, (_req, res) => res.json({ ok: true }));
    a.get(
      '/products/:productId/owner',
      requireAuth,
      requireProductRole(fromParams('productId'), 'owner'),
      (_req, res) => res.json({ ok: true }),
    );
    a.use(errorHandler);
    return a;
  }

  async function cookieFor(
    role: 'admin' | 'editor' | 'member',
    extra: { isBrandApprover?: boolean } = {},
  ) {
    const user = await createTestUser({ role, ...extra });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: user.email, password: user.password });
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    return { user, cookie };
  }

  it('checks global roles, admin passes', async () => {
    const g = guardedApp();
    const editor = await cookieFor('editor');
    const member = await cookieFor('member');
    const admin = await cookieFor('admin');
    await request(g).get('/editors').set('Cookie', editor.cookie).expect(200);
    await request(g).get('/editors').set('Cookie', admin.cookie).expect(200);
    const res = await request(g).get('/editors').set('Cookie', member.cookie).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    await request(g).get('/editors').expect(401);
  });

  it('checks the brand approver flag', async () => {
    const g = guardedApp();
    const elan = await cookieFor('member', { isBrandApprover: true });
    const other = await cookieFor('editor');
    await request(g).get('/brand').set('Cookie', elan.cookie).expect(200);
    const res = await request(g).get('/brand').set('Cookie', other.cookie).expect(403);
    expect(res.body.code).toBe('GATE_NOT_ALLOWED');
  });

  it('checks product roles', async () => {
    const g = guardedApp();
    const product = await createTestProduct();
    const owner = await cookieFor('member');
    const maker = await cookieFor('member');
    await addMember(product.id, owner.user.id, 'owner');
    await addMember(product.id, maker.user.id, 'maker');
    await request(g).get(`/products/${product.id}/owner`).set('Cookie', owner.cookie).expect(200);
    await request(g).get(`/products/${product.id}/owner`).set('Cookie', maker.cookie).expect(403);
  });
});
