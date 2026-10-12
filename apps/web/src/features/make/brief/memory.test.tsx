import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Brief, MemoryMatch } from '@growth-desk/contract';
import BriefPage from '@/pages/BriefPage';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { jsonResponse, ME, mockFetch, renderWithProviders, renderWithRouter } from '@/test/utils';
import { NewBriefDialog } from './NewBriefDialog';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const BRIEF_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRIEF = '55555555-5555-4555-8555-555555555555';

const MATCH: MemoryMatch = {
  id: '66666666-6666-4666-8666-666666666666',
  sourceType: 'brief_hook',
  sourceId: OTHER_BRIEF,
  productId: PRODUCT_ID,
  productName: 'Humini Pulse',
  title: 'Sunday call',
  body: 'Mum calls at six',
  score: 0.71,
  layer: 'text',
  level: 'duplicate',
  createdAt: '2026-09-20T09:00:00.000Z',
};

const BRIEF: Brief = {
  id: BRIEF_ID,
  code: 'REEL-031',
  kind: 'reel',
  productId: PRODUCT_ID,
  ideaId: null,
  title: 'Office pulse check',
  mode: 'M1',
  stage: 'brief',
  hook: 'Mum calls at six!',
  beats: ['Beat one.'],
  ask: null,
  ratios: ['9:16'],
  captionLanguages: ['en'],
  channels: ['instagram'],
  owner: null,
  claimsApprover: null,
  brandApprover: null,
  version: 1,
  claimFlags: [],
  claims: [],
  claudeSuggestions: { captions: [], altHooks: [], bRoll: [], generatedAt: null },
  frozenAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
};

const PRODUCTS = {
  items: [
    { id: PRODUCT_ID, name: 'Humini Live', slug: 'live', status: 'in_build', color: '#ff9a00' },
  ],
  total: 1,
};

describe('content memory in MAKE', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
    useUiStore.setState({ selectedProductId: PRODUCT_ID });
  });

  it('warns under the hook when it repeats another brief, with a link to it', async () => {
    const checks: Record<string, unknown>[] = [];
    mockFetch({
      'GET /products': () => jsonResponse(PRODUCTS),
      [`GET /briefs/${BRIEF_ID}`]: () => jsonResponse(BRIEF),
      [`GET /briefs/${BRIEF_ID}/options`]: () =>
        jsonResponse({ owners: [], claimsApprovers: [], brandApprovers: [] }),
      'POST /memory/check': (init) => {
        checks.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ status: 'duplicate', matches: [MATCH] });
      },
    });
    renderWithRouter(
      [{ path: '/briefs/:briefId', element: <BriefPage /> }],
      [`/briefs/${BRIEF_ID}`],
    );
    expect(
      await screen.findByText(/not saved until you change it/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sunday call/ })).toHaveAttribute(
      'href',
      `/briefs/${OTHER_BRIEF}`,
    );
    expect(checks[0]).toMatchObject({
      kind: 'brief_hook',
      title: 'Office pulse check',
      body: 'Mum calls at six!',
      excludeBriefId: BRIEF_ID,
    });
  });

  it('new brief: shows the similar piece and asks for a reason', async () => {
    const bodies: Record<string, unknown>[] = [];
    mockFetch({
      'POST /briefs': (init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        if (!body.similarReason) {
          return jsonResponse(
            { type: 'x', title: 'Close', status: 409, code: 'IDEA_SIMILAR', detail: 'Close.' },
            409,
            'application/problem+json',
          );
        }
        return jsonResponse({ ...BRIEF, title: body.title }, 201);
      },
      'POST /memory/check': () =>
        jsonResponse({
          status: 'similar',
          matches: [{ ...MATCH, sourceType: 'idea', level: 'similar', score: 0.45 }],
        }),
    });
    renderWithProviders(<NewBriefDialog open onOpenChange={() => {}} productId={PRODUCT_ID} />);
    await userEvent.type(screen.getByLabelText(/Title/), 'Sunday calls');
    await userEvent.click(screen.getByRole('button', { name: 'Create brief' }));
    expect(await screen.findByText('Close to an earlier brief')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Use anyway, because/), 'Mum leads, not the kids');
    await userEvent.click(screen.getByRole('button', { name: 'Create anyway' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({
      title: 'Sunday calls',
      similarReason: 'Mum leads, not the kids',
    });
  });
});
