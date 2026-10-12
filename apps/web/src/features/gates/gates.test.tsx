import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ApprovalListItem,
  GateBrief,
  ReviewComment,
  ReviewDetail,
} from '@growth-desk/contract';
import ApprovalsPage from '@/pages/ApprovalsPage';
import ReviewPage from '@/pages/ReviewPage';
import { useSessionStore } from '@/stores/session';
import { jsonResponse, ME, mockFetch, renderWithProviders, renderWithRouter } from '@/test/utils';
import { CommentsPanel } from './components/CommentsPanel';
import { formatTimecode, formatWaiting, groupByBrief, toThreads } from './format';

const NOW = '2026-10-12T12:00:00.000Z';
const BRIEF: GateBrief = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'REEL-031',
  title: '60 seconds with Elan',
  kind: 'reel',
  mode: 'M1',
  stage: 'reviewed',
  version: 1,
  hook: 'You are not a bad friend.',
  captionLanguages: ['en', 'ta'],
  productId: '22222222-2222-4222-8222-222222222222',
  productName: 'Humini Live',
  productShortName: 'Live',
  productColor: '#ff9a00',
  owner: null,
  updatedAt: NOW,
};

function approval(over: Partial<ApprovalListItem> = {}): ApprovalListItem {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    briefId: BRIEF.id,
    version: 1,
    gate: 'claims',
    approver: { id: ME.user.id, name: 'Live owner', initials: 'LO' },
    backup: null,
    decidedBy: null,
    decision: 'pending',
    note: null,
    requestedAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
    dueAt: new Date(Date.now() + 18 * 3_600_000).toISOString(),
    escalatedAt: null,
    decidedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    brief: BRIEF,
    stale: false,
    canDecide: true,
    ...over,
  };
}

describe('format helpers', () => {
  it('formats timecodes and waiting time', () => {
    expect(formatTimecode(12_000)).toBe('0:12');
    expect(formatTimecode(58_900)).toBe('0:58');
    expect(formatTimecode(3_725_000)).toBe('1:02:05');
    const now = Date.parse(NOW);
    expect(formatWaiting(new Date(now - 6 * 3_600_000).toISOString(), now)).toBe('6 h');
    expect(formatWaiting(new Date(now - 30 * 3_600_000).toISOString(), now)).toBe('1 d');
    expect(formatWaiting(new Date(now - 20_000).toISOString(), now)).toBe('1 min');
  });

  it('groups approvals by piece with claims first', () => {
    const brand = approval({ id: 'b', gate: 'brand', requestedAt: '2026-10-12T01:00:00.000Z' });
    const claims = approval({ id: 'c', gate: 'claims', requestedAt: '2026-10-12T02:00:00.000Z' });
    const [g] = groupByBrief([brand, claims]);
    expect(g!.gatesText).toBe('claims + brand');
    expect(g!.requestedAt).toBe('2026-10-12T01:00:00.000Z');
  });
});

describe('ApprovalsPage', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
  });

  it('shows the queue and approves the claims gate', async () => {
    const item = approval();
    const brandGate = {
      ...approval({ id: '44444444-4444-4444-8444-444444444444', gate: 'brand' }),
      decision: 'approved' as const,
      approver: { id: 'e', name: 'Elan', initials: 'E' },
      decidedBy: { id: 'e', name: 'Elan', initials: 'E' },
    };
    let decided: unknown = null;
    mockFetch({
      'GET /approvals': () => jsonResponse({ items: [item], total: 1 }),
      [`GET /approvals/${item.id}`]: () =>
        jsonResponse({
          ...item,
          claims: [{ text: 'A byte is 60 seconds of you', source: 'spec 006', check: 'matches' }],
          claimFlags: [],
          gates: [item, brandGate],
          history: [item, brandGate],
        }),
      [`POST /approvals/${item.id}/decide`]: (init) => {
        decided = JSON.parse(String(init?.body));
        return jsonResponse({
          approval: { ...item, decision: 'approved' },
          brief: { ...BRIEF, stage: 'approved' },
          postsCreated: 3,
        });
      },
    });
    renderWithRouter([{ path: '/approvals', element: <ApprovalsPage /> }], ['/approvals']);

    const queue = await screen.findByRole('list', { name: 'Pieces waiting for approval' });
    expect(within(queue).getByText('REEL-031 · 60 seconds with Elan')).toBeInTheDocument();
    expect(within(queue).getByText('Live · claims')).toBeInTheDocument();
    expect(within(queue).getByText('waiting 6 h')).toBeInTheDocument();

    expect(await screen.findByText('A byte is 60 seconds of you')).toBeInTheDocument();
    expect(screen.getByText('Your decision')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve claims' }));
    await waitFor(() => expect(decided).toEqual({ decision: 'approved' }));
  });

  it('needs a note to request changes', async () => {
    const item = approval();
    let body: unknown = null;
    mockFetch({
      'GET /approvals': () => jsonResponse({ items: [item], total: 1 }),
      [`GET /approvals/${item.id}`]: () =>
        jsonResponse({ ...item, claims: [], claimFlags: [], gates: [item], history: [item] }),
      [`POST /approvals/${item.id}/decide`]: (init) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse({
          approval: item,
          brief: { ...BRIEF, stage: 'brief', version: 2 },
          postsCreated: 0,
        });
      },
    });
    renderWithRouter([{ path: '/approvals', element: <ApprovalsPage /> }], ['/approvals']);
    await userEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request changes' }));
    expect(await within(dialog).findByText(/Write a note/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Spec says 60 s');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request changes' }));
    await waitFor(() =>
      expect(body).toEqual({ decision: 'changes_requested', note: 'Spec says 60 s' }),
    );
  });

  it('shows an empty state when nothing waits', async () => {
    mockFetch({ 'GET /approvals': () => jsonResponse({ items: [], total: 0 }) });
    renderWithRouter([{ path: '/approvals', element: <ApprovalsPage /> }], ['/approvals']);
    expect(await screen.findByText('Nothing waits for you')).toBeInTheDocument();
  });
});

function reviewDetail(over: Partial<ReviewDetail['checklist']> = {}): ReviewDetail {
  const items = [
    { key: 'claim_check', label: 'Claim check passed', done: true, auto: true, detail: null },
    {
      key: 'real_screens',
      label: 'Real app screens only, no mockups',
      done: false,
      auto: false,
      detail: null,
    },
  ];
  return {
    brief: { ...BRIEF, stage: 'made' },
    checklist: {
      version: 1,
      items,
      done: 1,
      total: 2,
      complete: false,
      completedAt: null,
      ...over,
    },
    master: null,
    approvals: [],
    canReview: true,
    canSend: true,
  };
}

describe('ReviewPage', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
  });

  it('keeps Send for approval disabled until the checklist is complete, ticks manual items', async () => {
    let patched: unknown = null;
    const complete = reviewDetail({
      items: [
        { key: 'claim_check', label: 'Claim check passed', done: true, auto: true, detail: null },
        {
          key: 'real_screens',
          label: 'Real app screens only, no mockups',
          done: true,
          auto: false,
          detail: null,
        },
      ],
      done: 2,
      complete: true,
    });
    mockFetch({
      [`GET /briefs/${BRIEF.id}/review`]: () => jsonResponse(patched ? complete : reviewDetail()),
      [`GET /briefs/${BRIEF.id}/comments`]: () => jsonResponse({ items: [], total: 0 }),
      [`PATCH /briefs/${BRIEF.id}/review/checklist`]: (init) => {
        patched = JSON.parse(String(init?.body));
        return jsonResponse(complete);
      },
    });
    renderWithRouter(
      [{ path: '/review/:briefId', element: <ReviewPage /> }],
      [`/review/${BRIEF.id}`],
    );

    expect(await screen.findByText('Checklist · 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeDisabled();
    expect(screen.getByText('Auto')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Real app screens only, no mockups' }),
    );
    await waitFor(() =>
      expect(patched).toEqual({ version: 1, items: [{ key: 'real_screens', done: true }] }),
    );
    expect(await screen.findByText('Checklist · 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeEnabled();
  });
});

function comment(over: Partial<ReviewComment> & { id: string }): ReviewComment {
  return {
    briefId: BRIEF.id,
    version: 1,
    author: { id: '44444444-4444-4444-8444-444444444444', name: 'Kavya Tester', initials: 'KT' },
    authorLabel: null,
    timecodeMs: 12_000,
    parentId: null,
    body: 'Caption overlaps the Reels UI',
    resolved: false,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const ROOT_ID = '55555555-5555-4555-8555-555555555555';
const REPLY_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_ID = '77777777-7777-4777-8777-777777777777';

describe('comment threads', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: ME.user, memberships: [], status: 'signedIn' });
  });

  it('groups replies under their root in order and keeps orphans visible', () => {
    const root = comment({ id: ROOT_ID });
    const reply = comment({
      id: REPLY_ID,
      parentId: ROOT_ID,
      body: 'Moved it up',
      createdAt: '2026-10-12T12:05:00.000Z',
    });
    const early = comment({
      id: OTHER_ID,
      parentId: ROOT_ID,
      body: 'Seen',
      createdAt: '2026-10-12T12:01:00.000Z',
    });
    const orphan = comment({
      id: '88888888-8888-4888-8888-888888888888',
      parentId: '99999999-9999-4999-8999-999999999999',
    });
    const threads = toThreads([root, reply, early, orphan]);
    expect(threads).toHaveLength(2);
    expect(threads[0]!.root.id).toBe(ROOT_ID);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual([OTHER_ID, REPLY_ID]);
    expect(threads[1]!.replies).toEqual([]);
  });

  it('shows replies indented under the root and sends a reply with parentId', async () => {
    let posted: unknown = null;
    mockFetch({
      [`POST /briefs/${BRIEF.id}/comments`]: (init) => {
        posted = JSON.parse(String(init?.body));
        return jsonResponse(comment({ id: OTHER_ID, parentId: ROOT_ID, body: 'Thanks' }), 201);
      },
      [`GET /briefs/${BRIEF.id}/comments`]: () => jsonResponse({ items: [], total: 0 }),
    });
    const items = [
      comment({ id: ROOT_ID }),
      comment({
        id: REPLY_ID,
        parentId: ROOT_ID,
        author: { id: ME.user.id, name: 'Jeeva Maker', initials: 'JM' },
        body: 'Moved it up 80 px',
      }),
    ];
    renderWithProviders(
      <CommentsPanel
        briefId={BRIEF.id}
        comments={items}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        canComment
        positionMs={30_000}
        onSeek={() => {}}
      />,
    );
    const replies = screen.getByRole('list', { name: 'Replies' });
    expect(within(replies).getByText('Moved it up 80 px')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Go to/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Resolve/ })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Reply to Kavya Tester' }));
    const box = screen.getByRole('textbox', { name: 'Reply to Kavya Tester' });
    expect(box).toHaveValue('');
    await userEvent.type(box, 'Thanks');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(posted).toEqual({ body: 'Thanks', parentId: ROOT_ID }));
    expect(await screen.findByText('Reply added')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Reply to Kavya Tester' }),
      ).not.toBeInTheDocument(),
    );
  });
});
