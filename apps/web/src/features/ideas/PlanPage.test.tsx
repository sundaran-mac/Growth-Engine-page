import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanChecks, PlanItemView, PlanView } from '@growth-desk/contract';
import PlanPage from '@/pages/PlanPage';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { jsonResponse, ME, mockFetch, renderWithRouter } from '@/test/utils';

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const PLAN_ID = '00000000-0000-4000-8000-0000000000b1';
const PRODUCTS = { items: [{ id: PRODUCT_ID, name: 'Humini Live', slug: 'live', status: 'in_build', color: '#ff9a00' }], total: 1 };
const STAMP = '2026-10-10T00:00:00.000Z';

function item(over: Partial<PlanItemView>): PlanItemView {
  return {
    id: crypto.randomUUID(),
    planId: PLAN_ID,
    date: '2026-11-02',
    title: 'Piece',
    mode: 'M1',
    channel: 'instagram',
    ideaId: null,
    briefId: null,
    occasionId: null,
    needsShootSlot: false,
    position: 0,
    briefCode: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...over,
  };
}

const PLAN: PlanView = {
  id: PLAN_ID,
  productId: PRODUCT_ID,
  month: '2026-11',
  status: 'draft',
  frozenAt: null,
  frozenBy: null,
  items: [
    item({ title: 'Why I build', date: '2026-11-02' }),
    item({ title: 'Ask Elan', date: '2026-11-13', needsShootSlot: true, ideaId: crypto.randomUUID() }),
    item({ title: 'Two hearts', date: '2026-11-04', mode: 'M3' }),
  ],
  createdAt: STAMP,
  updatedAt: STAMP,
};

const CHECKS: PlanChecks = {
  planId: PLAN_ID,
  total: 3,
  mix: [
    { mode: 'M1', count: 2 },
    { mode: 'M3', count: 1 },
    { mode: 'M2', count: 0 },
    { mode: 'M4', count: 0 },
    { mode: 'M5', count: 0 },
    { mode: 'M6', count: 0 },
    { mode: 'M7', count: 0 },
  ],
  occasions: [],
  warnings: [
    { code: 'NO_SHOOT_SLOT', message: '1 founder film has no shoot slot', itemIds: [], week: null, productId: null },
    { code: 'EMPTY_WEEK', message: 'No Humini Live piece in week 4', itemIds: [], week: 4, productId: null },
    {
      code: 'PRODUCT_EMPTY_WEEK',
      message: 'No Pulse piece in week 3',
      itemIds: [],
      week: 3,
      productId: '00000000-0000-4000-8000-0000000000b2',
    },
  ],
};

const OCCASIONS = {
  items: [
    { id: crypto.randomUUID(), name: 'Children’s Day', date: '2026-11-14', endDate: null, notes: null, productIds: [], createdAt: STAMP, updatedAt: STAMP },
  ],
  total: 1,
};

function setup(plan: PlanView | null, role: 'editor' | 'viewer' = 'editor') {
  useSessionStore.setState({ user: { ...ME.user, role }, memberships: [], status: 'signedIn' });
  useUiStore.setState({ selectedProductId: PRODUCT_ID });
  const spy = mockFetch({
    'GET /products': () => jsonResponse(PRODUCTS),
    'GET /plans': () => jsonResponse({ plan }),
    [`GET /plans/${PLAN_ID}/checks`]: () => jsonResponse(CHECKS),
    'GET /occasions': () => jsonResponse(OCCASIONS),
    'GET /ideas': () => jsonResponse({ items: [], total: 0 }),
    'POST /plans': () => jsonResponse({ ...PLAN, items: [] }, 201),
    [`POST /plans/${PLAN_ID}/freeze`]: () =>
      jsonResponse({ plan: { ...PLAN, status: 'frozen', frozenAt: STAMP }, briefsCreated: 1, itemsWithoutIdea: 2 }),
  });
  renderWithRouter([{ path: '/plan', element: <PlanPage /> }], ['/plan?month=2026-11']);
  return spy;
}

describe('PlanPage', () => {
  beforeEach(() => {
    useUiStore.setState({ selectedProductId: null });
  });

  it('shows the month calendar with pieces, occasions, mix check and things to fix', async () => {
    setup(PLAN);
    expect(await screen.findByRole('heading', { name: 'November plan · Humini Live' })).toBeInTheDocument();
    expect(await screen.findByText('Draft · 3 pieces · freeze locks it for briefs')).toBeInTheDocument();
    const grid = await screen.findByRole('grid', { name: 'Month calendar' });
    expect(within(grid).getByRole('button', { name: /M1 · Why I build/ })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: /M1 · Ask Elan, needs a shoot slot/ })).toBeInTheDocument();
    expect(within(grid).getAllByText('Children’s Day').length).toBeGreaterThan(0);
    expect(within(grid).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

    const mix = await screen.findByRole('region', { name: 'Mix check' });
    expect(within(mix).getByText('M1 Founder')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '3 things to fix' })).toBeInTheDocument();
    // The cross-product check (another product with a signed kit) shows in the same panel.
    expect(
      screen.getByText(
        '1 founder film has no shoot slot · No Humini Live piece in week 4 · No Pulse piece in week 3',
      ),
    ).toBeInTheDocument();
  });

  it('offers to start a month that has no plan', async () => {
    const spy = setup(null);
    const start = await screen.findByRole('button', { name: 'Start the November plan' });
    await userEvent.click(start);
    await waitFor(() => expect(spy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const call = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ productId: PRODUCT_ID, month: '2026-11' });
  });

  it('freezes the month after a confirm that says how many briefs will be made', async () => {
    const spy = setup(PLAN);
    await userEvent.click(await screen.findByRole('button', { name: 'Freeze month' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/1 brief is made from the ideas on the plan/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freeze month' }));
    await waitFor(() =>
      expect(spy.mock.calls.some(([url, init]) => String(url).includes(`/plans/${PLAN_ID}/freeze`) && init?.method === 'POST')).toBe(true),
    );
  });

  it('is read only for a viewer', async () => {
    setup(PLAN, 'viewer');
    await screen.findByRole('grid', { name: 'Month calendar' });
    expect(screen.queryByRole('button', { name: 'Freeze month' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a piece on/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /M1 · Why I build.*Open\./ })).toBeInTheDocument();
  });
});
