/**
 * Small pure helpers for the Review and Approvals screens.
 */
import type {
  Approval,
  ApprovalGate,
  ApprovalListItem,
  GateBrief,
  ReviewComment,
} from '@growth-desk/contract';

/** `12_000` gives `0:12`, `3_725_000` gives `1:02:05`. */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Waiting time as in the Figma: `35 min`, `6 h`, `1 d`. */
export function formatWaiting(fromIso: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(fromIso).getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export const GATE_NAMES: Record<ApprovalGate, string> = { claims: 'Claims', brand: 'Brand' };

/** Pending approvals grouped by brief, oldest wait first (Approvals queue cards). */
export interface ApprovalGroup {
  brief: GateBrief;
  items: ApprovalListItem[];
  /** "claims", "claims + brand" */
  gatesText: string;
  requestedAt: string;
  escalated: boolean;
}

export function groupByBrief(items: readonly ApprovalListItem[]): ApprovalGroup[] {
  const map = new Map<string, ApprovalGroup>();
  for (const item of items) {
    const g = map.get(item.briefId);
    if (g) {
      g.items.push(item);
      if (item.requestedAt < g.requestedAt) g.requestedAt = item.requestedAt;
      g.escalated ||= item.escalatedAt !== null;
    } else {
      map.set(item.briefId, {
        brief: item.brief,
        items: [item],
        gatesText: '',
        requestedAt: item.requestedAt,
        escalated: item.escalatedAt !== null,
      });
    }
  }
  const order: ApprovalGate[] = ['claims', 'brand'];
  return [...map.values()]
    .map((g) => {
      const items = [...g.items].sort((a, b) => order.indexOf(a.gate) - order.indexOf(b.gate));
      return { ...g, items, gatesText: items.map((i) => i.gate).join(' + ') };
    })
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

export type GateState = 'approved' | 'changes' | 'yours' | 'waiting';

export function gateState(a: Approval, decidableIds: ReadonlySet<string>): GateState {
  if (a.decision === 'approved') return 'approved';
  if (a.decision === 'changes_requested') return 'changes';
  return decidableIds.has(a.id) ? 'yours' : 'waiting';
}

export const GATE_STATE_TEXT: Record<GateState, string> = {
  approved: 'Approved',
  changes: 'Changes requested',
  yours: 'Your decision',
  waiting: 'Waiting',
};

/** One thread: a root comment and its replies (oldest first). Threads are one level deep. */
export interface CommentThread {
  root: ReviewComment;
  replies: ReviewComment[];
}

/**
 * Groups a flat list into threads, keeping the order of the roots. A reply whose root is not in
 * the list (for example filtered out) shows as its own thread, so it is never lost.
 */
export function toThreads(comments: readonly ReviewComment[]): CommentThread[] {
  const roots = new Set(comments.filter((c) => !c.parentId).map((c) => c.id));
  const replies = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    if (!c.parentId || !roots.has(c.parentId)) continue;
    const list = replies.get(c.parentId) ?? [];
    list.push(c);
    replies.set(c.parentId, list);
  }
  return comments
    .filter((c) => !c.parentId || !roots.has(c.parentId))
    .map((root) => ({
      root,
      replies: (replies.get(root.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
}
