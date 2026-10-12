// Ideas board. Figma frame 240:847. Owned by the IDEAS module.
import { Lightbulb, Plus, Stack } from '@phosphor-icons/react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CONTENT_MODES, CONTENT_MODE_LABELS, type ContentMode, type Idea, type IdeaStatus } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { DURATION, EASE, fadeUp } from '@/components/motion';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState, errorMessage } from '@/components/molecules/ErrorState';
import { Page } from '@/components/templates/Page';
import { Skeleton } from '@/components/ui/skeleton';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { cn } from '@/lib/utils';
import {
  useDeleteIdea,
  useIdeaBoard,
  useIdeas,
  useOpenIdeaAsBrief,
  useParkIdea,
  useStarIdea,
  useUnparkIdea,
} from '@/features/ideas/api';
import { GeneratePanel } from '@/features/ideas/components/GeneratePanel';
import { IdeaCard } from '@/features/ideas/components/IdeaCard';
import { NewIdeaDialog } from '@/features/ideas/components/NewIdeaDialog';
import { ParkDialog } from '@/features/ideas/components/ParkDialog';
import { WeeklyProposalBanner } from '@/features/ideas/components/WeeklyProposalBanner';
import { useIdeasPermissions } from '@/features/ideas/use-permissions';

const SUBTITLE = 'Claude drafts ideas from each product kit and last week’s numbers · you star what to make';

const COLUMNS: { status: IdeaStatus; label: string; empty: string }[] = [
  { status: 'new', label: 'New from Claude', empty: 'No new ideas. Generate some with Claude.' },
  { status: 'starred', label: 'Starred', empty: 'Star the ideas you want to make.' },
  { status: 'briefed', label: 'Briefed', empty: 'Open a starred idea as a brief.' },
  { status: 'parked', label: 'Parked', empty: 'Nothing parked.' },
];

/** Cards across the four columns ease in one after another on first load. */
const BOARD_STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } } };

function isMode(v: string | null): v is ContentMode {
  return v !== null && (CONTENT_MODES as readonly string[]).includes(v);
}

function ModeFilter({ value, onChange }: { value: ContentMode | null; onChange: (m: ContentMode | null) => void }) {
  const chip = (active: boolean) =>
    cn(
      'focus-ring rounded-pill px-2.5 py-1 text-2xs font-semibold transition-colors',
      active ? 'bg-media-canvas text-media-text' : 'bg-surface-card text-ink hover:bg-surface-sunken',
    );
  return (
    <div role="group" aria-label="Filter by mode" className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={value === null} className={chip(value === null)} onClick={() => onChange(null)}>
        All modes
      </button>
      {CONTENT_MODES.map((m) => (
        <button key={m} type="button" aria-pressed={value === m} className={chip(value === m)} onClick={() => onChange(m)}>
          {m} {CONTENT_MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading ideas">
      {COLUMNS.map((c) => (
        <div key={c.status} className="flex flex-col gap-2.5 rounded-[16px] bg-surface-sunken p-3">
          <Skeleton className="h-4 w-28 bg-surface-card" />
          <Skeleton className="h-24 bg-surface-card" />
          <Skeleton className="h-24 bg-surface-card" />
        </div>
      ))}
    </div>
  );
}

export default function IdeasPage() {
  const { product, productId, products, setProductId, isLoading: productsLoading, isError: productsError, error: productsErr, refetch } =
    useSelectedProduct();
  const perms = useIdeasPermissions(productId);
  const [params, setParams] = useSearchParams();
  const modeParam = params.get('mode');
  const mode = isMode(modeParam) ? modeParam : null;
  const navigate = useNavigate();

  const ideas = useIdeas(productId);
  const board = useIdeaBoard(productId);
  const star = useStarIdea();
  const park = useParkIdea();
  const unpark = useUnparkIdea();
  const remove = useDeleteIdea();
  const openBrief = useOpenIdeaAsBrief();

  const [newOpen, setNewOpen] = React.useState(false);
  const [parking, setParking] = React.useState<Idea | null>(null);
  const [deleting, setDeleting] = React.useState<Idea | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const setMode = (m: ContentMode | null) => {
    const next = new URLSearchParams(params);
    if (m) next.set('mode', m);
    else next.delete('mode');
    setParams(next, { replace: true });
  };

  const fail = (err: unknown) => {
    const m = errorMessage(err);
    toast.error(m.title, { description: m.detail ?? 'Please try again.' });
  };

  const columns = React.useMemo(() => {
    const items = (ideas.data?.items ?? []).filter((i) => !mode || i.mode === mode);
    return COLUMNS.map((c) => ({ ...c, items: items.filter((i) => i.status === c.status) }));
  }, [ideas.data, mode]);

  const actions = (
    <>
      {perms.canWrite && productId ? (
        <Button variant="secondary" leftIcon={Plus} onClick={() => setNewOpen(true)}>
          New idea
        </Button>
      ) : null}
      <Button
        onClick={() => {
          panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          panelRef.current?.querySelector<HTMLElement>('button, [role="combobox"]')?.focus();
        }}
        disabled={!productId}
      >
        ✦ Generate ideas
      </Button>
    </>
  );

  if (productsError) {
    return (
      <Page title="Ideas" subtitle={SUBTITLE}>
        <ErrorState error={productsErr} onRetry={() => void refetch()} />
      </Page>
    );
  }
  if (!productsLoading && !product) {
    return (
      <Page title="Ideas" subtitle={SUBTITLE}>
        <EmptyState icon={Stack} title="No products yet" description="Add a product first. Ideas belong to a product." />
      </Page>
    );
  }

  return (
    <Page title="Ideas" subtitle={SUBTITLE} actions={actions}>
      {board.data?.weeklyProposal ? <WeeklyProposalBanner proposal={board.data.weeklyProposal} /> : null}
      <ModeFilter value={mode} onChange={setMode} />

      <div className="grid grid-cols-1 items-start gap-5 min-[1400px]:grid-cols-[minmax(0,1fr)_312px]">
        <div className="min-w-0">
          {ideas.isPending || productsLoading ? (
            <BoardSkeleton />
          ) : ideas.isError ? (
            <ErrorState error={ideas.error} onRetry={() => void ideas.refetch()} retrying={ideas.isFetching} />
          ) : (ideas.data?.total ?? 0) === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="No ideas yet"
              description={`Generate ideas with Claude for ${product?.name ?? 'this product'}, or add one by hand.`}
              action={
                perms.canWrite ? (
                  <Button variant="secondary" leftIcon={Plus} onClick={() => setNewOpen(true)}>
                    New idea
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <LayoutGroup>
            <motion.div
              className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4"
              initial="hidden"
              animate="show"
              variants={BOARD_STAGGER}
            >
              {columns.map((col) => (
                <section
                  key={col.status}
                  aria-label={`${col.label}, ${col.items.length}`}
                  className="flex min-w-0 flex-col gap-2.5 rounded-[16px] bg-surface-sunken p-3"
                >
                  <h2 className="flex items-center gap-1.5 whitespace-nowrap text-2xs">
                    <span className="font-semibold uppercase tracking-[0.08em] text-muted">{col.label}</span>
                    <span className="font-bold text-joy-text">{col.items.length}</span>
                  </h2>
                  {col.items.length === 0 ? (
                    <p className="px-1 pb-1 text-2xs text-muted">{col.empty}</p>
                  ) : null}
                  {/* Cards ease in one after another; when starred, parked or briefed they glide to the new column. */}
                  <ul className={cn('flex flex-col gap-2.5', col.items.length === 0 && 'hidden')}>
                    <AnimatePresence>
                      {col.items.map((idea) => (
                        <motion.li
                          key={idea.id}
                          layoutId={`idea-${idea.id}`}
                          layout="position"
                          variants={fadeUp}
                          exit={{ opacity: 0, scale: 0.97, transition: { duration: DURATION.fast, ease: EASE } }}
                          transition={{ layout: { duration: DURATION.slow, ease: EASE } }}
                        >
                          <IdeaCard
                            idea={idea}
                            canWrite={perms.canWrite}
                            canDelete={perms.canDelete}
                            busy={busyId === idea.id}
                            onStar={(i, starred) =>
                              star.mutate(
                                { idea: i, starred },
                                { onSuccess: () => toast.success(starred ? 'Starred' : 'Moved back to new'), onError: fail },
                              )
                            }
                            onPark={(i) => setParking(i)}
                            onUnpark={(i) =>
                              unpark.mutate({ idea: i }, { onSuccess: () => toast.success('Back in New'), onError: fail })
                            }
                            onOpenBrief={(i) => {
                              setBusyId(i.id);
                              openBrief.mutate(i, {
                                onSuccess: ({ brief }) => {
                                  toast.success(`Brief ${brief.code} created`);
                                  navigate(`/briefs/${brief.id}`);
                                },
                                onError: fail,
                                onSettled: () => setBusyId(null),
                              });
                            }}
                            onDelete={(i) => setDeleting(i)}
                          />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </section>
              ))}
            </motion.div>
            </LayoutGroup>
          )}
        </div>

        <div ref={panelRef} className="w-full max-w-[560px] scroll-mt-6 min-[1400px]:max-w-none">
          {productId ? (
            <GeneratePanel
              key={productId}
              products={products}
              productId={productId}
              board={board.data}
              canWrite={perms.canWrite}
              onGenerated={(id) => {
                if (id !== productId) setProductId(id);
              }}
            />
          ) : (
            <Skeleton className="h-[420px] rounded-card" />
          )}
        </div>
      </div>

      {productId && product ? (
        <NewIdeaDialog open={newOpen} onOpenChange={setNewOpen} productId={productId} productName={product.name} />
      ) : null}
      <ParkDialog
        key={parking?.id ?? 'none'}
        idea={parking}
        onOpenChange={(open) => (open ? undefined : setParking(null))}
        onPark={(idea, reason) =>
          park.mutateAsync({ idea, reason }).then(
            () => toast.success('Parked', { description: reason }),
            (err: unknown) => {
              fail(err);
              throw err;
            },
          )
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this idea?"
        description={deleting ? `“${deleting.title}” will be removed for everyone. This cannot be undone.` : undefined}
        confirmLabel="Delete idea"
        tone="danger"
        onConfirm={() =>
          deleting
            ? remove.mutateAsync(deleting).then(
                () => toast.success('Idea deleted'),
                (err: unknown) => {
                  fail(err);
                  throw err;
                },
              )
            : undefined
        }
      />
    </Page>
  );
}
