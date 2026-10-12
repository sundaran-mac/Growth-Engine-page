import { Check, Sparkle, X } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import {
  ASSIST_KIND_LABELS,
  ASSIST_KINDS,
  LANGUAGE_LABELS,
  type AssistKind,
  type ClaudeSuggestions,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { IconButton } from '@/components/atoms/IconButton';
import { Kicker } from '@/components/atoms/Kicker';
import { DURATION, EASE } from '@/components/motion';
import { Panel } from '@/components/organisms/Panel';
import { draftSummary, type Cowriter } from './use-cowriter';

const askLabel: Record<AssistKind, string> = {
  tamil_caption: 'Tamil caption',
  alt_hooks: 'Alt hooks',
  broll: 'B-roll',
};

export interface CowriterPanelProps {
  cowriter: Cowriter;
  suggestions: ClaudeSuggestions;
  /** False when the brief is frozen or later: drafts cannot be applied. */
  editable: boolean;
  /** False when Claude has no API key. */
  claudeEnabled: boolean;
  onUseHook: (text: string) => void;
}

/** New drafts ease in one after another; a dismissed or accepted draft fades out. */
const draftMotion = (i: number) =>
  ({
    initial: { opacity: 0, y: 6 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: DURATION.base, ease: EASE, delay: Math.min(i, 6) * 0.05 },
    },
    exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE } },
  }) as const;

/**
 * Figma 240:1489: dark panel (16px title, sparkle, 13px summary, Apply pill and Try again).
 * Drafts wait for Accept or Dismiss; kept items show below.
 */
export function CowriterPanel({
  cowriter,
  suggestions,
  editable,
  claudeEnabled,
  onUseHook,
}: CowriterPanelProps) {
  const { drafts, pendingKind } = cowriter;
  const kept =
    suggestions.captions.length > 0 ||
    suggestions.bRoll.length > 0 ||
    suggestions.altHooks.length > 0;

  return (
    <Panel
      tone="dark"
      title="Claude co-writer"
      titleSize="sm"
      titleIcon={<Icon icon={Sparkle} size={18} className="text-joy" />}
      aria-busy={pendingKind ? true : undefined}
    >
      {!claudeEnabled ? (
        <p className="text-13">
          Claude is not connected.{' '}
          <Link
            to="/integrations"
            className="focus-ring-dark font-semibold text-joy underline-offset-2 hover:underline"
          >
            Connect it on Integrations
          </Link>
          .
        </p>
      ) : null}

      {drafts.length > 0 ? (
        <>
          <p className="text-13">{draftSummary(drafts)}</p>
          <ul aria-label="Claude drafts" className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {drafts.map((d, i) => (
                <motion.li
                  key={d.id}
                  layout="position"
                  {...draftMotion(i)}
                  className="flex items-start gap-2 rounded-tile bg-white/5 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs font-semibold uppercase tracking-kicker text-media-text/60">
                      {ASSIST_KIND_LABELS[d.kind]}
                      {d.language ? ` · ${LANGUAGE_LABELS[d.language]}` : ''}
                    </p>
                    <p className="text-13" lang={d.language ?? undefined}>
                      {d.text}
                    </p>
                  </div>
                  <IconButton
                    icon={Check}
                    label={d.kind === 'alt_hooks' ? `Use as hook: ${d.text}` : `Accept: ${d.text}`}
                    variant="dark"
                    size="sm"
                    disabled={!editable}
                    onClick={() => cowriter.accept(d)}
                  />
                  <IconButton
                    icon={X}
                    label={`Dismiss: ${d.text}`}
                    variant="dark"
                    size="sm"
                    onClick={() => cowriter.dismiss(d)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="md" onClick={cowriter.applyAll} disabled={!editable}>
              Apply
            </Button>
            <Button
              variant="ghost"
              className="text-media-text hover:bg-white/10"
              loading={pendingKind !== null}
              disabled={!claudeEnabled || !editable}
              onClick={() => void cowriter.retry()}
            >
              Try again
            </Button>
          </div>
        </>
      ) : claudeEnabled ? (
        <p className="text-13 text-media-text/80">
          {editable
            ? 'Ask for a Tamil caption, alternative hooks or a B-roll list. You choose what to keep.'
            : 'This brief is frozen. Claude drafts are off.'}
        </p>
      ) : null}

      {claudeEnabled && editable ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ask Claude for">
          {ASSIST_KINDS.map((k) => (
            <Button
              key={k}
              variant="ghost"
              size="sm"
              className="border border-white/20 text-media-text hover:bg-white/10"
              loading={pendingKind === k}
              disabled={pendingKind !== null}
              onClick={() => void cowriter.ask(k)}
            >
              {askLabel[k]}
            </Button>
          ))}
        </div>
      ) : null}

      {kept ? (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
          <Kicker as="h3" className="text-media-text/60">
            Kept on this brief
          </Kicker>
          {suggestions.captions.map((c) => (
            <p key={c.language} className="text-13" lang={c.language}>
              <span className="font-semibold">{LANGUAGE_LABELS[c.language]} caption: </span>
              {c.text}
            </p>
          ))}
          {suggestions.bRoll.length > 0 ? (
            <p className="text-13">
              <span className="font-semibold">B-roll: </span>
              {suggestions.bRoll.join(', ')}
            </p>
          ) : null}
          {suggestions.altHooks.length > 0 ? (
            <ul aria-label="Alternative hooks" className="flex flex-col gap-1.5">
              {suggestions.altHooks.map((h) => (
                <li key={h} className="flex items-start gap-2 text-13">
                  <span className="min-w-0 flex-1">{h}</span>
                  {editable ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-joy"
                      onClick={() => onUseHook(h)}
                      aria-label={`Use as hook: ${h}`}
                    >
                      Use
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
