import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import StudioPage from '@/pages/StudioPage';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { jsonResponse, ME, mockFetch, renderWithRouter } from '@/test/utils';
import { BRIEF_ID, makeAsset, makeBrief, PRODUCT_ID } from './fixtures.test-util';
import { canSendForReview, pickMaster } from './helpers';

const HEALTH = {
  status: 'ok',
  version: '0.1.0',
  time: '2026-10-12T10:00:00.000Z',
  checks: {},
  features: {
    claude: true,
    storage: true,
    meta: false,
    google: false,
    linkedin: false,
    github: false,
    smtp: false,
  },
};
const TOOLS = {
  items: [
    {
      key: 'figma',
      name: 'Figma',
      description: 'Posters and screens',
      url: 'https://www.figma.com/',
    },
    {
      key: 'capcut',
      name: 'CapCut',
      description: 'Finish, trends, music',
      url: 'https://www.capcut.com/',
    },
    { key: 'reel-studio', name: 'Reel studio', description: 'Code-rendered motion', url: null },
  ],
};
const JOBS = {
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      briefId: BRIEF_ID,
      assetId: null,
      kind: 'cutdown',
      label: 'Cut-down 9:16 · 15 s',
      tool: 'reel-studio',
      status: 'running',
      progress: 62,
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
    },
  ],
  total: 1,
};

function routes(assets: unknown[], brief = makeBrief()) {
  return {
    [`GET /briefs/${BRIEF_ID}`]: () => jsonResponse(brief),
    [`GET /briefs/${BRIEF_ID}/assets`]: () => jsonResponse({ items: assets, total: assets.length }),
    [`GET /briefs/${BRIEF_ID}/render-jobs`]: () => jsonResponse(JOBS),
    'GET /handoff-tools': () => jsonResponse(TOOLS),
    'GET /health': () => jsonResponse(HEALTH),
    [`GET /assets/${makeAsset().id}/url`]: () =>
      jsonResponse({ url: 'https://s3/get/master.mp4', expiresIn: 900 }),
  };
}

function renderStudio(path = `/studio/${BRIEF_ID}`) {
  return renderWithRouter(
    [
      { path: '/studio', element: <StudioPage /> },
      { path: '/studio/:briefId', element: <StudioPage /> },
    ],
    [path],
  );
}

describe('Studio helpers', () => {
  it('needs a ready master of the right kind to send for review', () => {
    const brief = makeBrief();
    expect(canSendForReview(brief, [])).toBe(false);
    expect(canSendForReview(brief, [makeAsset({ status: 'uploading' })])).toBe(false);
    expect(canSendForReview(brief, [makeAsset({ kind: 'poster', mimeType: 'image/png' })])).toBe(
      false,
    );
    expect(canSendForReview(brief, [makeAsset()])).toBe(true);
    expect(canSendForReview(makeBrief({ stage: 'made' }), [makeAsset()])).toBe(false);
    expect(
      pickMaster(
        [makeAsset({ id: 'a', ratio: '4:5' }), makeAsset({ id: 'b', ratio: '9:16' })],
        brief,
        '9:16',
      )?.id,
    ).toBe('b');
  });
});

describe('StudioPage', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
    useUiStore.setState({ selectedProductId: PRODUCT_ID });
  });

  it('shows the studio for a brief with timeline, render jobs and hand-offs', async () => {
    mockFetch(routes([makeAsset()]));
    renderStudio();
    expect(await screen.findByRole('heading', { name: 'Studio · REEL-031' })).toBeInTheDocument();
    expect(await screen.findByText('Scene timeline · 58 s')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Video: Beat 3/ })).toBeInTheDocument();
    expect(await screen.findByText('Running 62%')).toBeInTheDocument();
    expect(await screen.findByText('Not set up')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Figma in a new tab' })).toHaveAttribute(
      'href',
      'https://www.figma.com/',
    );
    expect(await screen.findByRole('link', { name: 'Open in CapCut' })).toHaveAttribute(
      'href',
      'https://www.capcut.com/',
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send for review' })).toBeEnabled(),
    );
  });

  it('keeps Send for review disabled without a ready master', async () => {
    mockFetch(routes([makeAsset({ status: 'uploading' })]));
    renderStudio();
    const btn = await screen.findByRole('button', { name: 'Send for review' });
    await screen.findByText('Uploading');
    expect(btn).toBeDisabled();
  });

  it('sends for review and shows the stage', async () => {
    const fetchSpy = mockFetch({
      ...routes([makeAsset()]),
      [`POST /briefs/${BRIEF_ID}/send-for-review`]: () =>
        jsonResponse(makeBrief({ stage: 'made' })),
    });
    renderStudio();
    const btn = await screen.findByRole('button', { name: 'Send for review' });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect((await screen.findAllByText('Sent for review')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('link', { name: 'Open review' })).toHaveAttribute(
      'href',
      `/review/${BRIEF_ID}`,
    );
    const call = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ version: 1 });
  });

  it('switches the preview ratio', async () => {
    mockFetch(routes([makeAsset()]));
    renderStudio();
    const four = await screen.findByRole('radio', { name: '4:5' });
    await userEvent.click(four);
    expect(four).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('region', { name: 'Preview, ratio 4:5' })).toBeInTheDocument();
  });

  it('shows Storage not connected when storage is off', async () => {
    mockFetch({
      ...routes([]),
      'GET /health': () =>
        jsonResponse({ ...HEALTH, features: { ...HEALTH.features, storage: false } }),
    });
    renderStudio();
    expect(await screen.findByText('Storage not connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload master' })).not.toBeInTheDocument();
  });

  it('lists briefs ready to make on /studio', async () => {
    const fetchSpy = mockFetch({
      'GET /products': () =>
        jsonResponse({
          items: [
            {
              id: PRODUCT_ID,
              name: 'Humini Live',
              slug: 'live',
              status: 'in_build',
              color: '#ff9a00',
            },
          ],
          total: 1,
        }),
      'GET /briefs': () => jsonResponse({ items: [makeBrief()], total: 1 }),
    });
    const { router } = renderStudio('/studio');
    expect(await screen.findByText('REEL-031')).toBeInTheDocument();
    const url = fetchSpy.mock.calls.map(([u]) => String(u)).find((u) => u.includes('/briefs?'));
    expect(url).toContain('stage=frozen%2Cmade');
    await userEvent.click(screen.getByText('60 seconds with Elan, ep. 1'));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/studio/${BRIEF_ID}`));
  });

  it('explains how to get a brief into the picker when none is ready', async () => {
    mockFetch({
      'GET /products': () =>
        jsonResponse({
          items: [
            {
              id: PRODUCT_ID,
              name: 'Humini Live',
              slug: 'live',
              status: 'in_build',
              color: '#ff9a00',
            },
          ],
          total: 1,
        }),
      'GET /briefs': () => jsonResponse({ items: [], total: 0 }),
    });
    renderStudio('/studio');
    expect(await screen.findByText('Nothing to make yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open briefs' })).toHaveAttribute('href', '/briefs');
  });
});
