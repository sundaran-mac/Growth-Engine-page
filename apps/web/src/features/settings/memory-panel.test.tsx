import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MemoryStats } from '@growth-desk/contract';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/utils';
import { MemoryPanel } from './components/MemoryPanel';

const STATS: MemoryStats = {
  total: 1234,
  bySourceType: { idea: 900, brief_hook: 200, post_caption: 100, dropped_draft: 34 },
  withEmbedding: 0,
  embeddings: { enabled: false, model: null },
  thresholds: { textDuplicate: 0.55, textSimilar: 0.4, meaningDuplicate: 0.9, meaningSimilar: 0.83 },
  lastAddedAt: '2026-10-12T09:00:00.000Z',
};

describe('MemoryPanel', () => {
  it('shows the memory size, the embeddings state and the thresholds', async () => {
    mockFetch({ 'GET /memory/stats': () => jsonResponse(STATS) });
    renderWithProviders(<MemoryPanel />);
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();
    expect(screen.getByText('34 Claude repeats dropped')).toBeInTheDocument();
    expect(screen.getByText(/Off\. Add VOYAGE_API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/repeat at 55%, similar at 40%/)).toBeInTheDocument();
  });

  it('says when meaning checks are on', async () => {
    mockFetch({ 'GET /memory/stats': () => jsonResponse({ ...STATS, withEmbedding: 1200, embeddings: { enabled: true, model: 'voyage-4' } }) });
    renderWithProviders(<MemoryPanel />);
    expect(await screen.findByText(/On \(voyage-4\)\. 1,200 of 1,234 rows/)).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    mockFetch({});
    renderWithProviders(<MemoryPanel />);
    expect(await screen.findByText('Could not load the memory size')).toBeInTheDocument();
  });
});
