import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { POSTS } from './fixtures';
import { PublishRowsTable } from './PublishRowsTable';
import { rowActions } from './rows';

describe('PublishRowsTable', () => {
  it('renders a row per channel with the HOW labels', () => {
    renderWithProviders(
      <PublishRowsTable posts={POSTS} briefKind="reel" gateAllowed onAction={vi.fn()} />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Instagram Reel')).toHaveLength(2);
    expect(within(table).getByText('YouTube Short')).toBeInTheDocument();
    expect(within(table).getByText('LinkedIn · Elan')).toBeInTheDocument();
    expect(within(table).getAllByText('Auto · Meta API')).toHaveLength(2);
    expect(within(table).getByText('Needs API approval')).toBeInTheDocument();
    expect(within(table).getByText('Reminder · by hand')).toBeInTheDocument();
    expect(within(table).getByText('Not connected')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Connect in Integrations' })).toHaveAttribute(
      'href',
      '/integrations',
    );
    expect(within(table).getByText('PLATFORM_ERROR: Media upload timed out')).toBeInTheDocument();
    expect(within(table).getAllByText('EN + TA').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Thu 7:30 pm IST').length).toBeGreaterThan(0);
  });

  it('offers the right actions per row', () => {
    const [ig, , li, , wa, failed] = POSTS;
    expect(rowActions(ig!, true)).toEqual(['edit', 'post-now']);
    expect(rowActions(ig!, false)).toEqual(['edit']);
    expect(rowActions(li!, true)).toEqual(['edit']);
    expect(rowActions(wa!, true)).toEqual(['edit', 'cancel', 'download', 'mark-posted']);
    expect(rowActions(failed!, true)).toEqual(['edit', 'retry']);
  });
});
