import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NextSlotList,
  PostingSlot,
  Product,
  ProductSettingsDetail,
  ScheduleResponse,
  WeeklyRun,
} from '@growth-desk/contract';
import SchedulePage from '@/pages/SchedulePage';
import SettingsPage from '@/pages/SettingsPage';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { ME, jsonResponse, mockFetch, renderWithRouter } from '@/test/utils';
import { visibleRange } from './calendar';
import { buildTrackedLink, mimeFor } from './format';
import { toDraft, toInput } from './slot-draft';

const NOW = '2026-10-12T06:00:00.000Z';
const product = (id: string, name: string): Product => ({
  id,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  shortName: name,
  status: 'live',
  statusNote: null,
  color: '#ff9a00',
  repoUrl: null,
  siteUrl: null,
  owner: null,
  backup: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const LIVE = product('11111111-1111-4111-8111-111111111111', 'Humini Live');
const PULSE = product('22222222-2222-4222-8222-222222222222', 'Humini Pulse');

const settings = (
  productId: string,
  over: Partial<ProductSettingsDetail> = {},
): ProductSettingsDetail => ({
  productId,
  timezone: 'Asia/Kolkata',
  launchDate: '2026-09-01',
  weeklyRunEnabled: true,
  weeklyRunDay: 1,
  weeklyRunTime: '07:00',
  weeklyIdeasCount: 10,
  weeklyModes: [],
  githubRepo: 'humini-ecosystem/humini-live-app',
  githubBaseBranch: 'main',
  weeklyPrEnabled: false,
  approvalSlaHours: 24,
  utmCampaignPrefix: 'live',
  trackingBaseUrl: 'https://live.humini.app',
  claudeMonthlyTokenCap: null,
  autoSchedule: true,
  createdAt: NOW,
  updatedAt: NOW,
  claudeUsage: { month: '2026-10', usedTokens: 120_000, capTokens: 2_000_000 },
  features: { claude: true, github: false, storage: true },
  canEdit: true,
  ...over,
});

const SLOT: PostingSlot = {
  id: '33333333-3333-4333-8333-333333333333',
  productId: LIVE.id,
  platform: 'instagram',
  weekday: 4,
  localTime: '19:30',
  audienceTimezone: 'Asia/Kolkata',
  label: 'India evening',
  active: true,
  sort: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

const NEXT: NextSlotList = {
  launchDate: '2026-09-01',
  items: Array.from({ length: 10 }, (_, i) => ({
    slotId: SLOT.id,
    platform: 'instagram' as const,
    at: new Date(Date.parse('2026-10-15T14:00:00Z') + i * 7 * 86_400_000).toISOString(),
    audienceTimezone: 'Asia/Kolkata',
    label: 'India evening',
  })),
};

const RUN: WeeklyRun = {
  id: '44444444-4444-4444-8444-444444444444',
  productId: LIVE.id,
  weekStart: '2026-10-12',
  status: 'done',
  ideasCreated: 7,
  noteId: null,
  githubPrUrl: 'https://github.com/humini-ecosystem/humini-live-app/pull/12',
  error: null,
  startedAt: NOW,
  finishedAt: NOW,
  triggeredBy: 'schedule',
  triggeredByUser: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const FAILED: WeeklyRun = {
  ...RUN,
  id: '55555555-5555-4555-8555-555555555555',
  status: 'failed',
  ideasCreated: 0,
  githubPrUrl: null,
  error: 'Failed at note: Claude did not answer.',
};

function routes(over: Record<string, (init?: RequestInit) => Response | Promise<Response>> = {}) {
  return {
    'GET /products': () => jsonResponse({ items: [LIVE, PULSE], total: 2 }),
    [`GET /products/${LIVE.id}/settings`]: () => jsonResponse(settings(LIVE.id)),
    [`GET /products/${PULSE.id}/settings`]: () =>
      jsonResponse(
        settings(PULSE.id, {
          utmCampaignPrefix: 'pulse',
          trackingBaseUrl: 'https://pulse.humini.app',
        }),
      ),
    [`GET /products/${LIVE.id}/slots`]: () => jsonResponse({ items: [SLOT], total: 1 }),
    [`GET /products/${LIVE.id}/slots/next`]: () => jsonResponse(NEXT),
    [`GET /products/${LIVE.id}/weekly-runs`]: () =>
      jsonResponse({ items: [RUN, FAILED], total: 2 }),
    ...over,
  };
}

function renderSettings(url: string) {
  return renderWithRouter([{ path: '/settings', element: <SettingsPage /> }], [url]);
}

beforeEach(() => {
  useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
  useUiStore.setState({ selectedProductId: LIVE.id });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Settings screen', () => {
  it('opens the tab named in ?tab= and shows the product', async () => {
    mockFetch(routes());
    renderSettings('/settings?tab=tracking');
    expect(
      await screen.findByRole('tab', { name: 'Tracking', selected: true }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('tracked-link-preview')).toHaveTextContent(
      'https://live.humini.app/?utm_source=instagram&utm_medium=reel&utm_campaign=live-founder-',
    );
    expect(screen.getByText(/Settings for Humini Live/)).toBeInTheDocument();
  });

  it('changes the URL when a tab is clicked', async () => {
    mockFetch(routes());
    const { router } = renderSettings('/settings');
    await screen.findByRole('tab', { name: 'General', selected: true });
    await userEvent.click(screen.getByRole('tab', { name: 'Claude and weekly run' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=claude'));
  });

  it('switching product refetches settings for the new product', async () => {
    const fetchSpy = mockFetch(routes());
    renderSettings('/settings?tab=tracking');
    await screen.findByTestId('tracked-link-preview');
    act(() => useUiStore.setState({ selectedProductId: PULSE.id }));
    await waitFor(() =>
      expect(screen.getByTestId('tracked-link-preview')).toHaveTextContent(
        'https://pulse.humini.app/?utm_source=instagram',
      ),
    );
    expect(
      fetchSpy.mock.calls.some(([u]) => String(u).includes(`/products/${PULSE.id}/settings`)),
    ).toBe(true);
  });

  it('warns before discarding unsaved changes on product switch, and can keep editing', async () => {
    mockFetch(routes());
    renderSettings('/settings?tab=tracking');
    const prefix = await screen.findByLabelText('Campaign prefix');
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'livenew');
    expect(await screen.findByText('You have unsaved changes.')).toBeInTheDocument();

    act(() => useUiStore.setState({ selectedProductId: PULSE.id }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/Switching to Humini Pulse throws them away/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(useUiStore.getState().selectedProductId).toBe(LIVE.id));
    expect(screen.getByLabelText('Campaign prefix')).toHaveValue('livenew');
  });

  it('discarding on product switch resets the form to the new product', async () => {
    mockFetch(routes());
    renderSettings('/settings?tab=tracking');
    const prefix = await screen.findByLabelText('Campaign prefix');
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'changed');
    act(() => useUiStore.setState({ selectedProductId: PULSE.id }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard and switch' }));
    await waitFor(() => expect(screen.getByLabelText('Campaign prefix')).toHaveValue('pulse'));
    expect(useUiStore.getState().selectedProductId).toBe(PULSE.id);
  });

  it('asks before leaving a tab with unsaved changes', async () => {
    mockFetch(routes());
    const { router } = renderSettings('/settings?tab=tracking');
    const prefix = await screen.findByLabelText('Campaign prefix');
    await userEvent.type(prefix, 'x');
    await userEvent.click(screen.getByRole('tab', { name: 'Approvals' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.search).toBe('?tab=tracking');
  });

  it('saves only the changed fields', async () => {
    const patch = vi.fn((init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ ...settings(LIVE.id), ...body });
    });
    mockFetch(routes({ [`PATCH /products/${LIVE.id}/settings`]: patch }));
    renderSettings('/settings?tab=tracking');
    const prefix = await screen.findByLabelText('Campaign prefix');
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'live-oct');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(patch.mock.calls[0]![0]?.body))).toEqual({
      utmCampaignPrefix: 'live-oct',
    });
  });

  it('shows a field error from the contract schema without calling the API', async () => {
    const patch = vi.fn(() => jsonResponse({}));
    mockFetch(routes({ [`PATCH /products/${LIVE.id}/settings`]: patch }));
    renderSettings('/settings?tab=tracking');
    const prefix = await screen.findByLabelText('Campaign prefix');
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'Has Caps');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Use lower case letters, numbers and dashes'),
    ).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('is read only for people who cannot edit', async () => {
    mockFetch(
      routes({
        [`GET /products/${LIVE.id}/settings`]: () =>
          jsonResponse(settings(LIVE.id, { canEdit: false })),
      }),
    );
    renderSettings('/settings?tab=tracking');
    expect(await screen.findByLabelText('Campaign prefix')).toBeDisabled();
    expect(screen.getByText(/Read only/)).toBeInTheDocument();
  });

  it('shows an error state with retry when settings fail to load', async () => {
    mockFetch(
      routes({
        [`GET /products/${LIVE.id}/settings`]: () =>
          jsonResponse(
            {
              title: 'Forbidden',
              status: 403,
              code: 'FORBIDDEN',
              detail: 'You are not on the team of this product.',
            },
            403,
            'application/problem+json',
          ),
      }),
    );
    renderSettings('/settings');
    expect(await screen.findByText('You are not on the team of this product.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Posting schedule tab', () => {
  it('lists slots and the next 10 slots preview', async () => {
    mockFetch(routes());
    renderSettings('/settings?tab=schedule');
    const preview = await screen.findByRole('list', { name: 'Next free posting slots' });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(10);
    expect(within(preview).getAllByText(/Thu 15 Oct, 7:30 pm/).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('India evening')).toBeInTheDocument();
  });

  it('removes a slot and saves the list with PUT', async () => {
    const put = vi.fn(() => jsonResponse({ items: [], total: 0 }));
    mockFetch(routes({ [`PUT /products/${LIVE.id}/slots`]: put }));
    renderSettings('/settings?tab=schedule');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove slot' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((put.mock.calls[0] as unknown as [RequestInit])[0].body))).toEqual({
      slots: [],
    });
  });
});

describe('Claude and weekly run tab', () => {
  it('shows run history with status, ideas, PR link and error', async () => {
    mockFetch(routes());
    renderSettings('/settings?tab=claude');
    const table = await screen.findByRole('table');
    await within(table).findByText('Done');
    expect(within(table).getByText('Failed')).toBeInTheDocument();
    expect(within(table).getByText('7')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /Open PR/ })).toHaveAttribute(
      'href',
      RUN.githubPrUrl,
    );
    expect(within(table).getByText('Failed at note: Claude did not answer.')).toBeInTheDocument();
    expect(screen.getByText(/120k of 2M tokens used in 2026-10/)).toBeInTheDocument();
  });

  it('Run now asks first, then starts a run', async () => {
    const post = vi.fn(() => jsonResponse({ ...RUN, status: 'queued' }, 202));
    mockFetch(routes({ [`POST /products/${LIVE.id}/weekly-runs`]: post }));
    renderSettings('/settings?tab=claude');
    await userEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });
});

describe('Schedule screen', () => {
  it('shows posts with times and open slots for the selected product', async () => {
    const at = new Date();
    at.setHours(19, 30, 0, 0);
    const res: ScheduleResponse = {
      items: [
        {
          postId: '66666666-6666-4666-8666-666666666666',
          briefId: '77777777-7777-4777-8777-777777777777',
          briefCode: 'REEL-031',
          briefTitle: '60 seconds with Elan',
          platform: 'instagram',
          channelName: 'Humini Live',
          status: 'scheduled',
          at: at.toISOString(),
          audienceTimezone: 'Asia/Singapore',
          liveUrl: null,
        },
      ],
      freeSlots: [
        {
          slotId: SLOT.id,
          platform: 'youtube',
          at: new Date(at.getTime() + 3_600_000).toISOString(),
          audienceTimezone: 'Asia/Kolkata',
          label: null,
        },
      ],
      timezone: 'Asia/Kolkata',
      launchDate: '2026-09-01',
    };
    const schedule = vi.fn(() => jsonResponse(res));
    const fetchSpy = mockFetch({
      'GET /products': () => jsonResponse({ items: [LIVE], total: 1 }),
      'GET /schedule': schedule,
    });
    renderWithRouter([{ path: '/schedule', element: <SchedulePage /> }], ['/schedule?view=week']);
    expect(
      await screen.findByRole('link', { name: /Instagram REEL-031 Scheduled/ }),
    ).toHaveAttribute('href', '/publish/77777777-7777-4777-8777-777777777777');
    expect(screen.getByText(/Open/, { selector: 'span' })).toBeInTheDocument();
    const call = fetchSpy.mock.calls.find(([u]) => String(u).includes('/schedule'));
    const url = new URL(String(call![0]), 'http://x');
    expect(url.searchParams.get('productId')).toBe(LIVE.id);
    // One week (a daylight-saving change can make it an hour shorter or longer).
    const span = Date.parse(url.searchParams.get('to')!) - Date.parse(url.searchParams.get('from')!);
    expect(Math.abs(span - 7 * 86_400_000)).toBeLessThanOrEqual(3_600_000);
  });
});

describe('pure helpers', () => {
  it('mimeFor maps names when the browser gives no type', () => {
    expect(mimeFor({ name: 'spec.md', type: '' })).toBe('text/markdown');
    expect(mimeFor({ name: 'deck.pdf', type: 'application/pdf' })).toBe('application/pdf');
    expect(mimeFor({ name: 'photo.png', type: 'image/png' })).toBeNull();
  });

  it('buildTrackedLink matches the Publish link shape', () => {
    const link = buildTrackedLink({
      baseUrl: 'https://live.humini.app',
      prefix: 'live',
      platform: 'instagram',
      medium: 'reel',
      theme: 'founder',
      month: new Date('2026-10-15T00:00:00Z'),
      contentCode: 'REEL-031',
    });
    expect(link).toBe(
      'https://live.humini.app/?utm_source=instagram&utm_medium=reel&utm_campaign=live-founder-oct&utm_content=REEL-031',
    );
    expect(
      buildTrackedLink({
        baseUrl: 'not a url',
        prefix: null,
        platform: 'youtube',
        medium: 'm',
        theme: 't',
        month: new Date(),
        contentCode: 'X-001',
      }),
    ).toBeNull();
  });

  it('visibleRange covers whole Monday-first weeks', () => {
    const month = visibleRange('month', new Date(2026, 9, 15));
    expect(month.days[0]!.getDay()).toBe(1);
    expect(month.days.length % 7).toBe(0);
    const week = visibleRange('week', new Date(2026, 9, 15));
    expect(week.days).toHaveLength(7);
    expect(week.days[0]!.getDate()).toBe(12);
  });

  it('slot drafts round-trip to the API input', () => {
    expect(toInput(toDraft(SLOT))).toEqual({
      platform: 'instagram',
      weekday: 4,
      localTime: '19:30',
      audienceTimezone: 'Asia/Kolkata',
      label: 'India evening',
      active: true,
    });
  });
});
