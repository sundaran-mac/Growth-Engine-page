import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { briefSchema, claimCheckResultSchema } from '@growth-desk/contract';
import { createApp } from '../../app.js';
import type * as ClaudeLib from '../../lib/claude.js';
import type * as SettingsShared from '../settings/shared.js';
import { db } from '../../db/client.js';
import {
  auditLogs,
  briefs,
  ideas,
  notifications,
  planItems,
  plans,
} from '../../db/schema/index.js';
import { AppError, featureDisabled } from '../../lib/errors.js';
import { TEST_ORIGIN, loginAgent, truncateAll } from '../../../test/helpers.js';
import { makeWorld, seedAsset, seedBrief, type MakeWorld } from './fixtures.test.js';
import { createBriefFromIdea } from './shared.js';

const claude = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock('../../lib/claude.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ClaudeLib>()),
  generateJson: claude.generateJson,
}));
const settings = vi.hoisted(() => ({ buildProductContext: vi.fn() }));
vi.mock('../settings/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SettingsShared>()),
  buildProductContext: settings.buildProductContext,
}));

const app = createApp();
const API = '/api/v1';

let w: MakeWorld;

beforeEach(async () => {
  await truncateAll();
  vi.clearAllMocks();
  w = await makeWorld();
});

const audits = (action: string) =>
  db.select().from(auditLogs).where(eq(auditLogs.action, action));

describe('GET /briefs', () => {
  it('needs a session', async () => {
    await request(app).get(`${API}/briefs?productId=${w.productId}`).expect(401);
  });

  it('lists briefs of the product, filtered by stage and text', async () => {
    const a = await seedBrief(w, { stage: 'frozen' });
    await seedBrief(w, { stage: 'brief' });
    await db.update(briefs).set({ title: 'Festival poster' }).where(eq(briefs.id, a.id));
    const agent = await loginAgent(app, w.maker);

    const all = await agent.get(`${API}/briefs`).query({ productId: w.productId }).expect(200);
    expect(all.body.total).toBe(2);
    expect(() => briefSchema.parse(all.body.items[0])).not.toThrow();

    const frozen = await agent
      .get(`${API}/briefs`)
      .query({ productId: w.productId, stage: 'frozen,made' })
      .expect(200);
    expect(frozen.body.items.map((b: { id: string }) => b.id)).toEqual([a.id]);

    const byText = await agent.get(`${API}/briefs`).query({ productId: w.productId, q: 'festival' });
    expect(byText.body.total).toBe(1);
    const byCode = await agent.get(`${API}/briefs`).query({ productId: w.productId, q: a.code });
    expect(byCode.body.total).toBe(1);
  });

  it('rejects a bad query and an outsider', async () => {
    const agent = await loginAgent(app, w.maker);
    const bad = await agent.get(`${API}/briefs`).query({ productId: 'nope' }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    await agent.get(`${API}/briefs`).query({ productId: w.productId, stage: 'wat' }).expect(400);
    const outsider = await loginAgent(app, w.outsider);
    const res = await outsider.get(`${API}/briefs`).query({ productId: w.productId }).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('lets a global editor read any product', async () => {
    await seedBrief(w);
    const agent = await loginAgent(app, w.editor);
    const res = await agent.get(`${API}/briefs`).query({ productId: w.productId }).expect(200);
    expect(res.body.total).toBe(1);
  });
});

describe('POST /briefs', () => {
  it('creates a brief with a code, default approvers and a first claim check', async () => {
    const agent = await loginAgent(app, w.maker);
    const res = await agent
      .post(`${API}/briefs`)
      .send({ productId: w.productId, title: 'Their clock', mode: 'M3' })
      .expect(201);
    const brief = briefSchema.parse(res.body);
    expect(brief).toMatchObject({
      code: 'REEL-001',
      stage: 'brief',
      version: 1,
      ratios: ['9:16', '4:5'],
      captionLanguages: ['en'],
      owner: { id: w.maker.id },
      claimsApprover: { id: w.owner.id },
      brandApprover: { id: w.brand.id },
    });
    expect(brief.claimFlags.length).toBeGreaterThan(0);
    expect(await audits('brief.create')).toHaveLength(1);
  });

  it('validates the body and checks the role', async () => {
    const maker = await loginAgent(app, w.maker);
    const bad = await maker.post(`${API}/briefs`).send({ productId: w.productId, title: '' }).expect(400);
    expect(bad.body.errors.length).toBeGreaterThan(0);
    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.post(`${API}/briefs`).send({ productId: w.productId, title: 'x', mode: 'M1' }).expect(403);
    const viewer = await loginAgent(app, w.viewerMember);
    await viewer.post(`${API}/briefs`).send({ productId: w.productId, title: 'x', mode: 'M1' }).expect(403);
  });

  it('refuses a request from another origin', async () => {
    const agent = await loginAgent(app, w.maker);
    await agent
      .post(`${API}/briefs`)
      .set('Origin', 'https://evil.example')
      .send({ productId: w.productId, title: 'x', mode: 'M1' })
      .expect(403);
    expect(TEST_ORIGIN).toBeTruthy();
  });
});

describe('GET /briefs/:id and options', () => {
  it('returns the brief, 404 for unknown, 400 for a bad id, 403 for an outsider', async () => {
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.reviewer);
    const res = await agent.get(`${API}/briefs/${b.id}`).expect(200);
    expect(res.body.code).toBe(b.code);
    await agent.get(`${API}/briefs/${crypto.randomUUID()}`).expect(404);
    await agent.get(`${API}/briefs/not-a-uuid`).expect(400);
    const outsider = await loginAgent(app, w.outsider);
    await outsider.get(`${API}/briefs/${b.id}`).expect(403);
  });

  it('lists the people the editor can pick', async () => {
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.get(`${API}/briefs/${b.id}/options`).expect(200);
    expect(res.body.claimsApprovers.map((u: { id: string }) => u.id)).toEqual([w.owner.id]);
    expect(res.body.brandApprovers.map((u: { id: string }) => u.id)).toEqual([w.brand.id]);
    expect(res.body.owners).toHaveLength(4);
  });
});

describe('PATCH /briefs/:id (autosave)', () => {
  it('saves fields, re-runs the claim check and writes the audit log', async () => {
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.maker);
    const res = await agent
      .patch(`${API}/briefs/${b.id}`)
      .send({
        version: b.version,
        updatedAt: b.updatedAt.toISOString(),
        hook: '  Stay anonymous with friends  ',
        beats: ['One', ' Two '],
        ratios: ['9:16', '9:16'],
      })
      .expect(200);
    expect(res.body.hook).toBe('Stay anonymous with friends');
    expect(res.body.beats).toEqual(['One', 'Two']);
    expect(res.body.ratios).toEqual(['9:16']);
    expect(res.body.claimFlags.some((f: { status: string }) => f.status === 'fail')).toBe(true);
    expect(res.body.updatedAt).not.toBe(b.updatedAt.toISOString());
    const [audit] = await audits('brief.update');
    expect(audit?.before).toMatchObject({ hook: 'You are not a bad friend.' });

    // The next save with the returned token works; the old token now conflicts.
    await agent
      .patch(`${API}/briefs/${b.id}`)
      .send({ version: 1, updatedAt: res.body.updatedAt, ask: 'Send a byte.' })
      .expect(200);
    const stale = await agent
      .patch(`${API}/briefs/${b.id}`)
      .send({ version: 1, updatedAt: res.body.updatedAt, ask: 'Again' })
      .expect(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('conflicts when the version moved on (sent back from review)', async () => {
    const b = await seedBrief(w);
    await db.update(briefs).set({ version: 2 }).where(eq(briefs.id, b.id));
    const [fresh] = await db.select().from(briefs).where(eq(briefs.id, b.id));
    const agent = await loginAgent(app, w.maker);
    const res = await agent
      .patch(`${API}/briefs/${b.id}`)
      .send({ version: 1, updatedAt: fresh!.updatedAt.toISOString(), hook: 'x' })
      .expect(409);
    expect(res.body.code).toBe('VERSION_CONFLICT');
  });

  it('refuses edits after freeze, bad approvers, empty bodies and readers', async () => {
    const frozen = await seedBrief(w, { stage: 'frozen' });
    const agent = await loginAgent(app, w.maker);
    const res = await agent
      .patch(`${API}/briefs/${frozen.id}`)
      .send({ version: 1, updatedAt: frozen.updatedAt.toISOString(), hook: 'x' })
      .expect(422);
    expect(res.body.code).toBe('STAGE_NOT_ALLOWED');

    const b = await seedBrief(w);
    const token = { version: 1, updatedAt: b.updatedAt.toISOString() };
    const badApprover = await agent
      .patch(`${API}/briefs/${b.id}`)
      .send({ ...token, claimsApproverId: w.maker.id })
      .expect(422);
    expect(badApprover.body.code).toBe('INVALID_APPROVER');
    await agent.patch(`${API}/briefs/${b.id}`).send({ ...token, brandApproverId: w.owner.id }).expect(422);
    await agent.patch(`${API}/briefs/${b.id}`).send({ ...token, ownerId: w.outsider.id }).expect(422);
    await agent.patch(`${API}/briefs/${b.id}`).send(token).expect(400);
    await agent.patch(`${API}/briefs/${b.id}`).send({ hook: 'x' }).expect(400);
    const ok = await agent
      .patch(`${API}/briefs/${b.id}`)
      .send({ ...token, brandApproverId: w.brand.id, ownerId: w.owner.id, claudeSuggestions: { bRoll: ['phone clock'] } })
      .expect(200);
    expect(ok.body.claudeSuggestions.bRoll).toEqual(['phone clock']);

    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer
      .patch(`${API}/briefs/${b.id}`)
      .send({ version: 1, updatedAt: ok.body.updatedAt, hook: 'x' })
      .expect(403);
  });
});

describe('POST /briefs/:id/claim-check', () => {
  it('previews a draft without storing it', async () => {
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.reviewer);
    const res = await agent
      .post(`${API}/briefs/${b.id}/claim-check`)
      .send({ draft: { hook: 'Try a 60 second call', beats: [], ask: null } })
      .expect(200);
    const out = claimCheckResultSchema.parse(res.body);
    expect(out).toMatchObject({ blocking: true, stored: false, kitVersion: 1 });
    const [row] = await db.select().from(briefs).where(eq(briefs.id, b.id));
    expect(row!.claimFlags.some((f) => f.status === 'fail')).toBe(false);
  });

  it('checks the stored brief and saves the result without changing updatedAt', async () => {
    const b = await seedBrief(w, { hook: 'Stay anonymous.' });
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/briefs/${b.id}/claim-check`).send({}).expect(200);
    expect(res.body).toMatchObject({ blocking: true, stored: true });
    const [row] = await db.select().from(briefs).where(eq(briefs.id, b.id));
    expect(row!.claimFlags.some((f) => f.rule === 'never_say' && f.status === 'fail')).toBe(true);
    expect(row!.claims.length).toBeGreaterThan(0);
    expect(row!.updatedAt.getTime()).toBe(b.updatedAt.getTime());
    expect(await audits('brief.claim_check')).toHaveLength(1);
  });

  it('lets a reader preview but not store, and validates the draft', async () => {
    const b = await seedBrief(w);
    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.post(`${API}/briefs/${b.id}/claim-check`).send({}).expect(403);
    await reviewer
      .post(`${API}/briefs/${b.id}/claim-check`)
      .send({ draft: { beats: 'not-an-array' } })
      .expect(400);
  });
});

describe('freeze, unfreeze, send for review', () => {
  it('freezes a clean, complete brief', async () => {
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/briefs/${b.id}/freeze`).send({ version: 1 }).expect(200);
    expect(res.body.stage).toBe('frozen');
    expect(res.body.frozenAt).not.toBeNull();
    const [audit] = await audits('brief.freeze');
    expect(audit).toMatchObject({ before: { stage: 'brief' }, after: { stage: 'frozen' } });
  });

  it('refuses freeze with red flags, missing text, a stale version or a wrong stage', async () => {
    const agent = await loginAgent(app, w.maker);
    const red = await seedBrief(w, { hook: 'Totally anonymous' });
    const r1 = await agent.post(`${API}/briefs/${red.id}/freeze`).send({ version: 1 }).expect(422);
    expect(r1.body.code).toBe('CLAIM_CHECK_FAILED');

    const empty = await seedBrief(w, { hook: null });
    const r2 = await agent.post(`${API}/briefs/${empty.id}/freeze`).send({ version: 1 }).expect(422);
    expect(r2.body.code).toBe('BRIEF_INCOMPLETE');

    const ok = await seedBrief(w);
    const r3 = await agent.post(`${API}/briefs/${ok.id}/freeze`).send({ version: 7 }).expect(409);
    expect(r3.body.code).toBe('VERSION_CONFLICT');
    await agent.post(`${API}/briefs/${ok.id}/freeze`).send({}).expect(400);

    const made = await seedBrief(w, { stage: 'made' });
    const r4 = await agent.post(`${API}/briefs/${made.id}/freeze`).send({ version: 1 }).expect(422);
    expect(r4.body.code).toBe('STAGE_NOT_ALLOWED');

    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.post(`${API}/briefs/${ok.id}/freeze`).send({ version: 1 }).expect(403);
  });

  it('never bumps the version: autosave, freeze, unfreeze and send for review keep it', async () => {
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.maker);
    let token = b.updatedAt.toISOString();
    for (const ask of ['Send a byte.', 'Send a byte today.']) {
      const saved = await agent
        .patch(`${API}/briefs/${b.id}`)
        .send({ version: 1, updatedAt: token, ask })
        .expect(200);
      expect(saved.body.version).toBe(1);
      token = saved.body.updatedAt;
    }
    await agent.post(`${API}/briefs/${b.id}/freeze`).send({ version: 1 }).expect(200);
    await agent.post(`${API}/briefs/${b.id}/unfreeze`).send({ version: 1 }).expect(200);
    await agent.post(`${API}/briefs/${b.id}/freeze`).send({ version: 1 }).expect(200);
    await seedAsset(b.id);
    const sent = await agent.post(`${API}/briefs/${b.id}/send-for-review`).send({ version: 1 }).expect(200);
    expect(sent.body).toMatchObject({ stage: 'made', version: 1 });
    const [row] = await db.select({ version: briefs.version }).from(briefs).where(eq(briefs.id, b.id));
    expect(row?.version).toBe(1);
  });

  it('unfreezes a frozen brief only', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/briefs/${b.id}/unfreeze`).send({ version: 1 }).expect(200);
    expect(res.body).toMatchObject({ stage: 'brief', frozenAt: null });
    await agent.post(`${API}/briefs/${b.id}/unfreeze`).send({ version: 1 }).expect(422);
  });

  it('sends for review only with a ready master of this version, and notifies reviewers', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const agent = await loginAgent(app, w.maker);
    const none = await agent.post(`${API}/briefs/${b.id}/send-for-review`).send({ version: 1 }).expect(422);
    expect(none.body.code).toBe('MASTER_ASSET_MISSING');

    await seedAsset(b.id, { status: 'uploading' });
    await seedAsset(b.id, { kind: 'cutdown' });
    await seedAsset(b.id, { briefVersion: 2 });
    await agent.post(`${API}/briefs/${b.id}/send-for-review`).send({ version: 1 }).expect(422);

    await seedAsset(b.id);
    const res = await agent.post(`${API}/briefs/${b.id}/send-for-review`).send({ version: 1 }).expect(200);
    expect(res.body.stage).toBe('made');
    const notes = await db.select().from(notifications);
    expect(notes.map((n) => n.userId)).toEqual([w.reviewer.id]);
    expect(notes[0]!.link).toBe(`/review/${b.id}`);

    const again = await agent.post(`${API}/briefs/${b.id}/send-for-review`).send({ version: 1 }).expect(422);
    expect(again.body.code).toBe('STAGE_NOT_ALLOWED');
  });
});

describe('POST /briefs/:id/assist', () => {
  it('returns Claude drafts, dropping never-say ones, and stores nothing', async () => {
    settings.buildProductContext.mockResolvedValue({ text: 'Kit: ...', tokenEstimate: 10, documentIds: [] });
    claude.generateJson.mockResolvedValue({
      data: { suggestions: ['Thirty minutes is a lot.', 'Stay anonymous!', 'Thirty minutes is a lot.', 'Your byte waits.'] },
      usage: { inputTokens: 1, outputTokens: 1, model: 'test' },
    });
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/briefs/${b.id}/assist`).send({ kind: 'alt_hooks' }).expect(200);
    expect(res.body).toMatchObject({
      kind: 'alt_hooks',
      dropped: 1,
      suggestions: [
        { text: 'Thirty minutes is a lot.', language: null },
        { text: 'Your byte waits.', language: null },
      ],
    });
    const call = claude.generateJson.mock.calls[0]![0] as { productId: string; prompt: string };
    expect(call.productId).toBe(w.productId);
    expect(call.prompt).toContain('You are not a bad friend.');
    const [row] = await db.select().from(briefs).where(eq(briefs.id, b.id));
    expect(row!.updatedAt.getTime()).toBe(b.updatedAt.getTime());
  });

  it('marks Tamil captions and falls back to the kit while settings is not built', async () => {
    settings.buildProductContext.mockRejectedValue(
      new AppError({ status: 501, code: 'NOT_IMPLEMENTED', title: 'Not implemented' }),
    );
    claude.generateJson.mockResolvedValue({
      data: { suggestions: ['இன்று ஒரு பைட் அனுப்புங்கள்.'] },
      usage: { inputTokens: 1, outputTokens: 1, model: 'test' },
    });
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/briefs/${b.id}/assist`).send({ kind: 'tamil_caption' }).expect(200);
    expect(res.body.suggestions[0].language).toBe('ta');
    const call = claude.generateJson.mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toContain('Be there for your people');
  });

  it('reports Claude not connected, a bad kind and readers', async () => {
    settings.buildProductContext.mockResolvedValue({ text: '', tokenEstimate: 0, documentIds: [] });
    claude.generateJson.mockRejectedValue(featureDisabled('Claude'));
    const b = await seedBrief(w);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/briefs/${b.id}/assist`).send({ kind: 'broll' }).expect(503);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    await agent.post(`${API}/briefs/${b.id}/assist`).send({ kind: 'poem' }).expect(400);
    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.post(`${API}/briefs/${b.id}/assist`).send({ kind: 'broll' }).expect(403);
  });
});

describe('createBriefFromIdea (shared)', () => {
  async function seedIdea(status: 'new' | 'starred' | 'parked' = 'starred', mode: 'M1' | 'M4' = 'M1') {
    const [idea] = await db
      .insert(ideas)
      .values({ productId: w.productId, title: 'Night shift circle', mode, channels: ['instagram', 'youtube'], status })
      .returning();
    return idea!;
  }

  it('creates a brief, marks the idea briefed and is idempotent', async () => {
    const idea = await seedIdea();
    const brief = await createBriefFromIdea({ ideaId: idea.id, actorId: w.maker.id });
    expect(brief).toMatchObject({
      stage: 'brief',
      kind: 'reel',
      title: 'Night shift circle',
      ideaId: idea.id,
      channels: ['instagram', 'youtube'],
      owner: { id: w.maker.id },
    });
    const [after] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(after!.status).toBe('briefed');
    const again = await createBriefFromIdea({ ideaId: idea.id, actorId: w.maker.id });
    expect(again.id).toBe(brief.id);
    expect(await db.select().from(briefs)).toHaveLength(1);
    expect(await audits('brief.create_from_idea')).toHaveLength(1);
  });

  it('makes a poster for M4, links the plan item and works inside a caller transaction', async () => {
    const idea = await seedIdea('new', 'M4');
    const [plan] = await db.insert(plans).values({ productId: w.productId, month: '2026-11' }).returning();
    const [item] = await db
      .insert(planItems)
      .values({ planId: plan!.id, date: '2026-11-03', title: 'Poster', ideaId: idea.id })
      .returning();
    const brief = await db.transaction((tx) =>
      createBriefFromIdea({ ideaId: idea.id, actorId: w.maker.id, planItemId: item!.id }, tx),
    );
    expect(brief.kind).toBe('poster');
    expect(brief.code).toMatch(/^POSTER-/);
    const [linked] = await db.select().from(planItems).where(eq(planItems.id, item!.id));
    expect(linked!.briefId).toBe(brief.id);
  });

  it('refuses a parked idea, an unknown idea and a plan item of another product', async () => {
    const parked = await seedIdea('parked');
    await expect(createBriefFromIdea({ ideaId: parked.id, actorId: w.maker.id })).rejects.toMatchObject({
      code: 'IDEA_PARKED',
    });
    await expect(
      createBriefFromIdea({ ideaId: crypto.randomUUID(), actorId: w.maker.id }),
    ).rejects.toMatchObject({ status: 404 });
    const idea = await seedIdea();
    await expect(
      createBriefFromIdea({ ideaId: idea.id, actorId: w.maker.id, planItemId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    // Nothing half-done: the failed call rolled back.
    const rows = await db.select().from(briefs).where(and(eq(briefs.ideaId, idea.id)));
    expect(rows).toHaveLength(0);
  });
});
