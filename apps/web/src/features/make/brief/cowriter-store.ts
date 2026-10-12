/**
 * Claude co-writer drafts waiting for a decision (UI state only; the server does not store them).
 * Keyed by brief id so switching briefs keeps each brief's drafts apart.
 */
import { create } from 'zustand';
import type { AssistKind, Language } from '@growth-desk/contract';

export interface CowriterDraft {
  id: string;
  kind: AssistKind;
  text: string;
  language: Language | null;
}

interface CowriterState {
  drafts: Record<string, CowriterDraft[]>;
  /** Replaces the drafts of one kind with a new batch. */
  setKind: (briefId: string, kind: AssistKind, items: Omit<CowriterDraft, 'id' | 'kind'>[]) => void;
  remove: (briefId: string, draftId: string) => void;
  clear: (briefId: string) => void;
}

let counter = 0;

export const useCowriterStore = create<CowriterState>()((set) => ({
  drafts: {},
  setKind: (briefId, kind, items) =>
    set((s) => ({
      drafts: {
        ...s.drafts,
        [briefId]: [
          ...(s.drafts[briefId] ?? []).filter((d) => d.kind !== kind),
          ...items.map((it) => ({ ...it, kind, id: `draft-${++counter}` })),
        ],
      },
    })),
  remove: (briefId, draftId) =>
    set((s) => ({
      drafts: { ...s.drafts, [briefId]: (s.drafts[briefId] ?? []).filter((d) => d.id !== draftId) },
    })),
  clear: (briefId) =>
    set((s) => {
      const next = { ...s.drafts };
      delete next[briefId];
      return { drafts: next };
    }),
}));

const EMPTY: CowriterDraft[] = [];
export function useBriefDrafts(briefId: string): CowriterDraft[] {
  return useCowriterStore((s) => s.drafts[briefId] ?? EMPTY);
}
