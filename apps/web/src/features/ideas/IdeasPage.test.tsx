import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Idea, IdeaBoardInfo } from '@growth-desk/contract';
import IdeasPage from '@/pages/IdeasPage';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { jsonResponse, ME, mockFetch, renderWithRouter } from '@/test/utils';

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const PRODUCTS = { items: [{ id: PRODUCT_ID, name: 'Humini Live', slug: 'live', status: 'in_build', color: '#ff9a00' }], total: 1 };

function idea(over: Partial<Idea>): Idea {
  return {
    id: crypto.randomUUID(),
    productId: PRODUCT_ID,
    title: 'Idea',
    summary: null,
    mode: 'M1',
    channels: ['instagram'],
    fitScore: 80,
    status: 'new',
    source: 'claude',
    note: null,
    angle: null,
    briefId: null,
    briefCode: null,
    createdBy: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...over,
  };
}

const IDEAS = [
  idea({ title: 'Elan reads your group chat', mode: 'M1', fitScore: 86 }),
  idea({ title: 'Rating the family group', mode: 'M5', fitScore: 78 }),
  idea({ title: 'Their clock, not yours', mode: 'M3', fitScore: 91, status: 'starred', angle: 'parents abroad / call at their time / time zone swap' }),
  idea({ title: '60 seconds with Elan, ep. 1', status: 'briefed', briefId: crypto.randomUUID(), briefCode: 'REEL-031' }),
  idea({ title: 'The influencer who could not', mode: 'M5', status: 'parked', note: 'Needs a new cast' }),
];

const BOARD_OFF: IdeaBoardInfo = { claude: { enabled: false, usedTokens: 0, capTokens: 2_000_000 }, weeklyProposal: null };
const BOARD_ON: IdeaBoardInfo = { claude: { enabled: true, usedTokens: 1000, capTokens: 2_000_000 }, weeklyProposal: null };

function setup(board: IdeaBoardInfo, extra: Parameters<typeof mockFetch>[0] = {}) {
  useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
  useUiStore.setState({ selectedProductId: PRODUCT_ID });
  const fetchSpy = mockFetch({
    'GET /products': () => jsonResponse(PRODUCTS),
    'GET /ideas': () => jsonResponse({ items: IDEAS, total: IDEAS.length }),
    'GET /ideas/board': () => jsonResponse(board),
    ...extra,
  });
  const utils = renderWithRouter([{ path: '/ideas', element: <IdeasPage /> }], ['/ideas']);
  return { ...utils, fetchSpy };
}

describe('IdeasPage', () => {
  beforeEach(() => {
    useUiStore.setState({ selectedProductId: null });
  });

  it('shows the four columns with counts, fit scores, brief code and park reason', async () => {
    setup(BOARD_ON);
    const newCol = await screen.findByRole('region', { name: 'New from Claude, 2' });
    expect(within(newCol).getByText('Elan reads your group chat')).toBeInTheDocument();
    expect(within(newCol).getByText('Fit 86')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Starred, 1' })).toBeInTheDocument();
    const briefed = screen.getByRole('region', { name: 'Briefed, 1' });
    expect(within(briefed).getByText('REEL-031')).toBeInTheDocument();
    expect(within(briefed).getByRole('link', { name: '60 seconds with Elan, ep. 1' })).toHaveAttribute('href', expect.stringMatching(/^\/briefs\//));
    expect(within(screen.getByRole('region', { name: 'Parked, 1' })).getByText('Needs a new cast')).toBeInTheDocument();
  });

  it('filters by mode', async () => {
    setup(BOARD_ON);
    await screen.findByText('Elan reads your group chat');
    await userEvent.click(screen.getByRole('button', { name: 'M5 Fun' }));
    expect(screen.getByRole('button', { name: 'M5 Fun' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Elan reads your group chat')).not.toBeInTheDocument();
    expect(screen.getByText('Rating the family group')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'New from Claude, 1' })).toBeInTheDocument();
  });

  it('shows "Claude not connected" with a link to Integrations and blocks generate', async () => {
    setup(BOARD_OFF);
    expect(await screen.findByText('Claude not connected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Integrations' })).toHaveAttribute('href', '/integrations');
    expect(screen.getByRole('button', { name: 'Generate 10 ideas' })).toBeDisabled();
  });

  it('switches to the not connected state when the API answers FEATURE_DISABLED', async () => {
    const { fetchSpy } = setup(BOARD_ON, {
      'POST /ideas/generate': () =>
        jsonResponse(
          { type: 'x', title: 'Claude is not set up', status: 503, code: 'FEATURE_DISABLED', detail: 'No key.' },
          503,
          'application/problem+json',
        ),
    });
    const button = await screen.findByRole('button', { name: 'Generate 10 ideas' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText('Claude not connected')).toBeInTheDocument();
    const call = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      productId: PRODUCT_ID,
      mode: null,
      channels: ['instagram', 'youtube'],
      count: 10,
    });
  });

  it('shows the weekly proposal banner with the pull request link', async () => {
    setup({
      ...BOARD_ON,
      weeklyProposal: {
        runId: crypto.randomUUID(),
        weekStart: '2026-10-12',
        ideasCreated: 6,
        githubPrUrl: 'https://github.com/humini-ecosystem/humini-live/pull/42',
        finishedAt: '2026-10-12T02:00:00.000Z',
      },
    });
    expect(await screen.findByText('Weekly proposal')).toBeInTheDocument();
    expect(screen.getByText(/drafted 6 new ideas/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open the pull request/ })).toHaveAttribute(
      'href',
      'https://github.com/humini-ecosystem/humini-live/pull/42',
    );
  });

  it('hides write actions from a viewer', async () => {
    useSessionStore.setState({ user: { ...ME.user, role: 'viewer' }, memberships: [], status: 'signedIn' });
    useUiStore.setState({ selectedProductId: PRODUCT_ID });
    mockFetch({
      'GET /products': () => jsonResponse(PRODUCTS),
      'GET /ideas': () => jsonResponse({ items: IDEAS, total: IDEAS.length }),
      'GET /ideas/board': () => jsonResponse(BOARD_ON),
    });
    renderWithRouter([{ path: '/ideas', element: <IdeasPage /> }], ['/ideas']);
    await screen.findByText('Elan reads your group chat');
    expect(screen.queryByRole('button', { name: 'New idea' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.getByText(/You can see ideas but not generate them/)).toBeInTheDocument();
  });
});
