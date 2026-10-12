/**
 * Content memory size (BUILD-PLAN section 11): every idea, brief hook, published caption and
 * dropped Claude draft, for all products. Read only. Placeholder design until Settings is designed.
 */
import { Brain } from '@phosphor-icons/react';
import { Icon } from '@/components/atoms/Icon';
import { ErrorState } from '@/components/molecules/ErrorState';
import { StatTile } from '@/components/molecules/StatTile';
import { Panel } from '@/components/organisms/Panel';
import { useMemoryStats } from '@/features/ideas/memory';
import { formatDateTime } from '../format';

const count = (n: number) => new Intl.NumberFormat('en-IN').format(n);
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function MemoryPanel() {
  const stats = useMemoryStats();
  const s = stats.data;
  const loading = stats.isPending;

  return (
    <Panel
      title="Content memory"
      titleIcon={<Icon icon={Brain} size={20} className="text-joy" />}
      description="Every idea, brief hook and published caption, for all products. Claude and people cannot repeat one, even years later."
    >
      {stats.isError ? (
        <ErrorState
          title="Could not load the memory size"
          error={stats.error}
          onRetry={() => void stats.refetch()}
          retrying={stats.isFetching}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Remembered" value={s ? count(s.total) : '0'} loading={loading} />
            <StatTile
              label="Ideas"
              value={s ? count(s.bySourceType.idea) : '0'}
              loading={loading}
            />
            <StatTile
              label="Brief hooks"
              value={s ? count(s.bySourceType.brief_hook) : '0'}
              loading={loading}
            />
            <StatTile
              label="Captions"
              value={s ? count(s.bySourceType.post_caption) : '0'}
              delta={
                s ? `${count(s.bySourceType.dropped_draft)} Claude repeats dropped` : undefined
              }
              deltaTone="muted"
              loading={loading}
            />
          </div>
          {s ? (
            <dl className="grid gap-2 text-13 md:grid-cols-[180px_1fr]">
              <dt className="font-semibold">Meaning check</dt>
              <dd className="text-muted">
                {s.embeddings.enabled
                  ? `On (${s.embeddings.model ?? 'Voyage'}). ${count(s.withEmbedding)} of ${count(s.total)} rows have an embedding.`
                  : 'Off. Add VOYAGE_API_KEY to catch the same idea in other words. Same-words and similar-words checks still run.'}
              </dd>
              <dt className="font-semibold">Thresholds</dt>
              <dd className="text-muted">
                Words: repeat at {pct(s.thresholds.textDuplicate)}, similar at{' '}
                {pct(s.thresholds.textSimilar)}. Meaning: repeat at{' '}
                {pct(s.thresholds.meaningDuplicate)}, similar at {pct(s.thresholds.meaningSimilar)}.
              </dd>
              <dt className="font-semibold">Last added</dt>
              <dd className="text-muted">
                {s.lastAddedAt ? formatDateTime(s.lastAddedAt) : 'Nothing yet'}
              </dd>
            </dl>
          ) : null}
        </>
      )}
    </Panel>
  );
}
