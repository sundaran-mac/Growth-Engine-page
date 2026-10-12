import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Brief, ClaimFlag } from '@growth-desk/contract';
import BriefPage from '@/pages/BriefPage';
import BriefsPage from '@/pages/BriefsPage';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import {
  createTestQueryClient,
  jsonResponse,
  ME,
  mockFetch,
  renderWithProviders,
  renderWithRouter,
} from '@/test/utils';
import { makeKeys } from '../api';
import { ClaimCheckPanel } from './ClaimCheckPanel';
import { draftSummary, patchForDraft } from './use-cowriter';
import { editableFromBrief, useBriefAutosave } from './use-brief-autosave';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const BRIEF_ID = '22222222-2222-4222-8222-222222222222';

function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    id: BRIEF_ID,
    code: 'REEL-031',
    kind: 'reel',
    productId: PRODUCT_ID,
    ideaId: null,
    title: '60 seconds with Elan, ep. 1',
    mode: 'M1',
    stage: 'brief',
    hook: 'You are not a bad friend.',
    beats: ['Beat one.', 'Beat two.'],
    ask: 'Send one byte.',
    ratios: ['9:16', '4:5'],
    captionLanguages: ['en', 'ta'],
    channels: ['instagram', 'youtube', 'linkedin'],
    owner: { id: '33333333-3333-4333-8333-333333333333', name: 'Jeeva Santiago', initials: 'JS' },
    claimsApprover: null,
    brandApprover: { id: '44444444-4444-4444-8444-444444444444', name: 'Elan', initials: 'E' },
    version: 3,
    claimFlags: [
      { rule: 'never_say', status: 'pass', message: 'No never-say words', suggestion: null },
    ],
    claims: [],
    claudeSuggestions: { captions: [], altHooks: [], bRoll: [], generatedAt: null },
    frozenAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    ...overrides,
  };
}

const PRODUCTS = {
  items: [
    {
      id: PRODUCT_ID,
      name: 'Humini Live',
      slug: 'humini-live',
      status: 'in_build',
      color: '#ff9a00',
    },
  ],
  total: 1,
};

function hookWrapper(brief: Brief) {
  const client = createTestQueryClient();
  client.setQueryData(makeKeys.brief(brief.id), brief);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useBriefAutosave', () => {
  it('sends one PATCH with version and updatedAt after the pause', async () => {
    const brief = makeBrief();
    const bodies: unknown[] = [];
    mockFetch({
      [`PATCH /briefs/${BRIEF_ID}`]: (init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        return jsonResponse({ ...brief, hook: body.hook, updatedAt: '2026-10-10T10:00:05.000Z' });
      },
    });
    const { wrapper, client } = hookWrapper(brief);
    const { result } = renderHook(() => useBriefAutosave(brief, { delay: 30 }), { wrapper });

    act(() => result.current.update({ hook: 'New' }));
    act(() => result.current.update({ hook: 'New hook' }));
    expect(result.current.values.hook).toBe('New hook');
    expect(result.current.status).toBe('dirty');

    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(bodies).toEqual([
      { version: 3, updatedAt: '2026-10-10T10:00:00.000Z', hook: 'New hook' },
    ]);
    expect(client.getQueryData<Brief>(makeKeys.brief(BRIEF_ID))?.updatedAt).toBe(
      '2026-10-10T10:00:05.000Z',
    );
  });

  it('stops and reports a conflict on 409 VERSION_CONFLICT', async () => {
    const brief = makeBrief();
    let calls = 0;
    mockFetch({
      [`PATCH /briefs/${BRIEF_ID}`]: () => {
        calls += 1;
        return jsonResponse(
          {
            type: 'x',
            title: 'Conflict',
            status: 409,
            code: 'VERSION_CONFLICT',
            detail: 'Changed by someone else.',
          },
          409,
          'application/problem+json',
        );
      },
    });
    const { wrapper } = hookWrapper(brief);
    const { result } = renderHook(() => useBriefAutosave(brief, { delay: 10 }), { wrapper });

    act(() => result.current.update({ ask: 'Mine' }));
    await waitFor(() => expect(result.current.status).toBe('conflict'));
    expect(result.current.values.ask).toBe('Mine');
    expect(result.current.hasUnsaved).toBe(true);

    act(() => result.current.update({ ask: 'Mine again' }));
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
  });

  it('does nothing when disabled (frozen brief)', () => {
    const brief = makeBrief({ stage: 'frozen' });
    const { wrapper } = hookWrapper(brief);
    const { result } = renderHook(() => useBriefAutosave(brief, { enabled: false }), { wrapper });
    act(() => result.current.update({ hook: 'x' }));
    expect(result.current.values).toEqual(editableFromBrief(brief));
    expect(result.current.status).toBe('idle');
  });
});

describe('ClaimCheckPanel', () => {
  it('renders pass, warn and fail rows with suggestions', () => {
    const flags: ClaimFlag[] = [
      { rule: 'never_say', status: 'pass', message: 'No never-say words', suggestion: null },
      {
        rule: 'spec_cited',
        status: 'warn',
        message: 'A behaviour has no spec.',
        suggestion: 'Cite spec 006',
      },
      {
        rule: 'never_say',
        status: 'fail',
        message: '"anonymous" is on the never-say list.',
        suggestion: null,
      },
    ];
    renderWithProviders(<ClaimCheckPanel flags={flags} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('data-status'))).toEqual(['pass', 'warn', 'fail']);
    expect(screen.getByText(/Suggest: Cite spec 006/)).toBeInTheDocument();
    expect(within(items[2]!).getByRole('img', { name: 'Blocks freeze' })).toBeInTheDocument();
  });
});

describe('co-writer helpers', () => {
  it('summarises drafts like the Figma panel', () => {
    expect(
      draftSummary([
        { id: '1', kind: 'tamil_caption', text: 'x', language: 'ta' },
        { id: '2', kind: 'alt_hooks', text: 'a', language: null },
        { id: '3', kind: 'alt_hooks', text: 'b', language: null },
        { id: '4', kind: 'broll', text: 'phone clock', language: null },
        { id: '5', kind: 'broll', text: 'two timezones', language: null },
      ]),
    ).toBe('Tamil caption drafted · 2 alternative hooks · B-roll list: phone clock, two timezones');
  });

  it('accepting a Tamil caption replaces only the Tamil entry', () => {
    const values = editableFromBrief(
      makeBrief({
        claudeSuggestions: {
          captions: [
            { language: 'en', text: 'EN' },
            { language: 'ta', text: 'old' },
          ],
          altHooks: [],
          bRoll: ['a'],
          generatedAt: null,
        },
      }),
    );
    const patch = patchForDraft(values, {
      id: '1',
      kind: 'tamil_caption',
      text: 'new',
      language: 'ta',
    });
    expect(patch.claudeSuggestions?.captions).toEqual([
      { language: 'en', text: 'EN' },
      { language: 'ta', text: 'new' },
    ]);
    expect(patchForDraft(values, { id: '2', kind: 'broll', text: 'a', language: null })).toEqual(
      {},
    );
    expect(
      patchForDraft(values, { id: '3', kind: 'alt_hooks', text: 'Hook B', language: null }),
    ).toEqual({ hook: 'Hook B' });
  });
});

describe('BriefsPage', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
    useUiStore.setState({ selectedProductId: PRODUCT_ID });
  });

  it('lists briefs for the selected product and opens one', async () => {
    const fetchSpy = mockFetch({
      'GET /products': () => jsonResponse(PRODUCTS),
      'GET /briefs': () => jsonResponse({ items: [makeBrief()], total: 1 }),
    });
    const { router } = renderWithRouter(
      [
        { path: '/briefs', element: <BriefsPage /> },
        { path: '/briefs/:briefId', element: <p>Detail page</p> },
      ],
      ['/briefs'],
    );
    const row = await screen.findByRole('row', { name: /REEL-031/ });
    expect(within(row).getByText('Brief')).toBeInTheDocument();
    expect(within(row).getByText('M1 Founder')).toBeInTheDocument();
    const briefCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/briefs?'));
    expect(String(briefCall?.[0])).toContain(`productId=${PRODUCT_ID}`);

    await userEvent.click(row);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/briefs/${BRIEF_ID}`));
  });

  it('shows the empty message when there are no briefs', async () => {
    mockFetch({
      'GET /products': () => jsonResponse(PRODUCTS),
      'GET /briefs': () => jsonResponse({ items: [], total: 0 }),
    });
    renderWithRouter([{ path: '/briefs', element: <BriefsPage /> }], ['/briefs']);
    expect(await screen.findByText(/No briefs yet/)).toBeInTheDocument();
  });
});

describe('BriefPage', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
    useUiStore.setState({ selectedProductId: PRODUCT_ID });
  });

  function renderBrief(brief: Brief) {
    mockFetch({
      'GET /products': () => jsonResponse(PRODUCTS),
      [`GET /briefs/${BRIEF_ID}`]: () => jsonResponse(brief),
      [`GET /briefs/${BRIEF_ID}/options`]: () =>
        jsonResponse({ owners: [], claimsApprovers: [], brandApprovers: [] }),
      'GET /health': () =>
        jsonResponse({
          features: {
            claude: false,
            storage: true,
            meta: false,
            google: false,
            linkedin: false,
            github: false,
            smtp: false,
          },
        }),
    });
    return renderWithRouter(
      [{ path: '/briefs/:briefId', element: <BriefPage /> }],
      [`/briefs/${BRIEF_ID}`],
    );
  }

  it('shows the Figma layout and disables Freeze while a red flag is open', async () => {
    renderBrief(
      makeBrief({
        claimFlags: [
          {
            rule: 'never_say',
            status: 'fail',
            message: '"anonymous" is on the never-say list.',
            suggestion: null,
          },
        ],
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'REEL-031 · 60 seconds with Elan, ep. 1' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Brief · Humini Live · M1 Founder film · owner: Jeeva'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Freeze brief' })).toBeDisabled();
    expect(screen.getByText('Fix the red flags in the claim check first.')).toBeInTheDocument();
    expect(screen.getByText('9:16 · 4:5')).toBeInTheDocument();
    expect(screen.getByText('English · Tamil')).toBeInTheDocument();
    expect(screen.getByText('IG · YT · LinkedIn')).toBeInTheDocument();
    expect(await screen.findByText(/Claude is not connected/)).toBeInTheDocument();
    const tracker = screen.getByRole('list', { name: 'Brief stage' });
    expect(within(tracker).getByText('Brief').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('enables Freeze when the check passes and makes a frozen brief read only', async () => {
    const { unmount } = renderBrief(makeBrief());
    expect(await screen.findByRole('button', { name: 'Freeze brief' })).toBeEnabled();
    expect(screen.getByLabelText('Hook (0-2 s)')).not.toHaveAttribute('readonly');
    unmount();

    renderBrief(makeBrief({ stage: 'frozen' }));
    expect(await screen.findByRole('button', { name: 'Unfreeze' })).toBeInTheDocument();
    expect(screen.getByLabelText('Hook (0-2 s)')).toHaveAttribute('readonly');
  });

  it('shows not found for an unknown brief', async () => {
    mockFetch({ 'GET /products': () => jsonResponse(PRODUCTS) });
    renderWithRouter(
      [{ path: '/briefs/:briefId', element: <BriefPage /> }],
      [`/briefs/${BRIEF_ID}`],
    );
    expect(await screen.findByText('Brief not found')).toBeInTheDocument();
  });
});
