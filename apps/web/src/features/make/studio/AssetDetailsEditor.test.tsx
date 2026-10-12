import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/stores/session';
import { jsonResponse, ME, mockFetch, renderWithProviders } from '@/test/utils';
import { AssetList } from './AssetList';
import { makeAsset, BRIEF_ID } from './fixtures.test-util';
import { isLoudnessOffTarget, loudnessLabel, parseLufsInput } from './helpers';

describe('loudness helpers', () => {
  it('labels, parses and checks the target', () => {
    expect(loudnessLabel(-11.8, -14)).toBe('-11.8 LUFS (target -14)');
    expect(loudnessLabel(null, -14)).toBe('Loudness not set (target -14)');
    expect(isLoudnessOffTarget(-11.8, -14)).toBe(true);
    expect(isLoudnessOffTarget(-14.9, -14)).toBe(false);
    expect(parseLufsInput('-13.86')).toEqual({ value: -13.9 });
    expect(parseLufsInput('')).toEqual({ value: null });
    expect(parseLufsInput('-80')).toEqual({ error: 'Use a number from -70 to 0.' });
    expect(parseLufsInput('3')).toHaveProperty('error');
  });
});

describe('Loudness edit in the asset list', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
  });

  const asset = makeAsset({ loudnessLufs: -11.8 });

  it('shows the loudness off target and saves a new value with PATCH', async () => {
    const fetchSpy = mockFetch({
      [`PATCH /assets/${asset.id}`]: () => jsonResponse({ ...asset, loudnessLufs: -14 }),
      [`GET /briefs/${BRIEF_ID}/assets`]: () => jsonResponse({ items: [asset], total: 1 }),
    });
    renderWithProviders(
      <AssetList briefId={BRIEF_ID} assets={[asset]} canEdit emptyTitle="None" />,
    );
    const chip = screen.getByText('-11.8 LUFS (target -14)');
    expect(chip).toHaveAttribute('data-tone', 'reminder');

    await userEvent.click(screen.getByRole('button', { name: /Edit loudness/ }));
    const input = screen.getByLabelText('Loudness in LUFS');
    await userEvent.clear(input);
    await userEvent.type(input, '-80');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a number from -70 to 0.');
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    await userEvent.clear(input);
    await userEvent.type(input, '-14');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true),
    );
    const call = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ loudnessLufs: -14 });
    expect(await screen.findByText('File details saved')).toBeInTheDocument();
  });

  it('edits loudness, licence, consent and AI label in the details dialog', async () => {
    const fetchSpy = mockFetch({
      [`PATCH /assets/${asset.id}`]: () => jsonResponse({ ...asset, loudnessLufs: -14.2 }),
      [`GET /briefs/${BRIEF_ID}/assets`]: () => jsonResponse({ items: [asset], total: 1 }),
    });
    renderWithProviders(
      <AssetList briefId={BRIEF_ID} assets={[asset]} canEdit emptyTitle="None" />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Edit details/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Ratio')).toBeInTheDocument();
    const lufs = within(dialog).getByLabelText('Loudness (LUFS), target -14');
    expect(lufs).toHaveValue(-11.8);

    await userEvent.clear(lufs);
    await userEvent.type(lufs, '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Use a number from -70 to 0.')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    await userEvent.clear(lufs);
    await userEvent.type(lufs, '-14.2');
    await userEvent.type(within(dialog).getByLabelText('Licence'), 'Epidemic track 42');
    await userEvent.click(within(dialog).getByLabelText(/AI generated/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true),
    );
    const call = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      licence: `${asset.licence ?? ''}Epidemic track 42`,
      consentOnFile: asset.consentOnFile,
      aiGenerated: !asset.aiGenerated,
      loudnessLufs: -14.2,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('is read only when editing is not allowed', () => {
    mockFetch({});
    renderWithProviders(
      <AssetList briefId={BRIEF_ID} assets={[asset]} canEdit={false} emptyTitle="None" />,
    );
    expect(screen.getByText('-11.8 LUFS (target -14)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit loudness/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit details/ })).not.toBeInTheDocument();
  });
});
