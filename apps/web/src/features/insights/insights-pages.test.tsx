import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnalyticsByChannel,
  AnalyticsByMode,
  AnalyticsPostsResponse,
  AnalyticsSummary,
  DashboardResponse,
  LeadListResponse,
  LeadView,
  Product,
} from '@growth-desk/contract';
import AnalyticsPage from '@/pages/AnalyticsPage';
import HomePage from '@/pages/HomePage';
import SalesPage from '@/pages/SalesPage';
import { useSessionStore } from '@/stores/session';
import { ME, jsonResponse, mockFetch, renderWithProviders } from '@/test/utils';

const NOW = '2026-10-13T06:00:00.000Z';
const PRODUCT: Product = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'live',
  name: 'Humini Live',
  shortName: 'Live',
  status: 'live',
  statusNote: null,
  color: '#ff9a00',
  repoUrl: null,
  siteUrl: null,
  owner: null,
  backup: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const products = () => jsonResponse({ items: [PRODUCT], total: 1 });

beforeEach(() => {
  useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------- Home ---------- */

const DASHBOARD: DashboardResponse = {
  productId: PRODUCT.id,
  today: '2026-10-13',
  timezone: 'Asia/Kolkata',
  stats: {
    reach7d: { value: 48_200, previous: 43_000, deltaPct: 12 },
    savesShares7d: { value: 1930, previous: 1473, deltaPct: 31 },
    installs7d: { value: 214, previous: 181, deltaPct: 18 },
    openLeads: { value: 9, newThisWeek: 3 },
  },
  needsYou: [
    {
      id: 'approval:1',
      kind: 'approval',
      title: 'Approve claims · REEL-031 “60 seconds with Elan”',
      meta: 'Live · owner approval',
      link: '/approvals',
      since: new Date(Date.now() - 6 * 3_600_000).toISOString(),
    },
    {
      id: 'keyword:1',
      kind: 'keyword_comments',
      title: '6 comments asked for the link',
      meta: 'Instagram · keyword CIRCLE · replies queued',
      link: '/sales?panel=keywords',
      since: null,
    },
  ],
  goingOutToday: [
    {
      postId: '22222222-2222-4222-8222-222222222222',
      briefId: '33333333-3333-4333-8333-333333333333',
      briefCode: 'REEL-029',
      briefKind: 'reel',
      title: 'Their clock, not yours',
      platform: 'instagram',
      scheduledAt: '2026-10-13T14:00:00.000Z',
      audienceTz: 'Asia/Kolkata',
      status: 'scheduled',
      delivery: 'auto',
    },
    {
      postId: '44444444-4444-4444-8444-444444444444',
      briefId: '33333333-3333-4333-8333-333333333333',
      briefCode: 'REEL-029',
      briefKind: 'reel',
      title: 'Their clock, not yours',
      platform: 'whatsapp',
      scheduledAt: '2026-10-13T15:30:00.000Z',
      audienceTz: 'Asia/Kolkata',
      status: 'manual_pending',
      delivery: 'manual',
    },
  ],
  nextPosts: [],
  claudeThisWeek: {
    note: {
      id: '55555555-5555-4555-8555-555555555555',
      productId: null,
      weekStart: '2026-10-12',
      body: '16 new ideas drafted: 10 for Live, 6 for Pulse.',
      doMore: 'Founder films',
      stopDoing: 'Long explainers',
      createdAt: NOW,
    },
    newIdeasThisWeek: 16,
  },
  pipeline: { new: 4, qualified: 0, talking: 3, pilot: 1, review: 0, won: 1, lost: 0 },
  products: [
    {
      id: PRODUCT.id,
      name: 'Humini Live',
      color: '#ff9a00',
      status: 'live',
      piecesThisWeek: 9,
      kitSigned: true,
    },
  ],
};

describe('HomePage', () => {
  it('renders the day at a glance from GET /dashboard', async () => {
    const fetchSpy = mockFetch({
      'GET /products': products,
      'GET /dashboard': () => jsonResponse(DASHBOARD),
    });
    renderWithProviders(<HomePage />);

    expect(await screen.findByText('48.2k')).toBeInTheDocument();
    expect(screen.getByText('+12% vs last week')).toBeInTheDocument();
    expect(screen.getByText(/2 things need you today/)).toBeInTheDocument();
    expect(screen.getByText(/waiting 6 h/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/approvals');
    expect(screen.getByRole('link', { name: 'Open inbox' })).toHaveAttribute(
      'href',
      '/sales?panel=keywords',
    );
    expect(screen.getByText('7:30 pm IST')).toBeInTheDocument();
    expect(screen.getByText('Reminder · post by hand')).toBeInTheDocument();
    expect(screen.getByText('16 new ideas drafted: 10 for Live, 6 for Pulse.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '4 New' })).toBeInTheDocument();
    expect(screen.getByText('9 pieces this week')).toBeInTheDocument();

    const call = fetchSpy.mock.calls.find(([u]) => String(u).includes('/dashboard'));
    expect(String(call?.[0])).toContain(`productId=${PRODUCT.id}`);
  });

  it('shows an error with retry when the dashboard fails', async () => {
    mockFetch({
      'GET /products': products,
      'GET /dashboard': () =>
        jsonResponse(
          { type: 'x', title: 'Not allowed', status: 403, code: 'FORBIDDEN', detail: 'No access' },
          403,
          'application/problem+json',
        ),
    });
    renderWithProviders(<HomePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No access');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

/* ---------- Analytics ---------- */

const range = { days: 28, from: '2026-09-16', to: '2026-10-13' };
const zero = {
  reach: 0,
  saves: 0,
  shares: 0,
  comments: 0,
  clicks: 0,
  installs: 0,
  activations: 0,
  valueScore: 0,
};

describe('AnalyticsPage', () => {
  it('shows tiles, channels, modes and the sample label', async () => {
    const summary: AnalyticsSummary = {
      range,
      totals: {
        ...zero,
        reach: 48_200,
        saves: 1200,
        shares: 730,
        installs: 214,
        activations: 96,
        valueScore: 80,
      },
      previous: zero,
      deltas: { reach: 12, savesShares: 31, installs: 18, activations: null },
      activationRatePct: 45,
      reachByWeek: [{ weekStart: '2026-10-12', isoWeek: 42, reach: 48_200 }],
      isSample: true,
      hasData: true,
    };
    const byChannel: AnalyticsByChannel = {
      range,
      items: [
        { platform: 'instagram', posts: 4, reach: 30_000, installs: 92, valueScore: 70 },
        { platform: 'whatsapp', posts: 2, reach: 9000, installs: 61, valueScore: 60 },
      ],
    };
    const byMode: AnalyticsByMode = {
      range,
      items: [
        {
          mode: 'M1',
          pieces: 6,
          reach: 20_000,
          installs: 71,
          valuePer1k: 86,
          bestChannel: 'instagram',
        },
      ],
    };
    const postsRes: AnalyticsPostsResponse = { items: [], total: 0 };
    mockFetch({
      'GET /products': products,
      'GET /analytics/summary': () => jsonResponse(summary),
      'GET /analytics/by-channel': () => jsonResponse(byChannel),
      'GET /analytics/by-mode': () => jsonResponse(byMode),
      'GET /analytics/posts': () => jsonResponse(postsRes),
    });
    renderWithProviders(<AnalyticsPage />);

    expect(await screen.findByText('48.2k')).toBeInTheDocument();
    expect(screen.getByText('45% of installs')).toBeInTheDocument();
    expect(await screen.findByText(/sample data/)).toBeInTheDocument();
    expect(await screen.findByText('92')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: /content mode/i });
    expect(within(table).getByRole('rowheader', { name: 'M1 Founder films' })).toBeInTheDocument();
    expect(within(table).getByText('86')).toBeInTheDocument();
    expect(screen.getByText('No published posts with numbers in this window.')).toBeInTheDocument();
  });
});

/* ---------- Sales ---------- */

const LEAD: LeadView = {
  id: '66666666-6666-4666-8666-666666666666',
  productId: PRODUCT.id,
  organisation: 'Tamil Sangam, Singapore',
  source: 'keyword_reply',
  sourcePostId: null,
  sourceText: 'Keyword reply · R11',
  who: 'Community secretary · 400 members',
  firstOffer: 'A festival circle for members’ families',
  owner: null,
  ownerNote: 'Community owner (to name)',
  stage: 'new',
  nextStep: 'Intro call',
  nextStepAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  productName: 'Humini Live',
  productShortName: 'Live',
  productColor: '#ff9a00',
  sourcePostBriefCode: null,
  sourcePostPlatform: null,
};

describe('SalesPage', () => {
  it('shows the board and the lead detail, and moves a lead', async () => {
    const list: LeadListResponse = { items: [LEAD], total: 1 };
    const moveSpy = vi.fn(() => jsonResponse({ ...LEAD, stage: 'qualified' }));
    mockFetch({
      'GET /products': products,
      'GET /leads': () => jsonResponse(list),
      [`GET /leads/${LEAD.id}/activities`]: () => jsonResponse({ items: [], total: 0 }),
      [`POST /leads/${LEAD.id}/move`]: moveSpy,
    });
    renderWithProviders(<SalesPage />);

    expect(
      await screen.findByRole('heading', { name: 'Tamil Sangam, Singapore' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Community secretary · 400 members')).toBeInTheDocument();
    expect(screen.getByText('Community owner (to name)')).toBeInTheDocument();
    // No money fields anywhere on the lead detail.
    expect(screen.queryByText(/amount|deal value|₹/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Move to Qualified' }));
    await waitFor(() => expect(moveSpy).toHaveBeenCalledTimes(1));
    const init = moveSpy.mock.calls[0] as unknown as [RequestInit];
    expect(JSON.parse(String(init[0].body))).toEqual({ stage: 'qualified' });
  });

  it('shows the empty state', async () => {
    mockFetch({
      'GET /products': products,
      'GET /leads': () => jsonResponse({ items: [], total: 0 }),
    });
    renderWithProviders(<SalesPage />);
    expect(await screen.findByText('No leads yet')).toBeInTheDocument();
  });
});
