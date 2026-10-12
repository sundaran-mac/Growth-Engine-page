/**
 * Turns a content memory check into the API answer people see:
 * - duplicate: 409 IDEA_DUPLICATE, always blocked,
 * - similar:   409 IDEA_SIMILAR, unless the request carries `similarReason` (stored in the audit log).
 * Both problems carry the earlier pieces in `matches` and a readable line in `errors`.
 */
import type { MemoryMatch } from '@growth-desk/contract';
import type { CheckDuplicateResult } from '../../lib/content-memory.js';
import { AppError } from '../../lib/errors.js';

const SOURCE_WORDS: Record<MemoryMatch['sourceType'], string> = {
  idea: 'idea',
  brief_hook: 'brief',
  post_caption: 'post caption',
  dropped_draft: 'Claude draft',
};

/** `"Their clock, not yours" (idea, Humini Live, 2026-10-10)`. */
export function describeMatch(m: MemoryMatch): string {
  const where = [SOURCE_WORDS[m.sourceType], m.productName, m.createdAt.slice(0, 10)].filter(Boolean).join(', ');
  return `"${m.title}" (${where})`;
}

export interface RepeatDecision {
  status: CheckDuplicateResult['status'];
  similarReason: string | null;
  /** Memory row ids, for the audit log. */
  matchIds: string[];
}

export interface GuardOptions {
  /** Field the problem points at, for example `body.title` or `body.hook`. */
  field: string;
  similarReason?: string | undefined;
  /** When false, "similar" passes without a reason (brief hook autosave: warn only). */
  similarNeedsReason?: boolean;
}

/** Throws 409 when the content repeats earlier content; returns what to write in the audit log. */
export function guardRepeat(result: CheckDuplicateResult, opts: GuardOptions): RepeatDecision {
  const top = result.matches[0];
  if (result.status === 'duplicate' && top) {
    throw new AppError({
      status: 409,
      code: 'IDEA_DUPLICATE',
      title: 'Already used',
      detail: `This repeats ${describeMatch(top)}. Every idea must be new, for every product. Change it so it says something new.`,
      errors: [{ path: opts.field, message: `Repeats ${describeMatch(top)}` }],
      extensions: { matches: result.matches },
    });
  }
  const needsReason = opts.similarNeedsReason ?? true;
  const reason = opts.similarReason?.trim() ?? '';
  if (result.status === 'similar' && top && needsReason && !reason) {
    throw new AppError({
      status: 409,
      code: 'IDEA_SIMILAR',
      title: 'Close to an earlier idea',
      detail: `This is close to ${describeMatch(top)}. Change it, or say why it is different and send it again.`,
      errors: [{ path: opts.field, message: `Close to ${describeMatch(top)}` }],
      extensions: { matches: result.matches },
    });
  }
  return {
    status: result.status,
    similarReason: result.status === 'similar' && reason ? reason : null,
    matchIds: result.matches.map((m) => m.id),
  };
}
