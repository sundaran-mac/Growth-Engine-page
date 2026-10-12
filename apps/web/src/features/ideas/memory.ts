/**
 * Content memory on the web (BUILD-PLAN section 11): checks before saving, the matches shown in
 * dialogs, and the memory size for Settings. Used by the Ideas, Make and Settings features.
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { MemoryCheckRequest, MemoryCheckResult, MemoryMatch, MemoryStats } from '@growth-desk/contract';
import { api, isApiError } from '@/lib/api';

export const memoryKeys = {
  stats: ['memory', 'stats'] as const,
};

export function useMemoryCheck() {
  return useMutation({
    mutationFn: (input: MemoryCheckRequest) => api<MemoryCheckResult>('/memory/check', { method: 'POST', body: input }),
    meta: { silent: true },
  });
}

export function useMemoryStats() {
  return useQuery({
    queryKey: memoryKeys.stats,
    queryFn: ({ signal }) => api<MemoryStats>('/memory/stats', { signal }),
  });
}

/** 'duplicate' or 'similar' when the API refused because of the content memory. */
export function repeatKind(err: unknown): 'duplicate' | 'similar' | null {
  if (!isApiError(err) || err.status !== 409) return null;
  if (err.code === 'IDEA_DUPLICATE') return 'duplicate';
  if (err.code === 'IDEA_SIMILAR') return 'similar';
  return null;
}

export const SOURCE_LABELS: Record<MemoryMatch['sourceType'], string> = {
  idea: 'Idea',
  brief_hook: 'Brief',
  post_caption: 'Post caption',
  dropped_draft: 'Claude draft',
};

export const LAYER_LABELS: Record<MemoryMatch['layer'], string> = {
  fingerprint: 'same words',
  text: 'similar words',
  meaning: 'same meaning',
};

/** Where a match opens in the app, or null when it has no page of its own. */
export function matchHref(m: MemoryMatch): string | null {
  if (!m.sourceId) return null;
  if (m.sourceType === 'brief_hook') return `/briefs/${m.sourceId}`;
  if (m.sourceType === 'idea') return '/ideas';
  return null;
}

/**
 * Checks a draft as the user types (debounced, nothing stored). Only the newest answer is kept.
 * Pass null to switch it off.
 */
export function useLiveMemoryCheck(input: MemoryCheckRequest | null, delay = 700) {
  const { mutateAsync } = useMemoryCheck();
  const [result, setResult] = React.useState<MemoryCheckResult | null>(null);
  const seq = React.useRef(0);
  const key = input ? JSON.stringify(input) : '';

  React.useEffect(() => {
    const id = ++seq.current;
    if (!key) return;
    const t = setTimeout(() => {
      mutateAsync(JSON.parse(key) as MemoryCheckRequest)
        .then((r) => {
          if (id === seq.current) setResult(r);
        })
        .catch(() => {
          // A failed check only hides the warning; the save itself is checked again.
          if (id === seq.current) setResult(null);
        });
    }, delay);
    return () => clearTimeout(t);
  }, [key, delay, mutateAsync]);

  // Switched off: show nothing (the last answer is kept for when it comes back on).
  return key ? result : null;
}
