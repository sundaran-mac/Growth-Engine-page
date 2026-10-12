/**
 * Runs the claim check on the unsaved draft as the user types (debounced preview, nothing stored).
 * Only the newest answer is kept, so a slow old request never overwrites a newer one.
 */
import * as React from 'react';
import type { ClaimCheckResult } from '@growth-desk/contract';
import { useClaimCheck } from '../api';

export interface ClaimDraft {
  title: string;
  hook: string | null;
  beats: string[];
  ask: string | null;
}

export function useLiveClaimCheck(
  briefId: string,
  draft: ClaimDraft,
  opts: { enabled: boolean; delay?: number },
) {
  const { enabled, delay = 500 } = opts;
  const { mutateAsync } = useClaimCheck(briefId);
  const [result, setResult] = React.useState<ClaimCheckResult | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const seq = React.useRef(0);
  const key = JSON.stringify(draft);
  const first = React.useRef(true);

  React.useEffect(() => {
    if (!enabled) return;
    // The stored flags are fresh on load; check only after the first edit.
    if (first.current) {
      first.current = false;
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(() => {
      setChecking(true);
      mutateAsync({ draft: JSON.parse(key) as ClaimDraft })
        .then((r) => {
          if (id !== seq.current) return;
          setResult(r);
          setError(null);
        })
        .catch((err: unknown) => {
          if (id === seq.current) setError(err);
        })
        .finally(() => {
          if (id === seq.current) setChecking(false);
        });
    }, delay);
    return () => clearTimeout(t);
  }, [key, enabled, delay, mutateAsync]);

  return { result, checking, error };
}
