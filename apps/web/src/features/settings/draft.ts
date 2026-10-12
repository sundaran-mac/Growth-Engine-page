/**
 * Form draft helpers for the Settings tabs (no components here).
 * - `useDraft`: local copy of server data; follows new server data while nothing is unsaved.
 * - `useReportDirty` + `DirtyProvider`: forms tell the page about unsaved changes.
 */
import * as React from 'react';

const keyOf = (v: unknown) => JSON.stringify(v) ?? 'undefined';

export function useDraft<T>(server: T) {
  const serverKey = keyOf(server);
  const [state, setState] = React.useState({ key: serverKey, base: server, draft: server });
  let current = state;
  if (state.key !== serverKey) {
    // New server data (a save, a refetch). Keep the user's edits if there are any.
    const wasDirty = keyOf(state.draft) !== keyOf(state.base);
    current = { key: serverKey, base: server, draft: wasDirty ? state.draft : server };
    setState(current);
  }
  const dirty = keyOf(current.draft) !== serverKey;

  const setDraft = React.useCallback((update: T | ((d: T) => T)) => {
    setState((s) => ({
      ...s,
      draft: typeof update === 'function' ? (update as (d: T) => T)(s.draft) : update,
    }));
  }, []);
  const reset = React.useCallback(() => setState((s) => ({ ...s, draft: s.base })), []);

  return { draft: current.draft, setDraft, dirty, reset };
}

type ReportDirty = (key: string, dirty: boolean) => void;
const DirtyContext = React.createContext<ReportDirty>(() => undefined);
export const DirtyProvider = DirtyContext.Provider;

/** A form tells the page whether it holds unsaved changes. */
export function useReportDirty(key: string, dirty: boolean): void {
  const report = React.useContext(DirtyContext);
  React.useEffect(() => {
    report(key, dirty);
    return () => report(key, false);
  }, [key, dirty, report]);
}

/** Monday-first weekday order. Values follow JS getDay (0 = Sunday). */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
