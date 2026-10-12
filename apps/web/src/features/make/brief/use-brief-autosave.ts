/**
 * Brief autosave: debounced PATCH with an optimistic version check.
 *
 * - Edits collect in `pending`; after `delay` ms of quiet they are sent in one PATCH.
 * - Only one PATCH is in flight. Edits made meanwhile wait and go in the next PATCH.
 * - `version` and `updatedAt` are read from the query cache at send time, so a save that just
 *   finished never causes a false conflict.
 * - 409 VERSION_CONFLICT: status `conflict`; nothing more is sent until `reload()`.
 */
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import type { Brief, ClaudeSuggestions, ContentMode, Language, Platform, Ratio, UpdateBriefInput } from '@growth-desk/contract';
import { isApiError } from '@/lib/api';
import { makeKeys, useUpdateBrief } from '../api';

export interface BriefEditable {
  title: string;
  mode: ContentMode;
  hook: string | null;
  beats: string[];
  ask: string | null;
  ratios: Ratio[];
  captionLanguages: Language[];
  channels: Platform[];
  ownerId: string | null;
  claimsApproverId: string | null;
  brandApproverId: string | null;
  claudeSuggestions: ClaudeSuggestions;
}

export type BriefPatch = Partial<BriefEditable>;
export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export function editableFromBrief(b: Brief): BriefEditable {
  return {
    title: b.title,
    mode: b.mode,
    hook: b.hook,
    beats: b.beats,
    ask: b.ask,
    ratios: b.ratios,
    captionLanguages: b.captionLanguages,
    channels: b.channels,
    ownerId: b.owner?.id ?? null,
    claimsApproverId: b.claimsApprover?.id ?? null,
    brandApproverId: b.brandApprover?.id ?? null,
    claudeSuggestions: b.claudeSuggestions,
  };
}

export interface BriefAutosave {
  values: BriefEditable;
  status: AutosaveStatus;
  error: unknown;
  /** True while edits are not yet stored on the server. */
  hasUnsaved: boolean;
  update: (patch: BriefPatch, opts?: { immediate?: boolean }) => void;
  flush: () => Promise<void>;
  /** After a conflict: drop local edits and load the server copy. */
  reload: () => Promise<void>;
}

export function useBriefAutosave(brief: Brief, opts: { delay?: number; enabled?: boolean } = {}): BriefAutosave {
  const { delay = 800, enabled = true } = opts;
  const qc = useQueryClient();
  const { mutateAsync } = useUpdateBrief(brief.id);

  // Refs drive the save logic (read in callbacks only); state mirrors them for rendering.
  const pending = React.useRef<BriefPatch>({});
  const inflight = React.useRef<BriefPatch | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = React.useRef<AutosaveStatus>('idle');
  const [view, setView] = React.useState<{ pending: BriefPatch; inflight: BriefPatch | null; status: AutosaveStatus }>({
    pending: {},
    inflight: null,
    status: 'idle',
  });
  const [error, setError] = React.useState<unknown>(null);

  const publish = React.useCallback((status?: AutosaveStatus) => {
    if (status) statusRef.current = status;
    setView({ pending: pending.current, inflight: inflight.current, status: statusRef.current });
  }, []);

  const send = React.useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current || statusRef.current === 'conflict') return;
    // Loop: edits made while a PATCH is in flight go out right after it.
    while (Object.keys(pending.current).length > 0) {
      const patch = pending.current;
      const latest = qc.getQueryData<Brief>(makeKeys.brief(brief.id)) ?? brief;
      inflight.current = patch;
      pending.current = {};
      publish('saving');
      try {
        const body: UpdateBriefInput = { version: latest.version, updatedAt: latest.updatedAt, ...patch };
        await mutateAsync(body);
        inflight.current = null;
        setError(null);
        publish(Object.keys(pending.current).length > 0 ? 'dirty' : 'saved');
      } catch (err) {
        // Put the unsent edits back under any newer ones.
        pending.current = { ...patch, ...pending.current };
        inflight.current = null;
        setError(err);
        publish(isApiError(err) && err.code === 'VERSION_CONFLICT' ? 'conflict' : 'error');
        return;
      }
    }
  }, [brief, qc, mutateAsync, publish]);

  const update = React.useCallback(
    (patch: BriefPatch, o?: { immediate?: boolean }) => {
      if (!enabled) return;
      pending.current = { ...pending.current, ...patch };
      if (statusRef.current === 'conflict') {
        publish();
        return;
      }
      publish(inflight.current ? undefined : 'dirty');
      if (timer.current) clearTimeout(timer.current);
      if (o?.immediate) void send();
      else timer.current = setTimeout(() => void send(), delay);
    },
    [delay, enabled, send, publish],
  );

  const reload = React.useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = {};
    inflight.current = null;
    setError(null);
    await qc.invalidateQueries({ queryKey: makeKeys.brief(brief.id) });
    publish('idle');
  }, [brief.id, qc, publish]);

  // Save what is left when the editor goes away (route change).
  const sendRef = React.useRef(send);
  React.useEffect(() => {
    sendRef.current = send;
  }, [send]);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (Object.keys(pending.current).length > 0 && statusRef.current !== 'conflict') {
        void sendRef.current();
      }
    },
    [],
  );

  const hasUnsaved = Object.keys(view.pending).length > 0 || view.inflight !== null;

  // Warn before closing the tab with unsaved edits.
  React.useEffect(() => {
    if (!hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsaved]);

  const values: BriefEditable = {
    ...editableFromBrief(brief),
    ...(view.inflight ?? {}),
    ...view.pending,
  };

  return { values, status: view.status, error, hasUnsaved, update, flush: send, reload };
}
