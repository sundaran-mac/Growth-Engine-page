/**
 * Thin API client for test data. Each test makes its own records through the real API, signed
 * in as a seed user (storage state from global setup), so runs never depend on one another.
 */
import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { API_PREFIX, BASE_URL, ORIGIN, runSentence, storageStateFor, type RoleKey } from './env';

export interface ProductLite {
  id: string;
  name: string;
  slug: string;
}

export interface BriefLite {
  id: string;
  code: string;
  title: string;
  stage: string;
  version: number;
  updatedAt: string;
  productId: string;
}

export interface ChecklistItemLite {
  key: string;
  label: string;
  done: boolean;
  auto: boolean;
}

export interface ApprovalLite {
  id: string;
  gate: 'claims' | 'brand';
  decision: string;
  approverId: string | null;
}

export interface KitLite {
  version: number;
  status: string;
  promise: string | null;
  behaviours: { text: string; specRef: string | null }[];
  neverSay: string[];
  notBuilt: { text: string; specRef: string | null }[];
  audiences: string[];
  activationEvent: string | null;
  truthSources: string[];
  canSign: boolean;
}

export interface PlanLite {
  id: string;
  status: 'draft' | 'frozen';
  month: string;
  items: { id: string; title: string }[];
}

export interface SlotLite {
  platform: string;
  weekday: number;
  localTime: string;
  audienceTimezone: string;
  label: string | null;
  active: boolean;
}

/** 1x1 transparent PNG: a valid still image for a poster master. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function json<T>(res: APIResponse, what: string): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
  }
  if (res.status() === 204) return undefined as T;
  return (await res.json()) as T;
}

export class Api {
  private constructor(
    readonly role: RoleKey,
    readonly ctx: APIRequestContext,
  ) {}

  static async as(role: RoleKey): Promise<Api> {
    const ctx = await request.newContext({
      baseURL: BASE_URL,
      storageState: storageStateFor(role),
      extraHTTPHeaders: { Origin: ORIGIN },
    });
    return new Api(role, ctx);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    return this.ctx.get(`${API_PREFIX}${path}`, params ? { params } : {}).then((r) => json<T>(r, `GET ${path}`));
  }

  post<T>(path: string, data?: unknown): Promise<T> {
    return this.ctx
      .post(`${API_PREFIX}${path}`, data === undefined ? {} : { data })
      .then((r) => json<T>(r, `POST ${path}`));
  }

  patch<T>(path: string, data: unknown): Promise<T> {
    return this.ctx.patch(`${API_PREFIX}${path}`, { data }).then((r) => json<T>(r, `PATCH ${path}`));
  }

  put<T>(path: string, data: unknown): Promise<T> {
    return this.ctx.put(`${API_PREFIX}${path}`, { data }).then((r) => json<T>(r, `PUT ${path}`));
  }

  /* ---------- people and products ---------- */

  async me(): Promise<{ id: string; name: string; email: string }> {
    const body = await this.get<{ user: { id: string; name: string; email: string } }>('/auth/me');
    return body.user;
  }

  async products(): Promise<ProductLite[]> {
    return (await this.get<{ items: ProductLite[] }>('/products', { limit: 100 })).items;
  }

  async productByName(name: string): Promise<ProductLite> {
    const found = (await this.products()).find((p) => p.name === name);
    if (!found) throw new Error(`Seed product "${name}" not found. Is the database seeded?`);
    return found;
  }

  kit(productId: string): Promise<KitLite> {
    return this.get<KitLite>(`/products/${productId}/kit`);
  }

  async saveKit(productId: string, kit: KitLite, patch: Partial<KitLite>): Promise<KitLite> {
    const next = { ...kit, ...patch };
    return this.put<KitLite>(`/products/${productId}/kit`, {
      version: next.version,
      promise: next.promise,
      behaviours: next.behaviours.map((b) => ({ text: b.text, specRef: b.specRef })),
      neverSay: next.neverSay,
      notBuilt: next.notBuilt.map((b) => ({ text: b.text, specRef: b.specRef })),
      audiences: next.audiences,
      activationEvent: next.activationEvent,
      truthSources: next.truthSources,
    });
  }

  /* ---------- ideas and plans ---------- */

  createIdea(productId: string, title: string, mode = 'M1'): Promise<{ id: string; title: string }> {
    return this.post('/ideas', {
      productId,
      title,
      summary: 'Made by the end-to-end suite.',
      mode,
      channels: ['instagram'],
      fitScore: 80,
    });
  }

  async plan(productId: string, month: string): Promise<PlanLite | null> {
    return (await this.get<{ plan: PlanLite | null }>('/plans', { productId, month })).plan;
  }

  createPlan(productId: string, month: string): Promise<PlanLite> {
    return this.post<PlanLite>('/plans', { productId, month });
  }

  addPlanItem(planId: string, item: { date: string; title: string; mode: string; channel: string }): Promise<unknown> {
    return this.post(`/plans/${planId}/items`, item);
  }

  /* ---------- briefs ---------- */

  createBrief(input: {
    productId: string;
    title: string;
    kind?: 'reel' | 'poster' | 'short' | 'carousel' | 'post';
    mode?: string;
    channels?: string[];
  }): Promise<BriefLite> {
    return this.post<BriefLite>('/briefs', {
      kind: 'poster',
      mode: 'M4',
      channels: ['instagram'],
      ...input,
    });
  }

  brief(id: string): Promise<BriefLite> {
    return this.get<BriefLite>(`/briefs/${id}`);
  }

  async updateBrief(id: string, patch: Record<string, unknown>): Promise<BriefLite> {
    const current = await this.brief(id);
    return this.patch<BriefLite>(`/briefs/${id}`, {
      version: current.version,
      updatedAt: current.updatedAt,
      ...patch,
    });
  }

  claimCheck(id: string): Promise<{ blocking: boolean }> {
    return this.post(`/briefs/${id}/claim-check`, {});
  }

  async freeze(id: string): Promise<BriefLite> {
    const current = await this.brief(id);
    return this.post<BriefLite>(`/briefs/${id}/freeze`, { version: current.version });
  }

  /** Uploads a tiny PNG as the ready poster master (presigned PUT straight to storage). */
  async uploadPosterMaster(briefId: string): Promise<void> {
    const created = await this.post<{
      asset: { id: string };
      upload: { mode: 'single'; url: string; headers: Record<string, string> } | { mode: 'multipart' };
    }>('/assets/uploads', {
      briefId,
      kind: 'poster',
      ratio: '4:5',
      fileName: 'e2e-poster.png',
      mimeType: 'image/png',
      sizeBytes: TINY_PNG.length,
      consentOnFile: true,
      aiGenerated: false,
      licence: 'Own work (e2e)',
    });
    if (created.upload.mode !== 'single') throw new Error('Expected a single PUT upload for a tiny file');
    const put = await this.ctx.fetch(created.upload.url, {
      method: 'PUT',
      headers: { ...created.upload.headers },
      data: TINY_PNG,
    });
    expect(put.ok(), `PUT to storage: ${put.status()} ${await put.text()}`).toBeTruthy();
    await this.post(`/assets/${created.asset.id}/complete`, {});
  }

  async sendForReview(id: string): Promise<BriefLite> {
    const current = await this.brief(id);
    return this.post<BriefLite>(`/briefs/${id}/send-for-review`, { version: current.version });
  }

  review(id: string): Promise<{ brief: BriefLite; checklist: { version: number; items: ChecklistItemLite[]; complete: boolean } }> {
    return this.get(`/briefs/${id}/review`);
  }

  /** Ticks every manual checklist item that is not done yet. */
  async tickManualChecklist(id: string): Promise<void> {
    const r = await this.review(id);
    const open = r.checklist.items.filter((i) => !i.auto && !i.done);
    if (open.length === 0) return;
    await this.patch(`/briefs/${id}/review/checklist`, {
      version: r.brief.version,
      items: open.map((i) => ({ key: i.key, done: true })),
    });
  }

  async sendForApproval(id: string): Promise<{ approvals: ApprovalLite[] }> {
    const current = await this.brief(id);
    return this.post(`/briefs/${id}/send-for-approval`, { version: current.version });
  }

  /** Sends a pending piece back with a note, so test pieces do not wait in anyone's queue. */
  async requestChangesOnMyGate(briefId: string): Promise<void> {
    const list = await this.get<{ items: ApprovalLite[] }>('/approvals', { briefId, mine: true, decision: 'pending' });
    const mine = list.items[0];
    if (!mine) return;
    await this.post(`/approvals/${mine.id}/decide`, { decision: 'changes_requested', note: 'Closed by the e2e suite.' });
  }

  /* ---------- settings ---------- */

  async slots(productId: string): Promise<SlotLite[]> {
    return (await this.get<{ items: SlotLite[] }>(`/products/${productId}/slots`)).items;
  }

  replaceSlots(productId: string, slots: SlotLite[]): Promise<unknown> {
    return this.put(`/products/${productId}/slots`, {
      slots: slots.map((s) => ({
        platform: s.platform,
        weekday: s.weekday,
        localTime: s.localTime,
        audienceTimezone: s.audienceTimezone,
        label: s.label,
        active: s.active,
      })),
    });
  }
}

/**
 * Builds a poster brief for Humini Live and walks it through the API to "made" with a complete
 * checklist and both gates pending: claims for the Live product owner, brand for Elan.
 */
export async function briefWaitingForApproval(title: string): Promise<BriefLite> {
  const jeeva = await Api.as('jeeva');
  const owner = await Api.as('liveowner');
  const elan = await Api.as('elan');
  try {
    const live = await jeeva.productByName('Humini Live');
    const ownerId = (await owner.me()).id;
    const elanId = (await elan.me()).id;
    const brief = await jeeva.createBrief({ productId: live.id, title });
    await jeeva.updateBrief(brief.id, {
      // Unique per run: the content memory blocks a hook that repeats another brief.
      hook: runSentence(),
      beats: ['A heart: the owner sees how many, never who.'],
      ask: 'Start a circle today.',
      captionLanguages: ['en'],
      claimsApproverId: ownerId,
      brandApproverId: elanId,
    });
    await jeeva.claimCheck(brief.id);
    await jeeva.freeze(brief.id);
    await jeeva.uploadPosterMaster(brief.id);
    await jeeva.sendForReview(brief.id);
    await jeeva.tickManualChecklist(brief.id);
    await jeeva.sendForApproval(brief.id);
    return await jeeva.brief(brief.id);
  } finally {
    await Promise.all([jeeva.dispose(), owner.dispose(), elan.dispose()]);
  }
}
