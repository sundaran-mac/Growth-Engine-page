import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/utils';
import { ConnectChannelButton } from './ConnectChannelButton';

afterEach(() => vi.unstubAllGlobals());

describe('ConnectChannelButton and useStartOAuth', () => {
  it('asks the API for the provider URL and leaves the app for it', async () => {
    const fetchSpy = mockFetch({
      'GET /integrations/oauth/meta/start': () =>
        jsonResponse({ url: 'https://www.facebook.com/dialog/oauth?state=x' }),
    });
    const navigate = vi.fn();
    renderWithProviders(
      <ConnectChannelButton
        platform="meta"
        productId="44444444-4444-4444-8444-444444444444"
        navigate={navigate}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Connect Meta (Instagram and Facebook)' }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('https://www.facebook.com/dialog/oauth?state=x'),
    );
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('productId=44444444-4444-4444-8444-444444444444');
  });

  it('shows a clear toast when the platform keys are not set', async () => {
    mockFetch({
      'GET /integrations/oauth/google/start': () =>
        jsonResponse(
          { title: 'Google is not set up', status: 503, code: 'FEATURE_DISABLED' },
          503,
          'application/problem+json',
        ),
    });
    const navigate = vi.fn();
    renderWithProviders(
      <ConnectChannelButton platform="google" label="Connect YouTube" navigate={navigate} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect YouTube' }));
    expect(await screen.findByText('Not set up: add keys in .env')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
