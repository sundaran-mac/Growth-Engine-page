/**
 * Claude co-writer logic: ask for drafts, then accept or dismiss each one.
 * Accepting writes through the normal autosave PATCH, so nothing changes without a click.
 */
import * as React from 'react';
import { toast } from 'sonner';
import { ASSIST_KIND_LABELS, type AssistKind, type ClaudeSuggestions } from '@growth-desk/contract';
import { isApiError } from '@/lib/api';
import { useAssist } from '../api';
import { useBriefDrafts, useCowriterStore, type CowriterDraft } from './cowriter-store';
import type { BriefEditable, BriefPatch } from './use-brief-autosave';

/** The change one accepted draft makes, on top of `values`. */
export function patchForDraft(
  values: BriefEditable,
  draft: CowriterDraft,
  /** `keep` stores an alternative hook on the brief instead of making it the hook. */
  mode: 'use' | 'keep' = 'use',
): BriefPatch {
  const s: ClaudeSuggestions = values.claudeSuggestions;
  switch (draft.kind) {
    case 'alt_hooks':
      if (mode === 'use') return { hook: draft.text };
      return s.altHooks.includes(draft.text)
        ? {}
        : { claudeSuggestions: { ...s, altHooks: [...s.altHooks, draft.text], generatedAt: new Date().toISOString() } };
    case 'tamil_caption': {
      const language = draft.language ?? 'ta';
      return {
        claudeSuggestions: {
          ...s,
          captions: [...s.captions.filter((c) => c.language !== language), { language, text: draft.text }],
          generatedAt: new Date().toISOString(),
        },
      };
    }
    case 'broll':
      return s.bRoll.includes(draft.text)
        ? {}
        : { claudeSuggestions: { ...s, bRoll: [...s.bRoll, draft.text], generatedAt: new Date().toISOString() } };
  }
}

/** One line like Figma: "Tamil caption drafted · 3 alternative hooks · B-roll list: a, b". */
export function draftSummary(drafts: CowriterDraft[]): string {
  const parts: string[] = [];
  const captions = drafts.filter((d) => d.kind === 'tamil_caption');
  const hooks = drafts.filter((d) => d.kind === 'alt_hooks');
  const broll = drafts.filter((d) => d.kind === 'broll');
  if (captions.length > 0) parts.push('Tamil caption drafted');
  if (hooks.length > 0) parts.push(`${hooks.length} alternative hook${hooks.length === 1 ? '' : 's'}`);
  if (broll.length > 0) parts.push(`B-roll list: ${broll.map((d) => d.text).join(', ')}`);
  return parts.join(' · ');
}

export function assistErrorMessage(err: unknown): { title: string; description?: string } {
  if (isApiError(err)) {
    if (err.code === 'FEATURE_DISABLED') return { title: 'Claude is not connected', description: 'Connect Claude on Integrations.' };
    if (err.code === 'CLAUDE_CAP_REACHED') return { title: 'Claude budget used up', description: 'This product has used its Claude budget for this month.' };
    return { title: err.title, ...(err.detail ? { description: err.detail } : {}) };
  }
  return { title: 'Claude did not answer', description: 'Please try again.' };
}

export function useCowriter(briefId: string, values: BriefEditable, update: (p: BriefPatch, o?: { immediate?: boolean }) => void) {
  const assist = useAssist(briefId);
  const drafts = useBriefDrafts(briefId);
  const setKind = useCowriterStore((s) => s.setKind);
  const remove = useCowriterStore((s) => s.remove);
  const [pendingKind, setPendingKind] = React.useState<AssistKind | null>(null);

  const ask = React.useCallback(
    async (kind: AssistKind) => {
      setPendingKind(kind);
      try {
        const res = await assist.mutateAsync(kind);
        setKind(
          briefId,
          kind,
          res.suggestions.map((s) => ({ text: s.text, language: s.language })),
        );
        if (res.suggestions.length === 0) toast.info(`Claude had no usable ${ASSIST_KIND_LABELS[kind].toLowerCase()} this time.`);
        if (res.dropped > 0) toast.info(`${res.dropped} draft${res.dropped === 1 ? '' : 's'} dropped: they used never-say words.`);
      } catch (err) {
        const m = assistErrorMessage(err);
        toast.error(m.title, m.description ? { description: m.description } : undefined);
      } finally {
        setPendingKind(null);
      }
    },
    [assist, briefId, setKind],
  );

  const accept = (draft: CowriterDraft) => {
    update(patchForDraft(values, draft), { immediate: true });
    remove(briefId, draft.id);
  };

  /** Apply keeps every draft on the brief; alternative hooks are kept, not swapped in. */
  const applyAll = () => {
    let working = values;
    let patch: BriefPatch = {};
    for (const d of drafts) {
      const p = patchForDraft(working, d, 'keep');
      patch = { ...patch, ...p };
      working = { ...working, ...p };
    }
    update(patch, { immediate: true });
    for (const d of drafts) remove(briefId, d.id);
  };

  const kinds = [...new Set(drafts.map((d) => d.kind))];
  const retry = async () => {
    for (const k of kinds) await ask(k);
  };

  return {
    drafts,
    kinds,
    pendingKind,
    ask,
    accept,
    dismiss: (draft: CowriterDraft) => remove(briefId, draft.id),
    applyAll,
    retry,
  };
}

export type Cowriter = ReturnType<typeof useCowriter>;
