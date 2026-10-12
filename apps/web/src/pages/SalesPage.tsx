// Sales (Figma frame 242:1486). Owned by the INSIGHTS agent.
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { LEAD_BOARD_STAGES, type LeadStage, type LeadView } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Panel } from '@/components/organisms/Panel';
import { Page } from '@/components/templates/Page';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { useSessionStore } from '@/stores/session';
import { useLeads, useMoveLead } from '@/features/insights/api';
import { KeywordRepliesSheet } from '@/features/insights/components/KeywordRepliesSheet';
import { LeadDetailPanel } from '@/features/insights/components/LeadDetailPanel';
import { LeadFormDialog, LogActivityDialog } from '@/features/insights/components/LeadDialogs';
import { SalesBoard } from '@/features/insights/components/SalesBoard';
import { useCanEditLeads } from '@/features/insights/permissions';

const ALL = 'all';

export default function SalesPage() {
  const selected = useSelectedProduct();
  const [params, setParams] = useSearchParams();
  const [productFilter, setProductFilter] = React.useState<string>(ALL);
  const [showLost, setShowLost] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState<'new' | 'edit' | null>(null);
  const [logOpen, setLogOpen] = React.useState(false);

  const productId = productFilter === ALL ? null : productFilter;
  const leads = useLeads(productId, showLost);
  const move = useMoveLead();
  const user = useSessionStore((s) => s.user);
  const memberships = useSessionStore((s) => s.memberships);
  const canAddAny = useCanEditLeads(null);

  const keywordsOpen = params.get('panel') === 'keywords';
  const setKeywordsOpen = (open: boolean) => {
    const next = new URLSearchParams(params);
    if (open) next.set('panel', 'keywords');
    else next.delete('panel');
    setParams(next, { replace: true });
  };

  const items = React.useMemo(() => leads.data?.items ?? [], [leads.data]);
  const stages: readonly LeadStage[] = showLost
    ? [...LEAD_BOARD_STAGES, 'lost']
    : LEAD_BOARD_STAGES;
  const lead = items.find((l) => l.id === selectedId) ?? items[0] ?? null;

  const canEdit = React.useCallback(
    (l: Pick<LeadView, 'productId'>) => {
      if (!user || user.role === 'viewer') return false;
      if (user.role === 'admin' || user.role === 'editor') return true;
      return memberships.some((m) => m.productId === l.productId);
    },
    [user, memberships],
  );

  const doMove = (l: LeadView, to: LeadStage) =>
    move.mutate({ id: l.id, input: { stage: to }, from: l.stage });

  return (
    <Page
      title="Sales pipeline"
      subtitle="Partner leads from content, every product · no prices in the tool"
      actions={
        <>
          <Button variant="secondary" onClick={() => setKeywordsOpen(true)}>
            Keyword replies
          </Button>
          {canAddAny ? <Button onClick={() => setFormOpen('new')}>+ Add lead</Button> : null}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="sales-product" className="text-13 text-muted">
            Product
          </Label>
          <Select value={productFilter} onValueChange={setProductFilter}>
            <SelectTrigger id="sales-product" className="h-9 w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All products</SelectItem>
              {selected.products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="sales-lost" checked={showLost} onCheckedChange={setShowLost} />
          <Label htmlFor="sales-lost" className="text-13 text-muted">
            Show lost
          </Label>
        </div>
      </div>

      {leads.isError ? (
        <ErrorState
          error={leads.error}
          onRetry={() => void leads.refetch()}
          retrying={leads.isFetching}
        />
      ) : leads.isPending ? (
        <div className="flex gap-3" aria-busy="true">
          {LEAD_BOARD_STAGES.slice(0, 4).map((s) => (
            <Skeleton key={s} className="h-48 w-[170px] rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No leads yet"
          description="Keyword replies and tracked links add leads on their own. You can also add one by hand."
          action={
            canAddAny ? <Button onClick={() => setFormOpen('new')}>+ Add lead</Button> : undefined
          }
        />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <SalesBoard
              stages={stages}
              leads={items}
              selectedId={lead?.id ?? null}
              canMove={canEdit}
              onSelect={setSelectedId}
              onMove={doMove}
            />
          </div>
          {lead ? (
            <LeadDetailPanel
              lead={lead}
              canEdit={canEdit(lead)}
              moving={move.isPending}
              onMove={(to) => doMove(lead, to)}
              onLog={() => setLogOpen(true)}
              onEdit={() => setFormOpen('edit')}
            />
          ) : (
            <Panel>
              <p className="text-sm text-muted">Pick a lead to see its details.</p>
            </Panel>
          )}
        </div>
      )}

      <LeadFormDialog
        open={formOpen !== null}
        onOpenChange={(o) => !o && setFormOpen(null)}
        products={selected.products}
        defaultProductId={productId ?? selected.productId}
        lead={formOpen === 'edit' ? lead : null}
        onSaved={(l) => setSelectedId(l.id)}
      />
      {lead ? <LogActivityDialog open={logOpen} onOpenChange={setLogOpen} lead={lead} /> : null}
      <KeywordRepliesSheet
        open={keywordsOpen}
        onOpenChange={setKeywordsOpen}
        productId={selected.productId}
        productName={selected.product?.name}
      />
    </Page>
  );
}
