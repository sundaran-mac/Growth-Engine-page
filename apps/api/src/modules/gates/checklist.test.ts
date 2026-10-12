import { describe, expect, it } from 'vitest';
import type { ChecklistItem, ClaimFlag } from '@growth-desk/contract';
import {
  applyManualTicks,
  autoCheck,
  buildChecklist,
  checklistCounts,
  checklistLabel,
  formatLufs,
  type ChecklistAsset,
  type ChecklistInputs,
} from './checklist.js';
import { isAssignedDecider, canSendProduct, canReviewProduct, type Actor } from './access.js';

const pass: ClaimFlag[] = [{ rule: 'never_say', status: 'pass', message: 'ok', suggestion: null }];

const video = (over: Partial<ChecklistAsset> = {}): ChecklistAsset => ({
  mimeType: 'video/mp4',
  licence: 'Licensed track',
  consentOnFile: true,
  aiGenerated: false,
  loudnessLufs: null,
  ...over,
});

function inputs(over: Partial<ChecklistInputs> = {}): ChecklistInputs {
  const master = over.master === undefined ? video() : over.master;
  return {
    mode: 'M1',
    captionLanguages: ['en', 'ta'],
    claimFlags: pass,
    master,
    visualAssets: master ? [master] : [],
    posts: [],
    trackingBaseUrl: 'https://live.humini.app',
    ...over,
  };
}

describe('checklist labels', () => {
  it('names the caption languages', () => {
    expect(checklistLabel('captions_safe_zone', ['en', 'ta'])).toBe(
      'Captions EN and TA inside the safe zone',
    );
    expect(checklistLabel('captions_safe_zone', [])).toBe('Captions inside the safe zone');
  });
  it('formats LUFS with a minus sign', () => {
    expect(formatLufs(-11.84)).toBe('−11.8');
    expect(formatLufs(0)).toBe('0.0');
  });
});

describe('autoCheck', () => {
  it('claim check: not run, red, amber, pass', () => {
    expect(autoCheck('claim_check', inputs({ claimFlags: [] }))).toEqual({
      done: false,
      detail: 'The claim check has not run on this brief',
    });
    const red: ClaimFlag[] = [
      { rule: 'never_say', status: 'fail', message: 'x', suggestion: null },
      { rule: 'other', status: 'fail', message: 'y', suggestion: null },
    ];
    expect(autoCheck('claim_check', inputs({ claimFlags: red }))).toEqual({
      done: false,
      detail: '2 red flags',
    });
    const amber: ClaimFlag[] = [
      { rule: 'spec_cited', status: 'warn', message: 'x', suggestion: null },
    ];
    expect(autoCheck('claim_check', inputs({ claimFlags: amber }))).toEqual({
      done: true,
      detail: '1 amber note',
    });
    expect(autoCheck('claim_check', inputs())).toEqual({ done: true, detail: null });
  });

  it('asset checks fail without a ready master', () => {
    for (const key of ['consent', 'music_licence', 'ai_label', 'loudness'] as const) {
      expect(autoCheck(key, inputs({ master: null }))?.done).toBe(false);
    }
  });

  it('consent needs every visual asset', () => {
    const m = video();
    const cut = video({ consentOnFile: false });
    expect(autoCheck('consent', inputs({ master: m, visualAssets: [m, cut] }))).toEqual({
      done: false,
      detail: 'Consent missing on 1 asset',
    });
  });

  it('music licence: licence text, missing, still image', () => {
    expect(autoCheck('music_licence', inputs())).toEqual({ done: true, detail: 'Licensed track' });
    expect(autoCheck('music_licence', inputs({ master: video({ licence: '  ' }) }))?.done).toBe(
      false,
    );
    expect(
      autoCheck(
        'music_licence',
        inputs({ master: video({ mimeType: 'image/png', licence: null }) }),
      ),
    ).toEqual({ done: true, detail: 'No audio in a still image' });
  });

  it('AI label: required for AI people mode', () => {
    expect(autoCheck('ai_label', inputs({ mode: 'M2' }))?.done).toBe(false);
    expect(
      autoCheck('ai_label', inputs({ mode: 'M2', master: video({ aiGenerated: true }) })),
    ).toEqual({
      done: true,
      detail: 'AI label on',
    });
    expect(autoCheck('ai_label', inputs())).toEqual({ done: true, detail: 'No generated people' });
  });

  it('tracked link: posts first, then the tracking base URL', () => {
    expect(
      autoCheck(
        'tracked_link',
        inputs({ posts: [{ trackedUrl: 'https://x' }, { trackedUrl: null }] }),
      ),
    ).toEqual({
      done: false,
      detail: '1 post has no tracked link',
    });
    expect(autoCheck('tracked_link', inputs({ posts: [{ trackedUrl: 'https://x' }] }))?.done).toBe(
      true,
    );
    expect(autoCheck('tracked_link', inputs({ trackingBaseUrl: null }))?.done).toBe(false);
    expect(autoCheck('tracked_link', inputs())?.done).toBe(true);
  });

  it('loudness: within 1 LU of -14 passes, outside fails, no reading is manual', () => {
    expect(autoCheck('loudness', inputs({ master: video({ loudnessLufs: -14 }) }))?.done).toBe(
      true,
    );
    expect(autoCheck('loudness', inputs({ master: video({ loudnessLufs: -13 }) }))?.done).toBe(
      true,
    );
    expect(autoCheck('loudness', inputs({ master: video({ loudnessLufs: -15 }) }))?.done).toBe(
      true,
    );
    expect(autoCheck('loudness', inputs({ master: video({ loudnessLufs: -11.8 }) }))).toEqual({
      done: false,
      detail: '−11.8 LUFS (target −14.0)',
    });
    expect(autoCheck('loudness', inputs({ master: video({ loudnessLufs: -15.2 }) }))?.done).toBe(
      false,
    );
    expect(autoCheck('loudness', inputs())).toBeNull();
  });

  it('safe zone and real screens are always manual', () => {
    expect(autoCheck('captions_safe_zone', inputs())).toBeNull();
    expect(autoCheck('real_screens', inputs())).toBeNull();
  });
});

describe('buildChecklist', () => {
  it('has the 8 items in order and keeps only manual ticks', () => {
    const stored: ChecklistItem[] = [
      { key: 'captions_safe_zone', label: 'x', done: true, auto: true, detail: null },
      { key: 'real_screens', label: 'x', done: true, auto: false, detail: null },
    ];
    const items = buildChecklist(inputs(), stored);
    expect(items.map((i) => i.key)).toEqual([
      'claim_check',
      'captions_safe_zone',
      'real_screens',
      'consent',
      'music_licence',
      'tracked_link',
      'ai_label',
      'loudness',
    ]);
    expect(items.find((i) => i.key === 'captions_safe_zone')).toMatchObject({
      done: false,
      auto: false,
    });
    expect(items.find((i) => i.key === 'real_screens')).toMatchObject({ done: true, auto: false });
    expect(items.find((i) => i.key === 'loudness')).toMatchObject({ auto: false, done: false });
    expect(checklistCounts(items)).toEqual({ done: 6, total: 8, complete: false });
  });

  it('applyManualTicks refuses auto items and applies manual ones', () => {
    const items = buildChecklist(inputs(), null);
    expect(applyManualTicks(items, [{ key: 'claim_check', done: true }]).autoKey).toBe(
      'claim_check',
    );
    const r = applyManualTicks(items, [
      { key: 'captions_safe_zone', done: true },
      { key: 'real_screens', done: true },
      { key: 'loudness', done: true },
    ]);
    expect(r.autoKey).toBeNull();
    expect(checklistCounts(r.items).complete).toBe(true);
  });
});

describe('access rules', () => {
  const base: Actor = { id: 'u1', role: 'member', isBrandApprover: false, memberships: [] };
  it('only the approver, or the backup after escalation, decides', () => {
    const a = { approverId: 'u1', backupId: 'u2', escalatedAt: null };
    expect(isAssignedDecider(base, a)).toBe(true);
    expect(isAssignedDecider({ ...base, id: 'u2' }, a)).toBe(false);
    expect(isAssignedDecider({ ...base, id: 'u2' }, { ...a, escalatedAt: new Date() })).toBe(true);
    expect(isAssignedDecider({ ...base, id: 'u3', role: 'admin' }, a)).toBe(false);
  });
  it('send needs owner, backup or maker (or admin/editor); viewers never review', () => {
    const reviewer: Actor = { ...base, memberships: [{ productId: 'p', productRole: 'reviewer' }] };
    expect(canSendProduct(reviewer, 'p')).toBe(false);
    expect(canReviewProduct(reviewer, 'p')).toBe(true);
    expect(
      canSendProduct({ ...base, memberships: [{ productId: 'p', productRole: 'maker' }] }, 'p'),
    ).toBe(true);
    expect(canSendProduct({ ...base, role: 'editor' }, 'p')).toBe(true);
    expect(canReviewProduct({ ...reviewer, role: 'viewer' }, 'p')).toBe(false);
  });
});
