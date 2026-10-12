import nock from 'nock';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryMatch } from '@growth-desk/contract';
import { createTestProduct, truncateAll } from '../../test/helpers.js';
import { db } from '../db/client.js';
import { IDEAS as SEED_IDEAS } from '../db/seed/data.js';
import { contentMemory } from '../db/schema/index.js';
import {
  MEMORY_THRESHOLDS,
  checkDuplicate,
  embeddingText,
  fingerprint,
  foldNumberWords,
  meaningLevel,
  memoryKeys,
  mergeMatches,
  normalise,
  remember,
  textLevel,
  trigramSimilarity,
  withMemoryLock,
} from './content-memory.js';
import { VOYAGE_URL, cosineSimilarity, embedText, embedTexts, isEmbeddingsEnabled, setEmbeddingsConfigForTests } from './embeddings.js';

/** A 1024-number unit vector at `angle` radians in the first plane: cos(a - b) is their cosine. */
function vec(angle: number): number[] {
  const v = new Array<number>(1024).fill(0);
  v[0] = Math.cos(angle);
  v[1] = Math.sin(angle);
  return v;
}

describe('normalise (pure)', () => {
  it('folds case, punctuation, emoji, accents and stop words', () => {
    expect(normalise('60 Seconds With Elan!')).toBe('60 seconds elan');
    expect(normalise('Café Déjà vu')).toBe('cafe deja vu');
    expect(normalise('Mum \u{1F44B} calls ❤️ back')).toBe('mum calls back');
    expect(normalise("You're home, aren’t you?")).toBe('youre home arent you');
    expect(normalise('  The   end. ')).toBe('end');
    expect(normalise('...!!!')).toBe('');
  });

  it('turns number words into digits', () => {
    expect(normalise('Sixty seconds with Elan')).toBe('60 seconds elan');
    expect(normalise('Twenty-five days of calls')).toBe('25 days calls');
    expect(foldNumberWords(['one', 'two'])).toEqual(['1', '2']);
    expect(foldNumberWords(['two', 'hundred', 'calls'])).toEqual(['200', 'calls']);
    expect(foldNumberWords(['twenty', 'eleven'])).toEqual(['20', '11']);
    expect(foldNumberWords(['three', 'thousand', 'and', 'five'])).toEqual(['3000', 'and', '5']);
    expect(foldNumberWords(['hello'])).toEqual(['hello']);
  });
});

describe('fingerprint (pure)', () => {
  it('is the same for near-exact repeats and different for real changes', () => {
    const a = fingerprint('60 seconds with Elan');
    expect(fingerprint('60 Seconds With Elan!')).toBe(a);
    expect(fingerprint('Sixty seconds, with Elan')).toBe(a);
    expect(fingerprint('Elan: 60 seconds')).toBe(a);
    expect(fingerprint('61 seconds with Elan')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('includes the hook, and falls back to the raw text when nothing is left', () => {
    expect(fingerprint('Their clock', 'Call at their time')).not.toBe(fingerprint('Their clock'));
    expect(fingerprint('The')).not.toBe(fingerprint('A'));
  });
});

describe('similarity helpers (pure)', () => {
  it('scores trigrams like pg_trgm', () => {
    expect(trigramSimilarity('their clock not yours', 'their clock not yours')).toBe(1);
    expect(trigramSimilarity('their clock not yours', 'their clock not ours')).toBeCloseTo(0.7917, 3);
    expect(trigramSimilarity('', 'abc')).toBe(0);
  });

  it('maps scores to levels with the one threshold config', () => {
    expect(MEMORY_THRESHOLDS).toEqual({ textDuplicate: 0.55, textSimilar: 0.4, meaningDuplicate: 0.9, meaningSimilar: 0.83 });
    expect(textLevel(0.55)).toBe('duplicate');
    expect(textLevel(0.4)).toBe('similar');
    expect(textLevel(0.39)).toBeNull();
    expect(meaningLevel(0.9)).toBe('duplicate');
    expect(meaningLevel(0.83)).toBe('similar');
    expect(meaningLevel(0.8)).toBeNull();
    expect(cosineSimilarity(vec(0), vec(0))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(vec(0), vec(Math.PI / 2))).toBeCloseTo(0, 6);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('builds keys per kind', () => {
    expect(memoryKeys('idea', 'Their clock', 'why it fits').normalized).toBe('their clock');
    expect(memoryKeys('brief_hook', 'Their clock', 'Call at their time').normalized).toBe('their clock call their time');
    expect(memoryKeys('brief_hook', 'Their clock', '  ').fingerprint).toBe(memoryKeys('idea', 'Their clock').fingerprint);
    expect(memoryKeys('post_caption', 'Title', 'The caption!').normalized).toBe('caption');
    expect(embeddingText('idea', 'T', 'why')).toBe('T. why');
    expect(embeddingText('post_caption', 'T', 'caption')).toBe('caption');
  });

  it('merges hits: one per row, duplicate first', () => {
    const base: MemoryMatch = {
      id: '00000000-0000-4000-8000-000000000001',
      sourceType: 'idea',
      sourceId: null,
      productId: null,
      productName: null,
      title: 'A',
      body: null,
      score: 0.45,
      layer: 'text',
      level: 'similar',
      createdAt: new Date().toISOString(),
    };
    const other = { ...base, id: '00000000-0000-4000-8000-000000000002', score: 0.95, layer: 'meaning' as const, level: 'duplicate' as const };
    const merged = mergeMatches([base, { ...base, score: 1, layer: 'fingerprint', level: 'duplicate' }, other]);
    expect(merged.status).toBe('duplicate');
    expect(merged.matches).toHaveLength(2);
    expect(merged.matches[0]!.layer).toBe('fingerprint');
    expect(mergeMatches([base]).status).toBe('similar');
    expect(mergeMatches([]).status).toBe('unique');
  });

  it('keeps the seed ideas unique against each other', () => {
    for (const [i, a] of SEED_IDEAS.entries()) {
      for (const b of SEED_IDEAS.slice(i + 1)) {
        expect(fingerprint(a.title), `${a.title} vs ${b.title}`).not.toBe(fingerprint(b.title));
        expect(trigramSimilarity(normalise(a.title), normalise(b.title)), `${a.title} vs ${b.title}`).toBeLessThan(MEMORY_THRESHOLDS.textSimilar);
      }
    }
  });
});

describe('content memory in Postgres', () => {
  let productId: string;

  beforeEach(async () => {
    await truncateAll();
    productId = (await createTestProduct({ name: 'Humini Live' })).id;
  });

  afterEach(() => {
    setEmbeddingsConfigForTests(undefined);
    nock.cleanAll();
  });

  it('computes the same trigram score as pg_trgm', async () => {
    const pairs: [string, string][] = [
      ['grandma learns video call', 'grandpa tries video call'],
      ['first day new job', 'first week new job'],
      ['elan reads your group chat', 'rating family group'],
    ];
    for (const [a, b] of pairs) {
      const res = await db.execute<{ s: number }>(sql`select similarity(${a}, ${b})::float8 as s`);
      expect(trigramSimilarity(a, b)).toBeCloseTo(Number(res.rows[0]!.s), 5);
    }
  });

  it('finds fingerprint, text and similar matches across products', async () => {
    const other = await createTestProduct({ name: 'Humini Pulse' });
    const ideaId = '11111111-1111-4111-8111-111111111111';
    await remember({ sourceType: 'idea', sourceId: ideaId, productId: other.id, title: 'Their clock, not yours', mode: 'M3' }, db);
    await remember({ sourceType: 'idea', sourceId: '22222222-2222-4222-8222-222222222222', productId, title: 'Grandma learns to video call' }, db);

    const exact = await checkDuplicate({ title: 'Their Clock, NOT yours!', productId }, db);
    expect(exact.status).toBe('duplicate');
    expect(exact.matches[0]).toMatchObject({ layer: 'fingerprint', score: 1, sourceId: ideaId, productName: 'Humini Pulse', level: 'duplicate' });

    const reworded = await checkDuplicate({ title: 'Their clock not ours' }, db);
    expect(reworded.status).toBe('duplicate');
    expect(reworded.matches[0]).toMatchObject({ layer: 'text', level: 'duplicate' });

    const similar = await checkDuplicate({ title: 'Grandpa tries a video call' }, db);
    expect(similar.status).toBe('similar');
    expect(similar.matches[0]!.score).toBeGreaterThanOrEqual(0.4);
    expect(similar.matches[0]!.score).toBeLessThan(0.55);

    expect((await checkDuplicate({ title: 'Rating the office playlist' }, db)).status).toBe('unique');
    // The row being edited does not count, and captions are a separate kind.
    expect((await checkDuplicate({ title: 'Their clock, not yours', excludeSourceIds: [ideaId] }, db)).status).toBe('unique');
    expect((await checkDuplicate({ title: 'x', body: 'Their clock, not yours', kind: 'post_caption' }, db)).status).toBe('unique');
  });

  it('never matches dropped drafts, and lets them repeat a fingerprint', async () => {
    await remember({ sourceType: 'idea', sourceId: '11111111-1111-4111-8111-111111111111', productId, title: 'Their clock, not yours' }, db);
    expect(await remember({ sourceType: 'dropped_draft', sourceId: null, productId, title: 'Their clock, not yours' }, db)).toBe('stored');
    expect(await remember({ sourceType: 'dropped_draft', sourceId: null, productId, title: 'Their clock, not yours' }, db)).toBe('stored');
    const check = await checkDuplicate({ title: 'Their clock, not yours' }, db);
    expect(check.matches.every((m) => m.sourceType === 'idea')).toBe(true);
    expect(check.matches).toHaveLength(1);
  });

  it('updates the row of the same source, skips a taken fingerprint, and the unique index guards the rest', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(await remember({ sourceType: 'idea', sourceId: id, productId, title: 'First title' }, db)).toBe('stored');
    expect(await remember({ sourceType: 'idea', sourceId: id, productId, title: 'Second title', angle: 'a / b / c' }, db)).toBe('updated');
    const rows = await db.select().from(contentMemory);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Second title', angle: 'a / b / c', normalized: 'second title' });

    expect(await remember({ sourceType: 'idea', sourceId: '22222222-2222-4222-8222-222222222222', productId, title: 'Second Title!' }, db)).toBe('skipped');
    await expect(
      db.insert(contentMemory).values({ sourceType: 'brief_hook', productId, title: 'x', normalized: 'x', fingerprint: rows[0]!.fingerprint }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('serialises writers with the advisory lock', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = db.transaction((tx) =>
      withMemoryLock(tx, async () => {
        order.push('first in');
        await gate;
        order.push('first out');
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    const second = db.transaction((tx) =>
      withMemoryLock(tx, async () => {
        order.push('second in');
      }),
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(order).toEqual(['first in']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first in', 'first out', 'second in']);
  });

  it('finds the same idea in other words with embeddings (meaning layer)', async () => {
    await remember({ sourceType: 'idea', sourceId: '11111111-1111-4111-8111-111111111111', productId, title: 'Grandma joins the call', embedding: vec(0) }, db);
    const dup = await checkDuplicate({ title: 'Nani is on the line', embedding: vec(Math.acos(0.95)) }, db);
    expect(dup.status).toBe('duplicate');
    expect(dup.matches[0]).toMatchObject({ layer: 'meaning', level: 'duplicate' });
    expect(dup.matches[0]!.score).toBeCloseTo(0.95, 2);
    const near = await checkDuplicate({ title: 'Nani is on the line', embedding: vec(Math.acos(0.85)) }, db);
    expect(near.status).toBe('similar');
    expect((await checkDuplicate({ title: 'Nani is on the line', embedding: vec(Math.acos(0.5)) }, db)).status).toBe('unique');
  });
});

describe('Voyage embeddings client', () => {
  afterEach(() => {
    setEmbeddingsConfigForTests(undefined);
    nock.cleanAll();
  });

  const url = new URL(VOYAGE_URL);

  it('is off without a key and never calls out', async () => {
    setEmbeddingsConfigForTests(null);
    expect(isEmbeddingsEnabled()).toBe(false);
    expect(await embedTexts(['a', 'b'])).toEqual([null, null]);
  });

  it('sends the model and dimension, and returns vectors in input order', async () => {
    setEmbeddingsConfigForTests({ apiKey: 'test-key', model: 'voyage-4' });
    let sent: Record<string, unknown> | undefined;
    const scope = nock(url.origin)
      .post(url.pathname, (body: Record<string, unknown>) => {
        sent = body;
        return true;
      })
      .matchHeader('authorization', 'Bearer test-key')
      .reply(200, { object: 'list', data: [{ index: 1, embedding: vec(1) }, { index: 0, embedding: vec(0) }], model: 'voyage-4', usage: { total_tokens: 4 } });
    const [a, b] = await embedTexts(['first', 'second']);
    expect(scope.isDone()).toBe(true);
    expect(sent).toMatchObject({ input: ['first', 'second'], model: 'voyage-4', input_type: 'document', output_dimension: 1024 });
    expect(a![0]).toBeCloseTo(1, 6);
    expect(b![0]).toBeCloseTo(Math.cos(1), 6);
  });

  it('returns null (never throws) on an error or a bad answer', async () => {
    setEmbeddingsConfigForTests({ apiKey: 'test-key', model: 'voyage-4' });
    nock(url.origin).post(url.pathname).reply(500, 'boom');
    expect(await embedText('x')).toBeNull();
    nock(url.origin).post(url.pathname).reply(200, { data: [{ index: 0, embedding: [1, 2, 3] }] });
    expect(await embedText('x')).toBeNull();
  });
});
