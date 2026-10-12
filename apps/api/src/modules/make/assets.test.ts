import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUploadResponseSchema, type RenderJob } from '@growth-desk/contract';
import { createApp } from '../../app.js';
import type * as StorageLib from '../../lib/storage.js';
import { db } from '../../db/client.js';
import { assets, auditLogs, channelAccounts, posts, renderJobs } from '../../db/schema/index.js';
import { featureDisabled } from '../../lib/errors.js';
import { loginAgent, truncateAll } from '../../../test/helpers.js';
import { handleAssetProbe } from '../../jobs/make.js';
import { makeWorld, seedAsset, seedBrief, type MakeWorld } from './fixtures.test.js';
import { assetStorageKey, partCount } from './assets.service.js';
import { handoffTools, nextRenderJobState } from './render-jobs.service.js';

const storage = vi.hoisted(() => ({
  enabled: true,
  presignPut: vi.fn(),
  createMultipart: vi.fn(),
  presignPart: vi.fn(),
  completeMultipart: vi.fn(),
  abortMultipart: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
  presignGet: vi.fn(),
}));
vi.mock('../../lib/storage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof StorageLib>()),
  isStorageEnabled: () => storage.enabled,
  presignPut: storage.presignPut,
  createMultipart: storage.createMultipart,
  presignPart: storage.presignPart,
  completeMultipart: storage.completeMultipart,
  abortMultipart: storage.abortMultipart,
  headObject: storage.headObject,
  deleteObject: storage.deleteObject,
  presignGet: storage.presignGet,
}));

const app = createApp();
const API = '/api/v1';
const MiB = 1024 * 1024;
let w: MakeWorld;

beforeEach(async () => {
  await truncateAll();
  vi.clearAllMocks();
  storage.enabled = true;
  storage.presignPut.mockImplementation(async (i: { key: string }) => ({ url: `https://s3.test/${i.key}?put`, expiresIn: 900 }));
  storage.createMultipart.mockResolvedValue({ uploadId: 'up-1' });
  storage.presignPart.mockImplementation(async (i: { partNumber: number }) => ({
    url: `https://s3.test/part/${i.partNumber}`,
    partNumber: i.partNumber,
    expiresIn: 3600,
  }));
  storage.completeMultipart.mockResolvedValue({ etag: 'e' });
  storage.abortMultipart.mockResolvedValue(undefined);
  storage.deleteObject.mockResolvedValue(undefined);
  storage.presignGet.mockResolvedValue({ url: 'https://s3.test/get', expiresIn: 900 });
  w = await makeWorld();
});

const upload = (briefId: string, over: Record<string, unknown> = {}) => ({
  briefId,
  kind: 'video',
  ratio: '9:16',
  fileName: 'Reel 031 Master.MP4',
  mimeType: 'video/mp4',
  sizeBytes: 10 * MiB,
  durationMs: 58_000,
  licence: 'Licensed track',
  consentOnFile: true,
  aiGenerated: false,
  ...over,
});

describe('storage keys and parts', () => {
  it('builds the key from product, brief, asset and a safe file name', () => {
    expect(assetStorageKey({ productId: 'p', briefId: 'b', assetId: 'a', fileName: '../My Reel (final).mp4' })).toBe(
      'products/p/briefs/b/a/my-reel-final.mp4',
    );
    expect(partCount(25 * MiB, 10 * MiB)).toBe(3);
  });
});

describe('POST /assets/uploads', () => {
  it('gives a single presigned PUT up to 50 MB', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/assets/uploads`).send(upload(b.id)).expect(201);
    const body = createUploadResponseSchema.parse(res.body);
    expect(body.upload).toMatchObject({ mode: 'single', method: 'PUT', headers: { 'Content-Type': 'video/mp4' } });
    expect(body.asset).toMatchObject({ status: 'uploading', kind: 'video', ratio: '9:16', consentOnFile: true });
    expect(body.asset.storageKey).toBe(
      `products/${w.productId}/briefs/${b.id}/${body.asset.id}/reel-031-master.mp4`,
    );
    expect(storage.presignPut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'video/mp4', contentLength: 10 * MiB }),
    );
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'asset.upload_start'))).toHaveLength(1);
  });

  it('uses multipart with 10 MiB parts above 50 MB', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    const agent = await loginAgent(app, w.maker);
    const res = await agent
      .post(`${API}/assets/uploads`)
      .send(upload(b.id, { sizeBytes: 55 * MiB }))
      .expect(201);
    expect(res.body.upload).toMatchObject({ mode: 'multipart', partSize: 10 * MiB });
    expect(res.body.upload.parts).toHaveLength(6);
    const [row] = await db.select().from(assets).where(eq(assets.id, res.body.asset.id));
    expect(row!.uploadId).toBe('up-1');
    expect(JSON.stringify(res.body)).not.toContain('up-1');
  });

  it('validates type, extension, size, ratio and stage', async () => {
    const frozen = await seedBrief(w, { stage: 'frozen' });
    const agent = await loginAgent(app, w.maker);
    const send = (body: Record<string, unknown>) => agent.post(`${API}/assets/uploads`).send(body);
    expect((await send(upload(frozen.id, { mimeType: 'application/pdf', fileName: 'a.pdf' }))).status).toBe(400);
    expect((await send(upload(frozen.id, { fileName: 'master.mov' }))).status).toBe(400);
    expect((await send(upload(frozen.id, { sizeBytes: 3 * 1024 * MiB }))).status).toBe(400);
    expect((await send(upload(frozen.id, { kind: 'poster' }))).status).toBe(400);
    const noRatio = await send(upload(frozen.id, { ratio: null }));
    expect(noRatio.status).toBe(400);
    expect(noRatio.body.errors[0].path).toBe('body.ratio');
    const caption = await send(
      upload(frozen.id, { kind: 'caption', ratio: null, fileName: 'en.vtt', mimeType: 'text/vtt', sizeBytes: 2000 }),
    );
    expect(caption.status).toBe(201);
    expect(caption.body.asset.ratio).toBeNull();

    const draft = await seedBrief(w, { stage: 'brief' });
    const r = await send(upload(draft.id)).expect(422);
    expect(r.body.code).toBe('STAGE_NOT_ALLOWED');
  });

  it('checks the role and says when storage is not connected', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.post(`${API}/assets/uploads`).send(upload(b.id)).expect(403);
    await request(app).post(`${API}/assets/uploads`).send(upload(b.id)).expect(403); // no Origin
    storage.enabled = false;
    const maker = await loginAgent(app, w.maker);
    const res = await maker.post(`${API}/assets/uploads`).send(upload(b.id)).expect(503);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    expect(await db.select().from(assets)).toHaveLength(0);
  });
});

describe('complete, abort, url, delete', () => {
  it('completes a single upload after checking the stored object', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const a = await seedAsset(b.id, { status: 'uploading', sizeBytes: 1000 });
    const agent = await loginAgent(app, w.maker);

    storage.headObject.mockResolvedValueOnce(null);
    const missing = await agent.post(`${API}/assets/${a.id}/complete`).send({}).expect(409);
    expect(missing.body.code).toBe('UPLOAD_NOT_FOUND');

    storage.headObject.mockResolvedValueOnce({ sizeBytes: 1000, contentType: 'video/mp4', etag: 'x', lastModified: null });
    const ok = await agent.post(`${API}/assets/${a.id}/complete`).send({}).expect(200);
    expect(ok.body.status).toBe('ready');
    const again = await agent.post(`${API}/assets/${a.id}/complete`).send({}).expect(409);
    expect(again.body.code).toBe('UPLOAD_NOT_OPEN');
  });

  it('marks a size mismatch as failed and removes the object', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const a = await seedAsset(b.id, { status: 'uploading', sizeBytes: 1000 });
    storage.headObject.mockResolvedValueOnce({ sizeBytes: 10, contentType: 'video/mp4', etag: 'x', lastModified: null });
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/assets/${a.id}/complete`).send({}).expect(422);
    expect(res.body.code).toBe('UPLOAD_SIZE_MISMATCH');
    const [row] = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(row!.status).toBe('failed');
    expect(storage.deleteObject).toHaveBeenCalledWith(a.storageKey);
  });

  it('completes a multipart upload with every part', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const a = await seedAsset(b.id, { status: 'uploading', sizeBytes: 25 * MiB, uploadId: 'up-9' });
    const agent = await loginAgent(app, w.maker);
    await agent.post(`${API}/assets/${a.id}/complete`).send({}).expect(400);
    const bad = await agent
      .post(`${API}/assets/${a.id}/complete`)
      .send({ parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 1, etag: 'b' }, { partNumber: 2, etag: 'c' }] })
      .expect(400);
    expect(bad.body.code).toBe('UPLOAD_PARTS_INVALID');
    storage.headObject.mockResolvedValueOnce({ sizeBytes: 25 * MiB, contentType: 'video/mp4', etag: 'x', lastModified: null });
    const parts = [1, 2, 3].map((n) => ({ partNumber: n, etag: `"e${n}"` }));
    await agent.post(`${API}/assets/${a.id}/complete`).send({ parts }).expect(200);
    expect(storage.completeMultipart).toHaveBeenCalledWith({ key: a.storageKey, uploadId: 'up-9', parts });
    const [row] = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(row).toMatchObject({ status: 'ready', uploadId: null });
  });

  it('aborts an open upload and deletes the row', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const multi = await seedAsset(b.id, { status: 'uploading', uploadId: 'up-2' });
    const ready = await seedAsset(b.id);
    const agent = await loginAgent(app, w.maker);
    await agent.post(`${API}/assets/${multi.id}/abort`).send({}).expect(204);
    expect(storage.abortMultipart).toHaveBeenCalledWith({ key: multi.storageKey, uploadId: 'up-2' });
    await agent.post(`${API}/assets/${ready.id}/abort`).send({}).expect(409);
    expect((await db.select().from(assets)).map((r) => r.id)).toEqual([ready.id]);
  });

  it('gives a presigned GET for a ready file only, to readers', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    const ready = await seedAsset(b.id);
    const open = await seedAsset(b.id, { status: 'uploading' });
    const reviewer = await loginAgent(app, w.reviewer);
    const res = await reviewer.get(`${API}/assets/${ready.id}/url`).expect(200);
    expect(res.body).toEqual({ url: 'https://s3.test/get', expiresIn: 900 });
    expect(res.headers['cache-control']).toBe('no-store');
    await reviewer.get(`${API}/assets/${open.id}/url`).expect(422);
    const outsider = await loginAgent(app, w.outsider);
    await outsider.get(`${API}/assets/${ready.id}/url`).expect(403);
    await reviewer.get(`${API}/assets/${crypto.randomUUID()}/url`).expect(404);
  });

  it('lists assets of a brief', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    await seedAsset(b.id);
    await seedAsset(b.id, { kind: 'cutdown' });
    const agent = await loginAgent(app, w.reviewer);
    const res = await agent.get(`${API}/briefs/${b.id}/assets`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((a: { kind: string }) => a.kind)).toEqual(['video', 'cutdown']);
  });

  it('deletes a file unless a post uses it; a storage error keeps the row', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    const a = await seedAsset(b.id);
    const used = await seedAsset(b.id);
    const [acct] = await db
      .insert(channelAccounts)
      .values({ platform: 'instagram', displayName: 'IG', status: 'connected' })
      .returning();
    await db.insert(posts).values({
      briefId: b.id,
      briefVersion: 1,
      channelAccountId: acct!.id,
      assetId: used.id,
      audienceTz: 'Asia/Kolkata',
    });
    const agent = await loginAgent(app, w.maker);
    const inUse = await agent.delete(`${API}/assets/${used.id}`).expect(409);
    expect(inUse.body.code).toBe('ASSET_IN_USE');

    storage.deleteObject.mockRejectedValueOnce(new Error('boom'));
    await agent.delete(`${API}/assets/${a.id}`).expect(500);
    expect(await db.select().from(assets).where(eq(assets.id, a.id))).toHaveLength(1);

    await agent.delete(`${API}/assets/${a.id}`).expect(204);
    expect(await db.select().from(assets).where(eq(assets.id, a.id))).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'asset.delete'))).toHaveLength(1);

    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.delete(`${API}/assets/${used.id}`).expect(403);
  });
});

describe('PATCH /assets/:id', () => {
  it('sets loudness and metadata, keeps it through a probe, and validates', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    const a = await seedAsset(b.id);
    const agent = await loginAgent(app, w.maker);
    const res = await agent
      .patch(`${API}/assets/${a.id}`)
      .send({ loudnessLufs: -11.8, licence: ' Licensed track ', consentOnFile: true })
      .expect(200);
    expect(res.body).toMatchObject({ loudnessLufs: -11.8, licence: 'Licensed track', consentOnFile: true });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'asset.update'));
    expect(audit?.after).toMatchObject({ loudnessLufs: -11.8 });

    storage.headObject.mockResolvedValueOnce({ sizeBytes: 1000, contentType: 'video/mp4', etag: null, lastModified: null });
    await handleAssetProbe({ assetId: a.id });
    const list = await agent.get(`${API}/briefs/${b.id}/assets`).expect(200);
    expect(list.body.items[0].loudnessLufs).toBe(-11.8);

    await agent.patch(`${API}/assets/${a.id}`).send({ loudnessLufs: 3 }).expect(400);
    await agent.patch(`${API}/assets/${a.id}`).send({ loudnessLufs: -14.05 }).expect(400);
    await agent.patch(`${API}/assets/${a.id}`).send({}).expect(400);
    const cleared = await agent.patch(`${API}/assets/${a.id}`).send({ loudnessLufs: null }).expect(200);
    expect(cleared.body.loudnessLufs).toBeNull();
    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.patch(`${API}/assets/${a.id}`).send({ loudnessLufs: -14 }).expect(403);
    const approved = await seedBrief(w, { stage: 'approved' });
    const locked = await seedAsset(approved.id);
    const r = await agent.patch(`${API}/assets/${locked.id}`).send({ loudnessLufs: -14 }).expect(422);
    expect(r.body.code).toBe('STAGE_NOT_ALLOWED');
  });

  it('changes the ratio, and keeps a ratio on video files', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    const a = await seedAsset(b.id);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.patch(`${API}/assets/${a.id}`).send({ ratio: '1:1', aiGenerated: true }).expect(200);
    expect(res.body).toMatchObject({ ratio: '1:1', aiGenerated: true });
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, a.id));
    expect(audits.at(-1)?.after).toMatchObject({ ratio: '1:1', aiGenerated: true });
    const noRatio = await agent.patch(`${API}/assets/${a.id}`).send({ ratio: null }).expect(400);
    expect(noRatio.body.code).toBe('VALIDATION_FAILED');
    await agent.patch(`${API}/assets/${a.id}`).send({ ratio: '7:3' }).expect(400);
  });

  it('accepts loudness when the upload starts', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`${API}/assets/uploads`).send(upload(b.id, { loudnessLufs: -14 })).expect(201);
    expect(res.body.asset.loudnessLufs).toBe(-14);
  });
});

describe('job asset.probe', () => {
  it('marks a ready asset failed when the object is gone, and sweeps stale uploads', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    const a = await seedAsset(b.id);
    storage.headObject.mockResolvedValueOnce(null);
    await handleAssetProbe({ assetId: a.id });
    const [row] = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(row!.status).toBe('failed');

    const stale = await seedAsset(b.id, { status: 'uploading', uploadId: 'up-3' });
    await db.update(assets).set({ createdAt: new Date(Date.now() - 48 * 3600_000) }).where(eq(assets.id, stale.id));
    await seedAsset(b.id, { status: 'uploading' }); // fresh, left alone
    await handleAssetProbe({});
    expect(storage.abortMultipart).toHaveBeenCalledWith({ key: stale.storageKey, uploadId: 'up-3' });
    const statuses = (await db.select().from(assets)).map((r) => r.status).sort();
    expect(statuses).toEqual(['failed', 'failed', 'uploading']);
  });

  it('corrects the size of a ready asset and skips open uploads', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    const a = await seedAsset(b.id, { sizeBytes: 5 });
    storage.headObject.mockResolvedValueOnce({ sizeBytes: 50, contentType: 'video/mp4', etag: null, lastModified: null });
    await handleAssetProbe({ assetId: a.id });
    const [row] = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(row).toMatchObject({ status: 'ready', sizeBytes: 50 });
    const open = await seedAsset(b.id, { status: 'uploading' });
    await handleAssetProbe({ assetId: open.id });
    expect(storage.headObject).toHaveBeenCalledTimes(1);
  });
});

describe('render jobs', () => {
  it('creates, lists and moves a job through its states', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const agent = await loginAgent(app, w.maker);
    const created = await agent
      .post(`${API}/briefs/${b.id}/render-jobs`)
      .send({ kind: 'render', label: 'Render 1080x1350 · 30 fps', tool: 'reel-studio' })
      .expect(201);
    const job = created.body as RenderJob;
    expect(job).toMatchObject({ status: 'queued', progress: 0 });

    const running = await agent.patch(`${API}/render-jobs/${job.id}`).send({ progress: 62 }).expect(200);
    expect(running.body).toMatchObject({ status: 'running', progress: 62 });
    expect(running.body.startedAt).not.toBeNull();

    const noError = await agent.patch(`${API}/render-jobs/${job.id}`).send({ status: 'failed' }).expect(422);
    expect(noError.body.code).toBe('RENDER_JOB_STATUS_NOT_ALLOWED');
    await agent.patch(`${API}/render-jobs/${job.id}`).send({ status: 'failed', error: 'Out of memory' }).expect(200);
    await agent.patch(`${API}/render-jobs/${job.id}`).send({ status: 'done' }).expect(422);
    const retried = await agent.patch(`${API}/render-jobs/${job.id}`).send({ status: 'queued' }).expect(200);
    expect(retried.body).toMatchObject({ status: 'queued', error: null, progress: 0 });

    const asset = await seedAsset(b.id, { kind: 'cutdown' });
    const done = await agent.patch(`${API}/render-jobs/${job.id}`).send({ assetId: asset.id }).expect(200);
    expect(done.body).toMatchObject({ status: 'done', progress: 100, assetId: asset.id });
    await agent.patch(`${API}/render-jobs/${job.id}`).send({ label: 'Renamed' }).expect(200);
    await agent.patch(`${API}/render-jobs/${job.id}`).send({ status: 'running' }).expect(422);

    const list = await agent.get(`${API}/briefs/${b.id}/render-jobs`).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].label).toBe('Renamed');
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'render_job.update'))).toHaveLength(5);
  });

  it('validates input, stage, asset ownership and role', async () => {
    const b = await seedBrief(w, { stage: 'frozen' });
    const other = await seedBrief(w, { stage: 'frozen' });
    const foreign = await seedAsset(other.id);
    const agent = await loginAgent(app, w.maker);
    await agent.post(`${API}/briefs/${b.id}/render-jobs`).send({ kind: 'paint', label: 'x' }).expect(400);
    await agent.post(`${API}/briefs/${b.id}/render-jobs`).send({ kind: 'mix', label: 'x', assetId: foreign.id }).expect(400);
    const draft = await seedBrief(w);
    await agent.post(`${API}/briefs/${draft.id}/render-jobs`).send({ kind: 'mix', label: 'x' }).expect(422);
    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.post(`${API}/briefs/${b.id}/render-jobs`).send({ kind: 'mix', label: 'x' }).expect(403);
    const [job] = await db.insert(renderJobs).values({ briefId: b.id, kind: 'mix', label: 'Mix' }).returning();
    await reviewer.patch(`${API}/render-jobs/${job!.id}`).send({ progress: 5 }).expect(403);
    await agent.patch(`${API}/render-jobs/${job!.id}`).send({}).expect(400);
    await agent.patch(`${API}/render-jobs/${job!.id}`).send({ assetId: foreign.id }).expect(400);
    const open = await seedAsset(b.id, { status: 'uploading' });
    await agent.patch(`${API}/render-jobs/${job!.id}`).send({ assetId: open.id }).expect(422);
    await agent.patch(`${API}/render-jobs/${crypto.randomUUID()}`).send({ progress: 1 }).expect(404);
    const reviewerRead = await reviewer.get(`${API}/briefs/${b.id}/render-jobs`).expect(200);
    expect(reviewerRead.body.total).toBe(1);
  });

  it('computes job states (pure)', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const base = { status: 'queued' as const, progress: 0, error: null, startedAt: null, finishedAt: null };
    expect(nextRenderJobState(base, { label: 'x' }, now)).toEqual({ ok: true, set: {} });
    expect(nextRenderJobState(base, { status: 'cancelled' }, now)).toMatchObject({ ok: true, set: { finishedAt: now } });
    expect(nextRenderJobState(base, { status: 'done', progress: 50 }, now)).toMatchObject({ ok: false });
    expect(
      nextRenderJobState({ ...base, status: 'running', progress: 40, startedAt: now }, { status: 'running' }, now),
    ).toMatchObject({ ok: true, set: { progress: 40, startedAt: now } });
  });
});

describe('GET /handoff-tools', () => {
  it('lists the tools, with https URLs from env only', async () => {
    const tools = handoffTools({ HANDOFF_REEL_STUDIO_URL: 'https://studio.arus.sg/', HANDOFF_CAPCUT_URL: 'javascript:alert(1)' });
    expect(tools.find((t) => t.key === 'reel-studio')?.url).toBe('https://studio.arus.sg/');
    expect(tools.find((t) => t.key === 'capcut')?.url).toBe('https://www.capcut.com/');
    const agent = await loginAgent(app, w.reviewer);
    const res = await agent.get(`${API}/handoff-tools`).expect(200);
    expect(res.body.items.map((t: { key: string }) => t.key)).toEqual(['figma', 'capcut', 'adobe-express', 'reel-studio']);
    await request(app).get(`${API}/handoff-tools`).expect(401);
  });
});

describe('storage disabled', () => {
  it('maps the storage error to 503 on the presigned GET', async () => {
    const b = await seedBrief(w, { stage: 'made' });
    const a = await seedAsset(b.id);
    storage.presignGet.mockRejectedValueOnce(featureDisabled('File storage'));
    const agent = await loginAgent(app, w.maker);
    await agent.get(`${API}/assets/${a.id}/url`).expect(503);
  });
});
