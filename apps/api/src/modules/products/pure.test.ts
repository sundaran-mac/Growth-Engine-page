import { describe, expect, it } from 'vitest';
import { kitFields, kitScore, type KitScoreInput } from '@growth-desk/contract';
import { parseGithubRepo, specRefFromPath } from './github.js';
import { channelRows, effectiveChannelStatus, toolRows } from './integrations.js';
import { sameKitContent } from './service.js';
import { initialsFrom, newTempPassword } from './team.js';
import type { AppEnv } from '../../config/env.js';

const empty: KitScoreInput = {
  promise: null,
  behaviours: [],
  neverSay: [],
  notBuilt: [],
  audiences: [],
  activationEvent: null,
  truthSources: [],
  hasOwner: false,
  hasBackup: false,
};

describe('kitScore', () => {
  it('is 0 for an empty kit and 10 for a full one', () => {
    expect(kitScore(empty)).toBe(0);
    expect(
      kitScore({
        promise: 'p',
        behaviours: [
          { text: 'a', specRef: '006' },
          { text: 'b', specRef: '006' },
          { text: 'c', specRef: '007' },
        ],
        neverSay: ['x'],
        notBuilt: [{ text: 'n' }],
        audiences: ['a'],
        activationEvent: 'e',
        truthSources: ['t'],
        hasOwner: true,
        hasBackup: true,
      }),
    ).toBe(10);
  });

  it('needs three behaviours and a spec on each', () => {
    const two = {
      ...empty,
      behaviours: [
        { text: 'a', specRef: '006' },
        { text: 'b', specRef: '006' },
      ],
    };
    const fields = Object.fromEntries(kitFields(two).map((f) => [f.key, f.done]));
    expect(fields.behaviours).toBe(false);
    expect(fields.specs).toBe(true);
    const noSpec = {
      ...empty,
      behaviours: [
        { text: 'a', specRef: '006' },
        { text: 'b', specRef: null },
        { text: 'c', specRef: '007' },
      ],
    };
    const f2 = Object.fromEntries(kitFields(noSpec).map((f) => [f.key, f.done]));
    expect(f2.behaviours).toBe(true);
    expect(f2.specs).toBe(false);
  });

  it('does not count blank text', () => {
    expect(kitScore({ ...empty, promise: '   ', activationEvent: '' })).toBe(0);
    expect(kitFields(empty)).toHaveLength(10);
  });
});

describe('parseGithubRepo and specRefFromPath', () => {
  it('reads GitHub URLs and owner/name', () => {
    expect(parseGithubRepo('https://github.com/humini-ecosystem/humini-live-app')).toEqual({
      owner: 'humini-ecosystem',
      name: 'humini-live-app',
    });
    expect(parseGithubRepo('https://github.com/org/repo.git')).toEqual({
      owner: 'org',
      name: 'repo',
    });
    expect(parseGithubRepo('github.com/org/repo/tree/main/docs')).toEqual({
      owner: 'org',
      name: 'repo',
    });
    expect(parseGithubRepo('org/repo')).toEqual({ owner: 'org', name: 'repo' });
    expect(parseGithubRepo('https://gitlab.com/org/repo')).toBeNull();
    expect(parseGithubRepo('')).toBeNull();
    expect(parseGithubRepo(null)).toBeNull();
  });

  it('finds spec refs in file names', () => {
    expect(specRefFromPath('docs/specs/006-hearts.md')).toBe('006');
    expect(specRefFromPath('docs/specs/013-02-reels.md')).toBe('013-02');
    expect(specRefFromPath('docs/specs/README.md')).toBeNull();
    expect(specRefFromPath('docs/specs/sub/007_calls.md')).toBe('007');
  });
});

describe('integrations status rules', () => {
  const features: AppEnv['features'] = {
    claude: true,
    storage: false,
    meta: false,
    google: true,
    linkedin: false,
    github: false,
    smtp: false,
  };

  it('connected needs a token; WhatsApp is always manual', () => {
    expect(
      effectiveChannelStatus({ platform: 'instagram', status: 'connected', accessTokenEnc: null }),
    ).toBe('disconnected');
    expect(
      effectiveChannelStatus({ platform: 'instagram', status: 'connected', accessTokenEnc: 'x' }),
    ).toBe('connected');
    expect(
      effectiveChannelStatus({ platform: 'linkedin', status: 'error', accessTokenEnc: null }),
    ).toBe('error');
    expect(
      effectiveChannelStatus({ platform: 'whatsapp', status: 'connected', accessTokenEnc: null }),
    ).toBe('manual');
  });

  it('adds a placeholder row per platform with no account and reports OAuth keys', () => {
    const rows = channelRows([], features);
    expect(rows.map((r) => r.platform)).toEqual([
      'instagram',
      'facebook',
      'youtube',
      'linkedin',
      'whatsapp',
    ]);
    expect(rows.find((r) => r.platform === 'youtube')?.oauthConfigured).toBe(true);
    expect(rows.find((r) => r.platform === 'instagram')?.oauthConfigured).toBe(false);
  });

  it('tools follow env flags and never fake a connection', () => {
    const now = new Date();
    const row = (key: string, status: 'connected' | 'check_first') => ({
      id: key,
      key,
      name: key,
      description: null,
      status,
      createdAt: now,
      updatedAt: now,
    });
    const e = { features, anthropicModel: 'm', storage: null } as unknown as AppEnv;
    const tools = Object.fromEntries(
      toolRows(
        [
          row('claude', 'connected'),
          row('github', 'connected'),
          row('google-drive', 'connected'),
          row('analytics', 'check_first'),
        ],
        e,
      ).map((t) => [t.key, t.status]),
    );
    expect(tools).toEqual({
      claude: 'connected',
      github: 'not_set_up',
      'google-drive': 'not_set_up',
      analytics: 'check_first',
      storage: 'not_set_up',
    });
  });
});

describe('small helpers', () => {
  it('initials', () => {
    expect(initialsFrom('Jeeva Santiago')).toBe('JS');
    expect(initialsFrom('Elan')).toBe('E');
    expect(initialsFrom('  meera  k iyer ')).toBe('MI');
  });

  it('temp passwords are long and different', () => {
    const a = newTempPassword();
    expect(a.length).toBe(20);
    expect(a).not.toBe(newTempPassword());
  });

  it('sameKitContent ignores nothing that matters', () => {
    const base = {
      promise: 'p',
      behaviours: [{ text: 'a', specRef: null }],
      neverSay: ['x'],
      notBuilt: [],
      audiences: [],
      activationEvent: null,
      truthSources: [],
    };
    expect(sameKitContent(base, { ...base })).toBe(true);
    expect(sameKitContent(base, { ...base, neverSay: ['x', 'y'] })).toBe(false);
    expect(sameKitContent(base, { ...base, behaviours: [{ text: 'a', specRef: '006' }] })).toBe(
      false,
    );
  });
});
