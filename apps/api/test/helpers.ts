/**
 * Test helpers shared by every module's tests.
 *
 *   beforeEach(truncateAll);
 *   const user = await createTestUser({ role: 'editor' });
 *   const agent = await loginAgent(app, user);       // supertest agent with cookie + Origin
 *   await agent.post('/api/v1/...').send({...}).expect(201);
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import type { ProductRole, Role } from '@growth-desk/contract';
import { env } from '../src/config/env.js';
import { db } from '../src/db/client.js';
import { productMembers, products, users } from '../src/db/schema/index.js';
import { hashPassword } from '../src/lib/crypto.js';

export const TEST_ORIGIN = env.webOrigins[0] ?? 'http://localhost:5173';
export const TEST_PASSWORD = 'correct horse battery staple';

let cachedHash: string | undefined;

/** Empties every table in the public schema (fast, keeps the schema). */
export async function truncateAll(): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.rows.map((r) => `"public"."${r.tablename}"`);
  if (names.length > 0)
    await db.execute(sql.raw(`truncate table ${names.join(', ')} restart identity cascade`));
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
}

export async function createTestUser(
  opts: {
    role?: Role;
    email?: string;
    name?: string;
    isBrandApprover?: boolean;
    isActive?: boolean;
    password?: string;
  } = {},
): Promise<TestUser> {
  const password = opts.password ?? TEST_PASSWORD;
  const passwordHash =
    password === TEST_PASSWORD
      ? (cachedHash ??= await hashPassword(TEST_PASSWORD))
      : await hashPassword(password);
  const email = (opts.email ?? `user-${randomUUID().slice(0, 8)}@example.com`).toLowerCase();
  const name = opts.name ?? 'Test User';
  const [row] = await db
    .insert(users)
    .values({
      email,
      name,
      initials:
        name
          .split(/\s+/)
          .map((p) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase() || 'TU',
      title: 'Tester',
      role: opts.role ?? 'member',
      isBrandApprover: opts.isBrandApprover ?? false,
      isActive: opts.isActive ?? true,
      passwordHash,
    })
    .returning({ id: users.id });
  return { id: row!.id, email, password, role: opts.role ?? 'member' };
}

export async function createTestProduct(
  opts: { slug?: string; name?: string } = {},
): Promise<{ id: string }> {
  const slug = opts.slug ?? `p-${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(products)
    .values({ slug, name: opts.name ?? 'Test Product', shortName: 'Test' })
    .returning({ id: products.id });
  return { id: row!.id };
}

export async function addMember(
  productId: string,
  userId: string,
  productRole: ProductRole,
): Promise<void> {
  await db.insert(productMembers).values({ productId, userId, productRole });
}

/** Supertest agent signed in as `user`. Every request also sends the allowed Origin. */
export async function loginAgent(app: Express, user: TestUser) {
  const agent = request.agent(app).set('Origin', TEST_ORIGIN);
  await agent
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
  return agent;
}
