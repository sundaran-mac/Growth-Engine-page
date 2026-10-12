import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/stores/session';
import { jsonResponse, ME, mockFetch, renderWithRouter } from '@/test/utils';
import { appRoutes } from './router';

const unauthenticated = () =>
  jsonResponse({ title: 'Please sign in', status: 401, code: 'UNAUTHENTICATED' }, 401, 'application/problem+json');

describe('route guard', () => {
  beforeEach(() => useSessionStore.setState({ user: null, memberships: [], status: 'unknown' }));

  it('sends a signed-out user to /login and keeps where they were going', async () => {
    mockFetch({ 'GET /auth/me': unauthenticated });
    const { router } = renderWithRouter(appRoutes, ['/ideas?mode=M1']);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/ideas?mode=M1')}`);
  });

  it('lets a signed-in user through to the screen', async () => {
    mockFetch({
      'GET /auth/me': () => jsonResponse(ME),
      'GET /products': () => jsonResponse({ items: [], total: 0 }),
    });
    renderWithRouter(appRoutes, ['/ideas']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ideas' })).toBeInTheDocument();
  });

  it('shows the 404 page for unknown paths when signed in', async () => {
    mockFetch({ 'GET /auth/me': () => jsonResponse(ME) });
    renderWithRouter(appRoutes, ['/no-such-page']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('signs in and returns to the next path', async () => {
    let signedIn = false;
    mockFetch({
      'GET /auth/me': () => (signedIn ? jsonResponse(ME) : unauthenticated()),
      'POST /auth/login': () => {
        signedIn = true;
        return jsonResponse(ME);
      },
    });
    const { router } = renderWithRouter(appRoutes, ['/plan']);
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.type(screen.getByLabelText(/Email/), 'jeeva@arus.sg');
    await userEvent.type(screen.getByLabelText(/Password/), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/plan'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
  });

  it('shows a clear message for wrong credentials', async () => {
    mockFetch({
      'GET /auth/me': unauthenticated,
      'POST /auth/login': () =>
        jsonResponse({ title: 'Wrong', status: 401, code: 'INVALID_CREDENTIALS' }, 401, 'application/problem+json'),
    });
    renderWithRouter(appRoutes, ['/login']);
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.type(screen.getByLabelText(/Email/), 'jeeva@arus.sg');
    await userEvent.type(screen.getByLabelText(/Password/), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is wrong.')).toBeInTheDocument();
  });

  it('validates the form before calling the API', async () => {
    const fetchSpy = mockFetch({ 'GET /auth/me': unauthenticated });
    renderWithRouter(appRoutes, ['/login']);
    await screen.findByRole('heading', { name: 'Sign in' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/auth/login'))).toBe(false);
  });
});
