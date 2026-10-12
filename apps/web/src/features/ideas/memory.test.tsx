import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Idea, MemoryCheckResult, MemoryMatch } from '@growth-desk/contract';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/utils';
import { IdeaCard } from './components/IdeaCard';
import { NewIdeaDialog } from './components/NewIdeaDialog';
import { generateSummary } from './lib';
import { matchHref } from './memory';

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';

const MATCH: MemoryMatch = {
  id: '00000000-0000-4000-8000-0000000000c1',
  sourceType: 'idea',
  sourceId: '00000000-0000-4000-8000-0000000000b2',
  productId: '00000000-0000-4000-8000-0000000000a2',
  productName: 'Humini Pulse',
  title: 'Grandma learns to video call',
  body: null,
  score: 0.457,
  layer: 'text',
  level: 'similar',
  createdAt: '2026-10-01T09:00:00.000Z',
};

function problem(code: string, status = 409) {
  return jsonResponse({ type: 'x', title: 'Conflict', status, code, detail: 'Close to an earlier idea.' }, status, 'application/problem+json');
}

function renderDialog() {
  return renderWithProviders(<NewIdeaDialog open onOpenChange={() => {}} productId={PRODUCT_ID} productName="Humini Live" />);
}

describe('NewIdeaDialog with the content memory', () => {
  it('shows the similar idea and sends the reason on "Add anyway"', async () => {
    const bodies: Record<string, unknown>[] = [];
    const check: MemoryCheckResult = { status: 'similar', matches: [MATCH] };
    const spy = mockFetch({
      'POST /ideas': (init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        return body.similarReason ? jsonResponse({ id: 'x', title: body.title }, 201) : problem('IDEA_SIMILAR');
      },
      'POST /memory/check': () => jsonResponse(check),
    });
    renderDialog();
    await userEvent.type(screen.getByLabelText(/Title/), 'Grandpa tries a video call');
    await userEvent.click(screen.getByRole('button', { name: 'Add idea' }));

    expect(await screen.findByText('Close to an earlier idea')).toBeInTheDocument();
    expect(screen.getByText('Grandma learns to video call')).toBeInTheDocument();
    expect(screen.getByText(/Humini Pulse/)).toBeInTheDocument();
    expect(screen.getByText(/46% similar words/)).toBeInTheDocument();
    const checkCall = spy.mock.calls.find(([url]) => String(url).includes('/memory/check'));
    expect(JSON.parse(String(checkCall?.[1]?.body))).toMatchObject({ productId: PRODUCT_ID, kind: 'idea', title: 'Grandpa tries a video call' });

    const reason = screen.getByLabelText(/Use anyway, because/);
    await userEvent.type(reason, 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument();

    await userEvent.type(reason, ' but grandpa leads');
    await userEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ title: 'Grandpa tries a video call', similarReason: 'short but grandpa leads' });
  });

  it('blocks a duplicate until the title changes', async () => {
    mockFetch({
      'POST /ideas': () => problem('IDEA_DUPLICATE'),
      'POST /memory/check': () => jsonResponse({ status: 'duplicate', matches: [{ ...MATCH, level: 'duplicate', layer: 'fingerprint', score: 1 }] }),
    });
    renderDialog();
    const title = screen.getByLabelText(/Title/);
    await userEvent.type(title, 'Grandma learns to video call!');
    await userEvent.click(screen.getByRole('button', { name: 'Add idea' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already used');
    expect(screen.getByText(/100% same words/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add idea' })).toBeDisabled();
    expect(screen.queryByLabelText(/Use anyway, because/)).not.toBeInTheDocument();
    await userEvent.type(title, ' Grandpa');
    expect(screen.queryByText('Already used')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add idea' })).toBeEnabled();
  });
});

describe('content memory helpers on the board', () => {
  it('says how many drafts were dropped as repeats', () => {
    expect(generateSummary({ dropped: 0, droppedAsDuplicate: 0, rounds: 1 })).toBe('They are in the New from Claude column.');
    expect(generateSummary({ dropped: 3, droppedAsDuplicate: 2, rounds: 2 })).toBe(
      '2 dropped as repeats of earlier ideas (any product). 1 left out: never-say words, a different mode, or more than you asked for. Claude was asked 2 times to fill the gap.',
    );
    expect(generateSummary({ dropped: 1, droppedAsDuplicate: 1, rounds: 1 })).toContain('1 dropped as a repeat');
  });

  it('links matches to their page', () => {
    expect(matchHref({ ...MATCH, sourceType: 'brief_hook' })).toBe(`/briefs/${MATCH.sourceId}`);
    expect(matchHref(MATCH)).toBe('/ideas');
    expect(matchHref({ ...MATCH, sourceType: 'dropped_draft', sourceId: null })).toBeNull();
  });

  it('shows the angle on the idea card', () => {
    const idea: Idea = {
      id: '00000000-0000-4000-8000-0000000000d1',
      productId: PRODUCT_ID,
      title: 'Their clock, not yours',
      summary: null,
      mode: 'M3',
      channels: [],
      fitScore: 91,
      status: 'new',
      source: 'claude',
      note: null,
      angle: 'parents abroad / call at their time / time zone swap',
      briefId: null,
      briefCode: null,
      createdBy: null,
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    };
    renderWithProviders(<IdeaCard idea={idea} canWrite={false} canDelete={false} />);
    expect(screen.getByText('parents abroad / call at their time / time zone swap')).toBeInTheDocument();
  });
});
