import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublishPage from '@/pages/PublishPage';
import { jsonResponse, mockFetch, renderWithRouter } from '@/test/utils';
import { BRIEF_ID, POSTS, makeSummary } from './fixtures';

const LINK = {
  url: 'https://live.humini.app/?utm_source=instagram&utm_medium=reel&utm_campaign=live-founder-oct&utm_content=REEL-031',
  display:
    'live.humini.app/?utm_source=instagram&utm_medium=reel&utm_campaign=live-founder-oct&utm_content=REEL-031',
  params: {
    utm_source: 'instagram',
    utm_medium: 'reel',
    utm_campaign: 'live-founder-oct',
    utm_content: 'REEL-031',
  },
};

function renderPage(allowed: boolean) {
  const fetchSpy = mockFetch({
    [`GET /publish/briefs/${BRIEF_ID}`]: () => jsonResponse(makeSummary(allowed)),
    [`GET /briefs/${BRIEF_ID}/posts`]: () => jsonResponse({ items: POSTS, total: POSTS.length }),
    [`GET /posts/${POSTS[0]!.id}/tracked-link`]: () => jsonResponse(LINK),
    [`POST /briefs/${BRIEF_ID}/posts/schedule-all`]: () =>
      jsonResponse({ scheduled: 2, skipped: [], items: POSTS }),
  });
  renderWithRouter(
    [{ path: '/publish/:briefId', element: <PublishPage /> }],
    [`/publish/${BRIEF_ID}`],
  );
  return fetchSpy;
}

afterEach(() => vi.unstubAllGlobals());

describe('PublishPage', () => {
  it('shows the gate banner and locks scheduling when the gates have not approved', async () => {
    renderPage(false);
    expect(await screen.findByText('Publishing is locked')).toBeInTheDocument();
    expect(screen.getByText('The brand gate has not approved version 2.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Post now' })).toBeDisabled();
  });

  it('schedules all when the gates allow it', async () => {
    const fetchSpy = renderPage(true);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Publish · REEL-031' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Publishing is locked')).not.toBeInTheDocument();
    await screen.findByText('YouTube Short');
    const button = screen.getByRole('button', { name: 'Schedule all' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(`/briefs/${BRIEF_ID}/posts/schedule-all`) &&
            init?.method === 'POST',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('2 posts scheduled')).toBeInTheDocument();
  });

  it('shows the tracked link and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderPage(true);
    expect(await screen.findByTestId('tracked-link')).toHaveTextContent(LINK.display);
    expect(
      screen.getByText('Written into the bio, the description and the keyword reply.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(LINK.url);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });
});
