import { PlugsConnected, Sparkle } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CONTENT_MODES,
  GENERATE_MAX_COUNT,
  PLATFORMS,
  PLATFORM_LABELS,
  type ContentMode,
  type IdeaBoardInfo,
  type Platform,
  type Product,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { DURATION, EASE, fadeUp } from '@/components/motion';
import { errorMessage } from '@/components/molecules/ErrorState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useGenerateIdeas } from '../api';
import { generateSummary, modeLabel } from '../lib';

export interface GeneratePanelProps {
  products: Product[];
  productId: string;
  board: IdeaBoardInfo | undefined;
  canWrite: boolean;
  /** Called with the product the ideas went to (it may differ from the selected one). */
  onGenerated?: (productId: string) => void;
}

const ANY = 'any';
const COUNTS = Array.from({ length: GENERATE_MAX_COUNT }, (_, i) => i + 1);

function Label({ htmlFor, id, children }: { htmlFor?: string; id?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} id={id} className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted">
      {children}
    </label>
  );
}

function formatTokens(n: number): string {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Dark "Generate with Claude" panel (Figma 240:1033). Give it `key={productId}` so it resets when the product changes. */
export function GeneratePanel({ products, productId, board, canWrite, onGenerated }: GeneratePanelProps) {
  const ids = React.useId();
  const [targetId, setTargetId] = React.useState(productId);
  const [mode, setMode] = React.useState<ContentMode | typeof ANY>(ANY);
  const [channels, setChannels] = React.useState<Platform[]>(['instagram', 'youtube']);
  const [count, setCount] = React.useState(10);
  const [blocked, setBlocked] = React.useState<null | 'not_connected' | 'cap'>(null);
  const generate = useGenerateIdeas();

  const notConnected = blocked === 'not_connected' || board?.claude.enabled === false;
  const capReached = blocked === 'cap' || (board ? board.claude.capTokens > 0 && board.claude.usedTokens >= board.claude.capTokens : false);

  function toggleChannel(p: Platform) {
    setChannels((cur) => (cur.includes(p) ? cur.filter((c) => c !== p) : [...cur, p]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    generate.mutate(
      { productId: targetId, mode: mode === ANY ? null : mode, channels, count },
      {
        onSuccess: (res) => {
          setBlocked(null);
          const made = res.items.length;
          toast.success(made === 1 ? '1 new idea from Claude' : `${made} new ideas from Claude`, {
            description: generateSummary(res),
          });
          onGenerated?.(targetId);
        },
        onError: (err) => {
          if (isApiError(err) && err.code === 'FEATURE_DISABLED') return setBlocked('not_connected');
          if (isApiError(err) && err.code === 'CLAUDE_CAP_REACHED') return setBlocked('cap');
          const m = errorMessage(err);
          toast.error(m.title, { description: m.detail ?? 'Please try again.' });
        },
      },
    );
  }

  const disabled = !canWrite || notConnected || capReached || channels.length === 0;

  return (
    <motion.section
      aria-labelledby={`${ids}-title`}
      className="flex w-full flex-col gap-3 rounded-card bg-media-canvas p-6 text-media-text"
      initial="hidden"
      animate="show"
      variants={fadeUp}
    >
      <h2 id={`${ids}-title`} className="flex items-center gap-2.5 text-17 font-bold">
        <Icon icon={Sparkle} size={20} className="text-joy" />
        Generate with Claude
      </h2>

      <AnimatePresence initial={false}>
      {notConnected ? (
        <motion.div
          key="not-connected"
          role="status"
          className="flex flex-col gap-2 overflow-hidden rounded-tile bg-white/10 p-3.5 text-13"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: DURATION.base, ease: EASE }}
        >
          <p className="flex items-center gap-2 font-semibold">
            <Icon icon={PlugsConnected} size={16} /> Claude not connected
          </p>
          <p className="text-media-text/70">Add the Claude key to draft ideas. Nothing is generated until then.</p>
          <Link to="/integrations" className="focus-ring-dark w-fit rounded-sm font-semibold text-joy underline-offset-2 hover:underline">
            Open Integrations
          </Link>
        </motion.div>
      ) : null}

      {!notConnected && capReached ? (
        <motion.p
          key="cap"
          role="status"
          className="overflow-hidden rounded-tile bg-white/10 p-3.5 text-13"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: DURATION.base, ease: EASE }}
        >
          This product used its Claude budget for this month. Ask an admin to raise the cap in Settings.
        </motion.p>
      ) : null}
      </AnimatePresence>

      <form onSubmit={submit} className="flex flex-col gap-3" aria-describedby={`${ids}-reads`}>
        <Label htmlFor={`${ids}-product`}>Product</Label>
        <Select value={targetId} onValueChange={setTargetId} disabled={!canWrite}>
          <SelectTrigger id={`${ids}-product`} className="h-10 rounded-[10px] border-0 font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Label htmlFor={`${ids}-mode`}>Mode</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as ContentMode | typeof ANY)} disabled={!canWrite}>
          <SelectTrigger id={`${ids}-mode`} className="h-10 rounded-[10px] border-0 font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any mode</SelectItem>
            {CONTENT_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {modeLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span id={`${ids}-channels`}>
          <Label>Channels</Label>
        </span>
        <div role="group" aria-labelledby={`${ids}-channels`} className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => {
            const on = channels.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                disabled={!canWrite}
                onClick={() => toggleChannel(p)}
                className={cn(
                  'focus-ring-dark rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
                  on ? 'bg-surface-card text-ink' : 'bg-white/10 text-media-text hover:bg-white/20',
                )}
              >
                {PLATFORM_LABELS[p]}
              </button>
            );
          })}
        </div>
        <AnimatePresence initial={false}>
          {channels.length === 0 ? (
            <motion.p
              key="no-channel"
              className="text-xs text-joy"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast, ease: EASE }}
            >
              Pick at least one channel.
            </motion.p>
          ) : null}
        </AnimatePresence>

        <Label htmlFor={`${ids}-count`}>How many</Label>
        <Select value={String(count)} onValueChange={(v) => setCount(Number(v))} disabled={!canWrite}>
          <SelectTrigger id={`${ids}-count`} className="h-10 rounded-[10px] border-0 font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n === 1 ? '1 idea' : `${n} ideas`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p id={`${ids}-reads`} className="text-xs text-media-text">
          Claude reads: the product kit, the never-say list, last week’s value scores, the occasions calendar, ideas
          already used.
        </p>
        {board && board.claude.enabled && board.claude.capTokens > 0 ? (
          <p className="text-2xs text-media-text/60">
            Used {formatTokens(board.claude.usedTokens)} of {formatTokens(board.claude.capTokens)} tokens this month.
          </p>
        ) : null}
        {!canWrite ? <p className="text-2xs text-media-text/60">You can see ideas but not generate them for this product.</p> : null}

        <Button type="submit" loading={generate.isPending} disabled={disabled} className="w-fit">
          {generate.isPending ? 'Claude is writing' : count === 1 ? 'Generate 1 idea' : `Generate ${count} ideas`}
        </Button>
      </form>
    </motion.section>
  );
}
