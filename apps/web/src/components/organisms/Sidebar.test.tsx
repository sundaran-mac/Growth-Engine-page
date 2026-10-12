import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { jsonResponse, ME, mockFetch, renderWithRouter } from '@/test/utils';
import { Sidebar } from './Sidebar';

const PRODUCTS = {
  items: [
    { id: 'p1', name: 'Humini Live', slug: 'live', status: 'in_build', color: '#ff9a00' },
    { id: 'p2', name: 'Humini Pulse', slug: 'pulse', status: 'live', color: '#3e7568' },
  ],
  total: 2,
};

function renderSidebar(path: string) {
  return renderWithRouter([{ path: '*', element: <Sidebar /> }], [path]);
}

describe('Sidebar', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
    useUiStore.setState({ selectedProductId: null });
    mockFetch({
      'GET /products': () => jsonResponse(PRODUCTS),
      'GET /approvals': () => jsonResponse({ items: [], total: 3 }),
    });
  });

  it('shows the brand, groups and every nav item', () => {
    renderSidebar('/');
    expect(screen.getByText('Growth Desk')).toBeInTheDocument();
    expect(screen.getByText('Humini ecosystem')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of ['Home', 'Products', 'Ideas', 'Plan', 'Briefs', 'Studio', 'Review', 'Publish', 'Analytics', 'Sales']) {
      expect(within(nav).getByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    for (const group of ['Make', 'Ship', 'Learn']) expect(within(nav).getByText(group)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute('href', '/integrations');
  });

  it('marks only the current route as active', () => {
    renderSidebar('/ideas');
    const ideas = screen.getByRole('link', { name: 'Ideas' });
    expect(ideas).toHaveAttribute('aria-current', 'page');
    expect(ideas).toHaveClass('bg-joy');
    const home = screen.getByRole('link', { name: 'Home' });
    expect(home).not.toHaveAttribute('aria-current');
    expect(home).not.toHaveClass('bg-joy');
  });

  it('keeps a section active on its detail routes', () => {
    renderSidebar('/briefs/abc');
    expect(screen.getByRole('link', { name: 'Briefs' })).toHaveAttribute('aria-current', 'page');
  });

  it('navigates when a nav item is clicked', async () => {
    const { router } = renderSidebar('/');
    await userEvent.click(screen.getByRole('link', { name: 'Products' }));
    expect(router.state.location.pathname).toBe('/products');
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the approvals count from the API', async () => {
    renderSidebar('/');
    const link = await screen.findByRole('link', { name: /^Approvals.*3 waiting$/ });
    expect(link).toHaveTextContent('Approvals · 3');
  });

  it('shows the selected product and the signed-in user', async () => {
    renderSidebar('/');
    await waitFor(() => expect(screen.getByRole('button', { name: /Product: Humini Live/ })).toBeInTheDocument());
    expect(useUiStore.getState().selectedProductId).toBe('p1');
    expect(screen.getByText('Jeeva Santiago')).toBeInTheDocument();
    expect(screen.getByText('Marketing · Design')).toBeInTheDocument();
  });
});
