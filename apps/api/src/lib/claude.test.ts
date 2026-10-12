import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestProduct, truncateAll } from '../../test/helpers.js';
import { db } from '../db/client.js';
import { env } from '../config/env.js';
import { claudeUsage, productSettings } from '../db/schema/index.js';
import {
  type ClaudeClient,
  assertUnderCap,
  effectiveCap,
  generateJson,
  getMonthlyUsage,
  recordUsage,
  setClaudeClientForTests,
} from './claude.js';
import { monthKey } from './time.js';

function fakeClient(reply: { parsed: unknown; stop?: string }): ClaudeClient {
  return {
    beta: {
      messages: {
        parse: async () => ({
          model: 'claude-opus-5-5',
          stop_reason: reply.stop ?? 'end_turn',
          parsed_output: reply.parsed,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 0,
          },
          content: [],
        }),
      },
    },
  } as unknown as ClaudeClient;
}

const schema = z.object({ ideas: z.array(z.object({ title: z.string() })) });
const base = { feature: 'test', system: 'You draft ideas.', prompt: 'Give one idea.' };

describe('claude wrapper', () => {
  beforeEach(truncateAll);
  afterEach(() => setClaudeClientForTests(null));

  it('is off without a key (FEATURE_DISABLED)', async () => {
    await expect(generateJson({ ...base, productId: null, schema })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
      status: 503,
    });
  });

  it('returns parsed data and records usage per product and month', async () => {
    const product = await createTestProduct();
    setClaudeClientForTests(
      fakeClient({ parsed: { ideas: [{ title: 'Their clock, not yours' }] } }),
    );
    const { data, usage } = await generateJson({ ...base, productId: product.id, schema });
    expect(data.ideas[0]!.title).toBe('Their clock, not yours');
    expect(usage).toEqual({ inputTokens: 110, outputTokens: 50, model: 'claude-opus-5-5' });
    await generateJson({ ...base, productId: product.id, schema });
    const u = await getMonthlyUsage(product.id);
    expect(u).toMatchObject({ inputTokens: 220, outputTokens: 100, requestCount: 2 });
  });

  it('keeps global (no product) usage in its own row', async () => {
    await recordUsage(null, 5, 5);
    await recordUsage(null, 5, 5);
    const rows = await db.select().from(claudeUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId: null,
      inputTokens: 10,
      month: monthKey(new Date()),
    });
  });

  it('stops at the monthly cap', async () => {
    const product = await createTestProduct();
    setClaudeClientForTests(fakeClient({ parsed: { ideas: [] } }));
    await recordUsage(product.id, 1_999_999, 1);
    await expect(generateJson({ ...base, productId: product.id, schema })).rejects.toMatchObject({
      code: 'CLAUDE_CAP_REACHED',
      status: 429,
    });
  });

  describe('per-product cap from product settings', () => {
    const setCap = (productId: string, cap: number | null) =>
      db
        .insert(productSettings)
        .values({ productId, claudeMonthlyTokenCap: cap })
        .onConflictDoUpdate({
          target: productSettings.productId,
          set: { claudeMonthlyTokenCap: cap },
        });

    it('uses the env cap with no settings row, with a null cap, and for no product', async () => {
      const product = await createTestProduct();
      expect(await effectiveCap(product.id)).toBe(env.claudeMonthlyTokenCap);
      await setCap(product.id, null);
      expect(await effectiveCap(product.id)).toBe(env.claudeMonthlyTokenCap);
      expect(await effectiveCap(null)).toBe(env.claudeMonthlyTokenCap);
    });

    it('blocks at a product cap lower than the env cap', async () => {
      const product = await createTestProduct();
      await setCap(product.id, 1_000);
      setClaudeClientForTests(fakeClient({ parsed: { ideas: [] } }));
      await recordUsage(product.id, 600, 400);
      await expect(generateJson({ ...base, productId: product.id, schema })).rejects.toMatchObject(
        { code: 'CLAUDE_CAP_REACHED', status: 429 },
      );
      expect(await getMonthlyUsage(product.id)).toMatchObject({ capTokens: 1_000 });
    });

    it('allows use past the env cap when the product cap is higher', async () => {
      const product = await createTestProduct();
      await setCap(product.id, env.claudeMonthlyTokenCap + 1_000_000);
      await recordUsage(product.id, env.claudeMonthlyTokenCap, 0);
      await expect(assertUnderCap(product.id)).resolves.toBeUndefined();
    });

    it('treats a product cap of 0 as no cap', async () => {
      const product = await createTestProduct();
      await setCap(product.id, 0);
      await recordUsage(product.id, env.claudeMonthlyTokenCap * 2, 0);
      await expect(assertUnderCap(product.id)).resolves.toBeUndefined();
    });

    it('applies a cap change at once and stamps it on the usage row', async () => {
      const product = await createTestProduct();
      await recordUsage(product.id, 10, 10);
      await setCap(product.id, 15);
      await expect(assertUnderCap(product.id)).rejects.toMatchObject({
        code: 'CLAUDE_CAP_REACHED',
      });
      await recordUsage(product.id, 1, 1);
      const [row] = await db.select().from(claudeUsage);
      expect(row).toMatchObject({ capTokens: 15, inputTokens: 11, outputTokens: 11 });
    });

    it('does not let one product cap leak into another product', async () => {
      const a = await createTestProduct();
      const b = await createTestProduct();
      await setCap(a.id, 10);
      await recordUsage(b.id, 50, 0);
      await expect(assertUnderCap(b.id)).resolves.toBeUndefined();
    });
  });

  it('maps a refusal and an unusable answer to clear errors', async () => {
    setClaudeClientForTests(fakeClient({ parsed: null, stop: 'refusal' }));
    await expect(generateJson({ ...base, productId: null, schema })).rejects.toMatchObject({
      code: 'CLAUDE_REFUSED',
    });
    setClaudeClientForTests(fakeClient({ parsed: null }));
    await expect(generateJson({ ...base, productId: null, schema })).rejects.toMatchObject({
      code: 'CLAUDE_FAILED',
    });
  });
});
