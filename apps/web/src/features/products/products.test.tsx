import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  IntegrationsStatusResponse,
  ProductKitView,
  ProductSummary,
  TeamListResponse,
} from '@growth-desk/contract';
import IntegrationsPage from '@/pages/IntegrationsPage';
import ProductKitPage from '@/pages/ProductKitPage';
import ProductsPage from '@/pages/ProductsPage';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { jsonResponse, ME, mockFetch, renderWithRouter } from '@/test/utils';
import { kitLine, productStatusText, slugify, thisMonthText } from './format';

const NOW = '2026-10-12T10:00:00.000Z';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const OWNER = { id: '00000000-0000-4000-8000-0000000000e1', name: 'Elan', initials: 'E' };

function product(over: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: P1,
    slug: 'humini-live',
    name: 'Humini Live',
    shortName: 'Live',
    status: 'in_build',
    statusNote: 'v2',
    color: '#ff9a00',
    repoUrl: null,
    siteUrl: null,
    owner: OWNER,
    backup: null,
    createdAt: NOW,
    updatedAt: NOW,
    kit: {
      version: 1,
      score: 9,
      promise: 'Be there for your people, in Joy and Care.',
      signedBy: OWNER,
      signedAt: '2026-10-08T04:30:00.000Z',
    },
    stats: { piecesThisMonth: 36, installsThisMonth: 214 },
    platforms: ['instagram', 'youtube'],
    ...over,
  };
}

const problem = (status: number, code: string, detail?: string) =>
  jsonResponse(
    { type: 'x', title: 'Not set up', status, code, detail },
    status,
    'application/problem+json',
  );

const team: TeamListResponse = { items: [], total: 0 };

describe('format helpers', () => {
  it('builds the card lines from the Figma', () => {
    expect(productStatusText('in_build', 'v2')).toBe('IN BUILD · v2');
    expect(productStatusText('draft', null)).toBe('DRAFT');
    expect(kitLine(product())).toBe('Kit 9/10 · signed 8 Oct');
    expect(
      kitLine(
        product({
          status: 'live',
          owner: null,
          kit: { version: 1, score: 6, promise: null, signedBy: null, signedAt: null },
        }),
      ),
    ).toBe('Kit 6/10 · owner to confirm');
    expect(thisMonthText(product())).toBe('36 pieces · 214 installs');
    expect(
      thisMonthText(
        product({ status: 'draft', stats: { piecesThisMonth: 0, installsThisMonth: 0 } }),
      ),
    ).toBe('Not in market');
    expect(slugify('Humini Send!')).toBe('humini-send');
  });
});

describe('Products screen', () => {
  beforeEach(() => useSessionStore.setState({ ...ME, status: 'signedIn' }));

  it('shows a card per product and links to its kit', async () => {
    mockFetch({
      'GET /products': () =>
        jsonResponse({
          items: [
            product(),
            product({
              id: '00000000-0000-4000-8000-0000000000a2',
              name: 'Humini Proof',
              status: 'draft',
              statusNote: null,
              owner: null,
              kit: { version: 1, score: 2, promise: null, signedBy: null, signedAt: null },
              stats: { piecesThisMonth: 0, installsThisMonth: 0 },
              platforms: [],
            }),
          ],
          total: 2,
        }),
    });
    renderWithRouter([{ path: '/products', element: <ProductsPage /> }], ['/products']);
    const live = await screen.findByRole('article', { name: 'Humini Live' });
    expect(within(live).getByText('IN BUILD · v2')).toBeInTheDocument();
    expect(within(live).getByText('Kit 9/10 · signed 8 Oct')).toBeInTheDocument();
    expect(within(live).getByRole('progressbar', { name: 'Kit completeness' })).toHaveAttribute(
      'aria-valuenow',
      '9',
    );
    expect(within(live).getByRole('link', { name: 'Open product kit →' })).toHaveAttribute(
      'href',
      `/products/${P1}/kit`,
    );
    const proof = screen.getByRole('article', { name: 'Humini Proof' });
    expect(within(proof).getByText('To confirm')).toBeInTheDocument();
    expect(within(proof).getByText('Not in market')).toBeInTheDocument();
    // Editors can add.
    expect(screen.getByRole('button', { name: /Add product/ })).toBeInTheDocument();
  });

  it('shows an error with retry when the list fails', async () => {
    mockFetch({ 'GET /products': () => problem(500, 'INTERNAL_ERROR') });
    renderWithRouter([{ path: '/products', element: <ProductsPage /> }], ['/products']);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Product kit screen', () => {
  const kit: ProductKitView = {
    id: '00000000-0000-4000-8000-0000000000k1',
    productId: P1,
    version: 2,
    promise: 'Be there for your people, in Joy and Care.',
    behaviours: [{ text: 'A heart: the owner sees how many, never who', specRef: '006' }],
    neverSay: ['anonymous', 'strangers'],
    notBuilt: [],
    audiences: ['Elders'],
    activationEvent: 'A circle’s first moment gets a response',
    truthSources: ['live.humini.app'],
    score: 7,
    signedBy: null,
    signedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    status: 'draft',
    fields: [],
    owner: OWNER,
    backup: null,
    canSign: true,
    canEdit: true,
    lastRefresh: null,
  };

  beforeEach(() => useSessionStore.setState({ ...ME, status: 'signedIn' }));

  it('shows the kit and lets the owner sign it', async () => {
    let signed = false;
    mockFetch({
      [`GET /products/${P1}/kit`]: () =>
        jsonResponse(signed ? { ...kit, status: 'signed', signedBy: OWNER, signedAt: NOW } : kit),
      [`GET /products/${P1}`]: () => jsonResponse({ ...product(), members: [] }),
      [`POST /products/${P1}/kit/sign`]: () => {
        signed = true;
        return jsonResponse({ ...kit, status: 'signed', signedBy: OWNER, signedAt: NOW });
      },
    });
    useUiStore.setState({ selectedProductId: null });
    const { router } = renderWithRouter(
      [
        { path: '/products/:productId/kit', element: <ProductKitPage /> },
        { path: '/ideas', element: <p>Ideas board</p> },
      ],
      [`/products/${P1}/kit`],
    );
    expect(
      await screen.findByText('Be there for your people, in Joy and Care.'),
    ).toBeInTheDocument();
    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expect(screen.getByText('spec 006')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Humini Live · product kit' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign kit' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign kit' }));
    expect(await screen.findByText('Signed · v2')).toBeInTheDocument();
    // The toast and the header both offer the next step.
    expect(await screen.findAllByRole('button', { name: 'Go to ideas' })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Go to ideas' })[0]!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/ideas'));
    expect(useUiStore.getState().selectedProductId).toBe(P1);
  });

  it('shows "GitHub not connected" when refresh is off', async () => {
    mockFetch({
      [`GET /products/${P1}/kit`]: () => jsonResponse(kit),
      [`GET /products/${P1}`]: () => jsonResponse({ ...product(), members: [] }),
      [`POST /products/${P1}/kit/refresh`]: () =>
        problem(503, 'FEATURE_DISABLED', 'GitHub is not connected. Set GITHUB_TOKEN.'),
    });
    renderWithRouter(
      [{ path: '/products/:productId/kit', element: <ProductKitPage /> }],
      [`/products/${P1}/kit`],
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh from repo' }));
    expect(
      await screen.findByRole('heading', { name: 'GitHub not connected' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Integrations' })).toHaveAttribute(
      'href',
      '/integrations',
    );
  });
});

describe('Integrations screen', () => {
  const status: IntegrationsStatusResponse = {
    channels: [
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        platform: 'instagram',
        displayName: 'Instagram',
        description: 'Publish, insights, comments',
        handle: '@humini.live',
        status: 'disconnected',
        hasToken: false,
        allowedActions: [],
        expiresAt: null,
        lastError: null,
        connectedAt: null,
        oauthConfigured: false,
        canConnect: true,
      },
      {
        id: null,
        platform: 'whatsapp',
        displayName: 'WhatsApp',
        description: 'Channel by hand',
        handle: null,
        status: 'manual',
        hasToken: false,
        allowedActions: [],
        expiresAt: null,
        lastError: null,
        connectedAt: null,
        oauthConfigured: false,
        canConnect: false,
      },
    ],
    tools: [
      {
        key: 'claude',
        name: 'Claude',
        description: 'Ideas, briefs, captions, notes',
        status: 'not_set_up',
        detail: 'Set ANTHROPIC_API_KEY.',
      },
    ],
  };

  beforeEach(() =>
    useSessionStore.setState({
      user: { ...ME.user, role: 'admin' },
      memberships: [],
      status: 'signedIn',
    }),
  );

  it('shows the real state and the server message when connect is not set up', async () => {
    const fetchSpy = mockFetch({
      'GET /integrations/status': () => jsonResponse(status),
      'GET /users': () => jsonResponse(team),
      'GET /integrations/oauth/meta/start': () =>
        problem(
          503,
          'FEATURE_DISABLED',
          'Meta (Instagram and Facebook) is turned off because its keys are not set.',
        ),
    });
    renderWithRouter([{ path: '/integrations', element: <IntegrationsPage /> }], ['/integrations']);
    const list = await screen.findByRole('list', { name: 'Integrations' });
    expect(within(list).getByText('Not connected')).toBeInTheDocument();
    expect(within(list).getByText('Manual')).toBeInTheDocument();
    expect(within(list).getByText('Not set up')).toBeInTheDocument();
    expect(
      within(list).getByText(
        'Not set up: add the Meta (Instagram and Facebook) app keys in .env.',
      ),
    ).toBeInTheDocument();
    // WhatsApp has no connect button.
    expect(within(list).getAllByRole('button', { name: 'Connect' })).toHaveLength(1);

    await userEvent.click(within(list).getByRole('button', { name: 'Connect' }));
    expect(
      await screen.findByText(
        'Meta (Instagram and Facebook) is turned off because its keys are not set.',
      ),
    ).toBeInTheDocument();
    // Instagram connects through the Meta provider (the API accepts meta, google, linkedin).
    const calls = fetchSpy.mock.calls.map(([u]) => new URL(String(u), 'http://x').pathname);
    expect(calls).toContain('/api/v1/integrations/oauth/meta/start');
    expect(calls.some((p) => p.includes('/oauth/instagram/'))).toBe(false);
    expect(await screen.findByRole('heading', { name: 'Team and roles' })).toBeInTheDocument();
  });

  it('shows Connect to editors too, but not to members', async () => {
    mockFetch({
      'GET /integrations/status': () => jsonResponse(status),
      'GET /users': () => jsonResponse(team),
    });
    useSessionStore.setState({ user: { ...ME.user, role: 'editor' } });
    const first = renderWithRouter(
      [{ path: '/integrations', element: <IntegrationsPage /> }],
      ['/integrations'],
    );
    let list = await screen.findByRole('list', { name: 'Integrations' });
    expect(within(list).getAllByRole('button', { name: 'Connect' })).toHaveLength(1);
    first.unmount();

    useSessionStore.setState({ user: { ...ME.user, role: 'member' } });
    renderWithRouter([{ path: '/integrations', element: <IntegrationsPage /> }], ['/integrations']);
    list = await screen.findByRole('list', { name: 'Integrations' });
    expect(within(list).queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('toasts the OAuth result from the query string and clears it', async () => {
    mockFetch({
      'GET /integrations/status': () => jsonResponse(status),
      'GET /users': () => jsonResponse(team),
    });
    const ok = renderWithRouter(
      [{ path: '/integrations', element: <IntegrationsPage /> }],
      ['/integrations?connected=meta'],
    );
    expect(await screen.findByText('meta connected')).toBeInTheDocument();
    await waitFor(() => expect(ok.router.state.location.search).toBe(''));
    ok.unmount();

    const bad = renderWithRouter(
      [{ path: '/integrations', element: <IntegrationsPage /> }],
      ['/integrations?error=OAUTH_DENIED&message=Permission%20was%20not%20given.'],
    );
    expect(await screen.findByText('Could not connect')).toBeInTheDocument();
    expect(await screen.findByText('Permission was not given.')).toBeInTheDocument();
    await waitFor(() => expect(bad.router.state.location.search).toBe(''));
  });

  it('disconnects through the shared PUBLISH hook after a confirm', async () => {
    const connected = {
      ...status,
      channels: [
        { ...status.channels[0]!, status: 'connected' as const, hasToken: true, oauthConfigured: true },
      ],
    };
    const fetchSpy = mockFetch({
      'GET /integrations/status': () => jsonResponse(connected),
      'GET /users': () => jsonResponse(team),
      'DELETE /channel-accounts/00000000-0000-4000-8000-0000000000c1': () =>
        new Response(null, { status: 204 }),
    });
    renderWithRouter([{ path: '/integrations', element: <IntegrationsPage /> }], ['/integrations']);
    const list = await screen.findByRole('list', { name: 'Integrations' });
    expect(within(list).getByText('@humini.live')).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Instagram disconnected')).toBeInTheDocument();
    expect(
      fetchSpy.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(true);
  });
});
