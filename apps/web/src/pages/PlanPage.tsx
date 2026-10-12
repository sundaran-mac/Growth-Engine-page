// Plan: the month on a calendar. Figma frame 240:1053. Owned by the IDEAS module.
import { CalendarBlank, CaretLeft, CaretRight, LockSimple, LockSimpleOpen, Stack } from '@phosphor-icons/react';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { PlanItemView } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { IconButton } from '@/components/atoms/IconButton';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState, errorMessage } from '@/components/molecules/ErrorState';
import { Page } from '@/components/templates/Page';
import { Skeleton } from '@/components/ui/skeleton';
import { useSelectedProduct } from '@/lib/use-selected-product';
import {
  useCreatePlan,
  useFreezePlan,
  useOccasions,
  usePlan,
  usePlanChecks,
  useStarredIdeas,
  useUnfreezePlan,
  useUpdatePlanItem,
} from '@/features/ideas/api';
import { PlanCalendar } from '@/features/ideas/components/PlanCalendar';
import { PlanItemDialog, type PlanItemDialogState } from '@/features/ideas/components/PlanItemDialog';
import { AddOccasionDialog, MixCheckPanel, OccasionsPanel, ThingsToFixPanel } from '@/features/ideas/components/PlanSidePanels';
import { addMonths, defaultPlanMonth, isMonthKey, longDate, monthBounds, monthName, monthTitle } from '@/features/ideas/lib';
import { useIdeasPermissions } from '@/features/ideas/use-permissions';

function frozenLine(frozenAt: string | null, by: string | null): string {
  if (!frozenAt) return 'Frozen';
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(frozenAt));
  return by ? `Frozen on ${day} by ${by}` : `Frozen on ${day}`;
}

export default function PlanPage() {
  const { product, productId, isLoading: productsLoading, isError: productsError, error: productsErr, refetch } = useSelectedProduct();
  const perms = useIdeasPermissions(productId);
  const [params, setParams] = useSearchParams();
  const monthParam = params.get('month');
  const month = isMonthKey(monthParam) ? monthParam : defaultPlanMonth();
  const { from, to } = monthBounds(month);

  const planQuery = usePlan(productId, month);
  const plan = planQuery.data?.plan ?? null;
  const checks = usePlanChecks(plan?.id ?? null);
  const occasions = useOccasions(from, to, productId);
  const starred = useStarredIdeas(productId);
  const createPlan = useCreatePlan();
  const freeze = useFreezePlan();
  const unfreeze = useUnfreezePlan();
  const move = useUpdatePlanItem(productId ?? 'none', month);

  const [dialog, setDialog] = React.useState<PlanItemDialogState>(null);
  const [freezeOpen, setFreezeOpen] = React.useState(false);
  const [unfreezeOpen, setUnfreezeOpen] = React.useState(false);
  const [occasionOpen, setOccasionOpen] = React.useState(false);
  const mixRef = React.useRef<HTMLElement>(null);

  const setMonth = (m: string) => {
    const next = new URLSearchParams(params);
    next.set('month', m);
    setParams(next, { replace: true });
  };

  const fail = (err: unknown) => {
    const m = errorMessage(err);
    toast.error(m.title, { description: m.detail ?? 'Please try again.' });
  };

  const frozen = plan?.status === 'frozen';
  const editable = Boolean(plan) && !frozen && perms.canWrite;
  const pieces = plan?.items.length ?? 0;
  const toBrief = plan?.items.filter((i) => i.ideaId && !i.briefId).length ?? 0;
  const productName = product?.name ?? 'Product';

  const title = `${monthName(month)} plan · ${productName}`;
  const subtitle = planQuery.isPending
    ? 'Loading the plan'
    : !plan
    ? 'No plan yet · freeze locks it for briefs'
    : frozen
      ? `${frozenLine(plan.frozenAt, plan.frozenBy?.name ?? null)} · ${pieces} ${pieces === 1 ? 'piece' : 'pieces'} · locked for briefs`
      : `Draft · ${pieces} ${pieces === 1 ? 'piece' : 'pieces'} · freeze locks it for briefs`;

  const monthNav = (
    <div className="mb-3 flex items-center gap-2" role="group" aria-label="Change month">
      <IconButton
        icon={CaretLeft}
        size="sm"
        label={`Previous month, ${monthTitle(addMonths(month, -1))}`}
        onClick={() => setMonth(addMonths(month, -1))}
      />
      <p className="min-w-[132px] text-center text-sm font-semibold text-ink" aria-live="polite">
        {monthTitle(month)}
      </p>
      <IconButton
        icon={CaretRight}
        size="sm"
        label={`Next month, ${monthTitle(addMonths(month, 1))}`}
        onClick={() => setMonth(addMonths(month, 1))}
      />
    </div>
  );

  const actions = (
    <>
      {plan ? (
        <Button
          variant="secondary"
          onClick={() => {
            mixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            mixRef.current?.focus({ preventScroll: true });
          }}
        >
          Mix check
        </Button>
      ) : null}
      {plan && !frozen && perms.canFreeze ? (
        <Button onClick={() => setFreezeOpen(true)}>
          Freeze month
        </Button>
      ) : null}
      {plan && frozen && perms.canUnfreeze ? (
        <Button variant="secondary" leftIcon={LockSimpleOpen} onClick={() => setUnfreezeOpen(true)}>
          Unfreeze
        </Button>
      ) : null}
    </>
  );

  if (productsError) {
    return (
      <Page title="Plan" subtitle="The month, on a calendar">
        <ErrorState error={productsErr} onRetry={() => void refetch()} />
      </Page>
    );
  }
  if (!productsLoading && !product) {
    return (
      <Page title="Plan" subtitle="The month, on a calendar">
        <EmptyState icon={Stack} title="No products yet" description="Add a product first. Each product has its own plan." />
      </Page>
    );
  }

  return (
    <Page title={title} documentTitle={`${monthName(month)} plan`} subtitle={subtitle} actions={actions}>
      {frozen ? (
        <div role="status" className="flex items-center gap-2 text-13 text-muted">
          <StatusChip tone="dark" icon={LockSimple}>
            Frozen
          </StatusChip>
          Pieces cannot move. Briefs were made for every piece that came from an idea.
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_292px]">
        <div className="min-w-0 rounded-card border border-hairline bg-surface-card p-4">
          {monthNav}
          {planQuery.isPending || productsLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the plan">
              <Skeleton className="h-5" />
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[128px]" />
              ))}
            </div>
          ) : planQuery.isError ? (
            <ErrorState error={planQuery.error} onRetry={() => void planQuery.refetch()} retrying={planQuery.isFetching} />
          ) : !plan ? (
            <EmptyState
              bordered={false}
              icon={CalendarBlank}
              title={`No ${monthName(month)} plan yet`}
              description={`Start the month for ${productName}, then add pieces from starred ideas.`}
              action={
                perms.canWrite && productId ? (
                  <Button
                    loading={createPlan.isPending}
                    onClick={() =>
                      createPlan.mutate(
                        { productId, month },
                        { onSuccess: () => toast.success(`${monthTitle(month)} plan started`), onError: fail },
                      )
                    }
                  >
                    Start the {monthName(month)} plan
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <PlanCalendar
              month={month}
              items={plan.items}
              occasions={occasions.data?.items ?? []}
              editable={editable}
              onAdd={(date) => setDialog({ kind: 'add', date })}
              onOpenItem={(item: PlanItemView) => setDialog({ kind: 'edit', item })}
              onMove={(item, date) =>
                move.mutate(
                  { itemId: item.id, input: { date } },
                  { onSuccess: () => toast.success('Moved', { description: `${item.title} · ${longDate(date)}` }), onError: fail },
                )
              }
            />
          )}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Plan checks">
          {plan ? (
            <>
              <MixCheckPanel ref={mixRef} checks={checks.data} loading={checks.isPending} />
              <OccasionsPanel
                occasions={occasions.data?.items ?? []}
                loading={occasions.isPending}
                canAdd={perms.canAddOccasion}
                onAdd={() => setOccasionOpen(true)}
              />
              {checks.isError ? (
                <ErrorState error={checks.error} onRetry={() => void checks.refetch()} />
              ) : (
                <ThingsToFixPanel checks={checks.data} loading={checks.isPending} />
              )}
            </>
          ) : (
            <OccasionsPanel
              occasions={occasions.data?.items ?? []}
              loading={occasions.isPending}
              canAdd={perms.canAddOccasion}
              onAdd={() => setOccasionOpen(true)}
            />
          )}
        </aside>
      </div>

      {plan && productId ? (
        <PlanItemDialog
          state={dialog}
          onClose={() => setDialog(null)}
          planId={plan.id}
          productId={productId}
          month={month}
          starredIdeas={starred.data?.items ?? []}
          editable={editable}
        />
      ) : null}

      <ConfirmDialog
        open={freezeOpen}
        onOpenChange={setFreezeOpen}
        title={`Freeze the ${monthName(month)} plan?`}
        description={
          toBrief > 0
            ? `Pieces lock in place, and ${toBrief === 1 ? '1 brief is' : `${toBrief} briefs are`} made from the ideas on the plan. Only an admin can unfreeze.`
            : 'Pieces lock in place. Only an admin can unfreeze.'
        }
        confirmLabel="Freeze month"
        onConfirm={() =>
          plan
            ? freeze.mutateAsync(plan.id).then(
                (res) =>
                  toast.success(`${monthName(month)} plan frozen`, {
                    description:
                      res.briefsCreated > 0
                        ? `${res.briefsCreated === 1 ? '1 brief' : `${res.briefsCreated} briefs`} made. Find them in Briefs.`
                        : 'No new briefs were needed.',
                  }),
                (err: unknown) => {
                  fail(err);
                  throw err;
                },
              )
            : undefined
        }
      />
      <ConfirmDialog
        open={unfreezeOpen}
        onOpenChange={setUnfreezeOpen}
        title={`Unfreeze the ${monthName(month)} plan?`}
        description="The plan becomes a draft again and pieces can move. Briefs already made stay. This is logged."
        confirmLabel="Unfreeze"
        tone="danger"
        onConfirm={() =>
          plan
            ? unfreeze.mutateAsync(plan.id).then(
                () => toast.success('Plan is a draft again'),
                (err: unknown) => {
                  fail(err);
                  throw err;
                },
              )
            : undefined
        }
      />
      {productId && occasionOpen ? (
        <AddOccasionDialog
          open={occasionOpen}
          onOpenChange={setOccasionOpen}
          productId={productId}
          productName={productName}
          defaultDate={from}
        />
      ) : null}
    </Page>
  );
}
