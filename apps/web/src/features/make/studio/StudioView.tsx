/**
 * Studio for one brief (Figma 241:990): preview, scene timeline, render jobs, hand-offs, uploads.
 */
import { ArrowRight, CloudArrowUp } from '@phosphor-icons/react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  isBriefMaking,
  LANGUAGE_LABELS,
  type AssetKind,
  type Ratio,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState, errorMessage } from '@/components/molecules/ErrorState';
import { Panel } from '@/components/organisms/Panel';
import { Page } from '@/components/templates/Page';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/session';
import { useBrief, useBriefAssets, useHandoffTools, useMakeFeatures, useSendForReview } from '../api';
import { AssetList } from './AssetList';
import { canSendForReview, pickMaster, PREVIEW_RATIOS, readyVideo } from './helpers';
import { HandoffCard } from './HandoffCard';
import { PreviewPlayer } from './PreviewPlayer';
import { RenderJobsCard } from './RenderJobsCard';
import { SceneTimelineCard } from './SceneTimelineCard';
import { StorageNotConnected } from './StorageNotConnected';
import { UploadDialog } from './UploadDialog';

type StudioTab = 'reel' | 'posters' | 'captions' | 'cutdowns';

const TABS: { value: StudioTab; label: string }[] = [
  { value: 'reel', label: 'Reel' },
  { value: 'posters', label: 'Posters' },
  { value: 'captions', label: 'Captions' },
  { value: 'cutdowns', label: 'Cut-downs' },
];

function pillClass(active: boolean, activeTone: 'dark' | 'joy') {
  return cn(
    'focus-ring inline-flex items-center rounded-pill px-2.5 py-1 text-2xs font-semibold transition-colors',
    active
      ? activeTone === 'dark'
        ? 'bg-media-canvas text-media-text'
        : 'bg-joy text-ink'
      : 'bg-surface-card text-ink hover:bg-surface-sunken',
  );
}

function StudioSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading the studio">
      <Skeleton className="h-7 w-64" />
      <div className="flex gap-5">
        <Skeleton className="h-[375px] w-[300px] rounded-[24px]" />
        <div className="flex flex-1 flex-col gap-4">
          <Skeleton className="h-48 w-full rounded-card" />
          <div className="flex gap-4">
            <Skeleton className="h-44 flex-1 rounded-card" />
            <Skeleton className="h-44 flex-1 rounded-card" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface UploadTarget {
  kind: AssetKind;
  ratio: Ratio | null;
}

export function StudioView({ briefId }: { briefId: string }) {
  const brief = useBrief(briefId);
  const assets = useBriefAssets(briefId);
  const features = useMakeFeatures();
  const tools = useHandoffTools();
  const send = useSendForReview(briefId);
  const role = useSessionStore((s) => s.user?.role);
  const navigate = useNavigate();

  const [tab, setTab] = React.useState<StudioTab>('reel');
  const [ratioChoice, setRatio] = React.useState<Ratio | null>(null);
  const [upload, setUpload] = React.useState<UploadTarget | null>(null);

  const firstRatio = brief.data?.ratios.find((r) => PREVIEW_RATIOS.includes(r));
  const ratio: Ratio = ratioChoice ?? firstRatio ?? '9:16';

  if (brief.isPending) {
    return (
      <Page title="Studio" subtitle="Make it · scene file from the brief · render, voice, captions, cut-downs">
        <StudioSkeleton />
      </Page>
    );
  }
  if (brief.isError) {
    return (
      <Page title="Studio">
        <ErrorState error={brief.error} onRetry={() => void brief.refetch()} retrying={brief.isFetching} />
      </Page>
    );
  }

  const b = brief.data;
  const items = assets.data?.items ?? [];
  const storageOff = features.data?.storage === false;
  const canEdit = isBriefMaking(b.stage) && role !== 'viewer';
  const canUpload = canEdit && !storageOff;
  const master = pickMaster(items, b, ratio);
  const video = readyVideo(items, ratio);
  const capcut = tools.data?.items.find((t) => t.key === 'capcut')?.url ?? null;
  const sendable = canSendForReview(b, items);
  const byKind = (k: AssetKind) => items.filter((a) => a.kind === k);

  async function sendForReview() {
    try {
      await send.mutateAsync(b.version);
      toast.success('Sent for review', {
        description: `${b.code} is now with the team.`,
        action: { label: 'Open review', onClick: () => navigate(`/review/${b.id}`) },
      });
    } catch (err) {
      const m = errorMessage(err);
      toast.error(m.title, { description: m.detail });
    }
  }

  const uploadButton = (kind: AssetKind, label: string, r: Ratio | null = null) =>
    canUpload ? (
      <Button size="sm" variant="secondary" leftIcon={CloudArrowUp} onClick={() => setUpload({ kind, ratio: r })}>
        {label}
      </Button>
    ) : null;

  const readOnlyNote = !isBriefMaking(b.stage) ? (
    <p className="text-13 text-muted" role="status">
      {b.stage === 'brief' || b.stage === 'idea'
        ? 'This brief is not frozen yet. Freeze it on the Brief screen before making.'
        : 'This piece has left the Studio. Files are read only.'}
    </p>
  ) : null;

  const assetsBlock = (kind: AssetKind, layout: 'list' | 'grid', emptyTitle: string, emptyDescription: string) =>
    assets.isPending ? (
      <Skeleton className="h-24 w-full rounded-card" />
    ) : assets.isError ? (
      <ErrorState error={assets.error} onRetry={() => void assets.refetch()} retrying={assets.isFetching} />
    ) : (
      <AssetList
        briefId={b.id}
        assets={byKind(kind)}
        canEdit={canEdit}
        layout={layout}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    );

  return (
    <Page
      title={`Studio · ${b.code}`}
      subtitle="Make it · scene file from the brief · render, voice, captions, cut-downs"
      actions={
        <>
          {capcut ? (
            <Button asChild variant="secondary">
              <a href={capcut} target="_blank" rel="noopener noreferrer">
                Open in CapCut
              </a>
            </Button>
          ) : (
            <Button variant="secondary" disabled title="CapCut link is not set up">
              Open in CapCut
            </Button>
          )}
          {b.stage === 'frozen' ? (
            <Button
              onClick={() => void sendForReview()}
              loading={send.isPending}
              disabled={!sendable || role === 'viewer'}
              title={sendable ? undefined : 'Upload a ready master file first'}
            >
              Send for review
            </Button>
          ) : (
            <Button asChild variant="dark" rightIcon={ArrowRight}>
              <Link to={b.stage === 'brief' || b.stage === 'idea' ? `/briefs/${b.id}` : `/review/${b.id}`}>
                {b.stage === 'brief' || b.stage === 'idea' ? 'Open the brief' : 'Open review'}
              </Link>
            </Button>
          )}
        </>
      }
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as StudioTab)} className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <TabsList className="gap-2 bg-transparent p-0" aria-label="Studio sections">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className={cn(
                  'rounded-pill px-2.5 py-1 text-2xs font-semibold shadow-none data-[state=active]:bg-media-canvas data-[state=active]:text-media-text data-[state=inactive]:bg-surface-card data-[state=inactive]:text-ink',
                )}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {b.stage === 'made' ? <StatusChip tone="care">Sent for review</StatusChip> : null}
          {readOnlyNote}
        </div>

        {storageOff && canEdit ? <StorageNotConnected /> : null}

        <TabsContent value="reel" className="mt-0 flex flex-col gap-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <div className="flex w-[300px] shrink-0 flex-col gap-4">
              <PreviewPlayer
                key={video?.id ?? 'none'}
                asset={video}
                ratio={ratio}
                caption={b.hook}
                canUpload={canUpload}
                onUpload={() => setUpload({ kind: 'video', ratio })}
              />
              <div role="radiogroup" aria-label="Preview ratio" className="flex gap-2">
                {PREVIEW_RATIOS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={ratio === r}
                    onClick={() => setRatio(r)}
                    className={pillClass(ratio === r, 'joy')}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <SceneTimelineCard brief={b} master={master} />
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                <RenderJobsCard briefId={b.id} canEdit={canEdit} />
                <HandoffCard />
              </div>
            </div>
          </div>
          <Panel title={<span className="text-base">Master videos</span>} actions={uploadButton('video', 'Upload master', ratio)}>
            {assetsBlock('video', 'list', 'No master yet', 'Upload the finished reel. Large files upload in parts.')}
          </Panel>
        </TabsContent>

        <TabsContent value="posters" className="mt-0">
          <Panel title={<span className="text-base">Posters</span>} actions={uploadButton('poster', 'Upload poster', b.ratios[0] ?? '4:5')}>
            {assetsBlock('poster', 'grid', 'No posters yet', 'Upload PNG, JPEG or WebP posters, one per ratio.')}
          </Panel>
        </TabsContent>

        <TabsContent value="captions" className="mt-0 flex flex-col gap-5">
          <Panel
            title={<span className="text-base">Captions on the brief</span>}
            description="Accepted on the Brief screen. Read only here."
          >
            {b.claudeSuggestions.captions.length === 0 ? (
              <p className="text-13 text-muted">No captions accepted yet. Draft them with the Claude co-writer on the brief.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {b.claudeSuggestions.captions.map((c, i) => (
                  <li key={`${c.language}-${i}`} className="flex flex-col gap-1 rounded-tile bg-surface-base px-3.5 py-2.5">
                    <span className="text-2xs font-semibold uppercase tracking-kicker text-muted">{LANGUAGE_LABELS[c.language]}</span>
                    <span lang={c.language} className="text-sm text-ink">
                      {c.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={<span className="text-base">Caption files</span>} actions={uploadButton('caption', 'Upload caption file')}>
            {assetsBlock('caption', 'list', 'No caption files yet', 'Upload WebVTT (.vtt) or SubRip (.srt) files.')}
          </Panel>
        </TabsContent>

        <TabsContent value="cutdowns" className="mt-0">
          <Panel title={<span className="text-base">Cut-downs</span>} actions={uploadButton('cutdown', 'Upload cut-down', ratio)}>
            {assets.isSuccess && byKind('cutdown').length === 0 && !canUpload ? (
              <EmptyState title="No cut-downs" description="Cut-downs appear here once a maker uploads them." />
            ) : (
              assetsBlock('cutdown', 'list', 'No cut-downs yet', 'Upload a short version per ratio, for example 9:16 at 15 s.')
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      {upload ? (
        <UploadDialog
          open
          onOpenChange={(o) => !o && setUpload(null)}
          briefId={b.id}
          kind={upload.kind}
          defaultRatio={upload.ratio}
        />
      ) : null}
    </Page>
  );
}
