/**
 * Settings screen for the product chosen in the sidebar switcher.
 * Tabs live in the URL (?tab=). Switching product reloads that product's settings and resets
 * the forms; with unsaved changes the user is asked first (switch, tab change, leaving the page).
 *
 * PLACEHOLDER DESIGN: there is no Figma frame for Settings yet. Built in the house style of the
 * Products and Plan frames until Jeeva designs it.
 */
import { GearSix } from '@phosphor-icons/react';
import * as React from 'react';
import { useBlocker, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { ProductDot } from '@/components/molecules/ProductDot';
import { Page } from '@/components/templates/Page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { useProductSettings } from '../api';
import { ApprovalsTab } from './ApprovalsTab';
import { ChannelsTab } from './ChannelsTab';
import { ClaudeTab } from './ClaudeTab';
import { GeneralTab } from './GeneralTab';
import { KnowledgeTab } from './KnowledgeTab';
import { PostingTab } from './PostingTab';
import { TabSkeleton } from './shared';
import { DirtyProvider } from '../draft';
import { isSettingsTab as isTab, SETTINGS_TABS, type SettingsTabId } from '../tabs';
import { TrackingTab } from './TrackingTab';

export function SettingsScreen() {
  const { product, productId, products, setProductId, isLoading, isError, error, refetch } =
    useSelectedProduct();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: SettingsTabId = isTab(raw) ? raw : 'general';

  /* ----- unsaved changes ----- */
  const [dirtyMap, setDirtyMap] = React.useState<Record<string, boolean>>({});
  const report = React.useCallback((key: string, dirty: boolean) => {
    setDirtyMap((m) => (Boolean(m[key]) === dirty ? m : { ...m, [key]: dirty }));
  }, []);
  const dirty = Object.values(dirtyMap).some(Boolean);

  // Tab changes and leaving the page are navigations: block them while forms hold changes.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );

  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // The product the forms belong to. It follows the switcher, but asks first when dirty.
  const [formProductId, setFormProductId] = React.useState<string | null>(productId);
  const [pendingProductId, setPendingProductId] = React.useState<string | null>(null);
  const [seenProductId, setSeenProductId] = React.useState<string | null>(productId);
  if (productId !== seenProductId) {
    // The switcher changed (adjusting state during render, no effect needed).
    setSeenProductId(productId);
    if (productId === formProductId) setPendingProductId(null);
    else if (!formProductId || !dirty) setFormProductId(productId);
    else setPendingProductId(productId);
  }

  // ConfirmDialog calls onOpenChange(false) after onConfirm; these flags tell the two apart.
  const confirmedSwitch = React.useRef(false);
  const confirmedLeave = React.useRef(false);

  const settings = useProductSettings(formProductId);
  const formProduct = products.find((p) => p.id === formProductId) ?? product;
  const pendingProduct = products.find((p) => p.id === pendingProductId);

  const onTabChange = (next: string) => {
    if (!isTab(next) || next === tab) return;
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('tab', next);
        return out;
      },
      { replace: false },
    );
  };

  /* ----- states ----- */
  let body: React.ReactNode;
  if (isLoading) body = <TabSkeleton />;
  else if (isError) body = <ErrorState error={error} onRetry={() => void refetch()} />;
  else if (!formProductId || !formProduct) {
    body = (
      <EmptyState
        icon={GearSix}
        title="No products yet"
        description="Add a product on the Products screen first."
      />
    );
  } else if (settings.isPending) body = <TabSkeleton />;
  else if (settings.isError) {
    body = (
      <ErrorState
        error={settings.error}
        onRetry={() => void settings.refetch()}
        retrying={settings.isFetching}
      />
    );
  } else {
    const s = settings.data;
    body = (
      <Tabs value={tab} onValueChange={onTabChange} className="flex flex-col">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="Settings sections" className="w-max">
            {SETTINGS_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {/* key: switching product remounts the forms, so no state leaks between products. */}
        <div key={formProductId}>
          <TabsContent value="general">
            <GeneralTab productId={formProductId} canEdit={s.canEdit} />
          </TabsContent>
          <TabsContent value="knowledge">
            <KnowledgeTab productId={formProductId} settings={s} />
          </TabsContent>
          <TabsContent value="schedule">
            <PostingTab productId={formProductId} settings={s} />
          </TabsContent>
          <TabsContent value="channels">
            <ChannelsTab productId={formProductId} settings={s} />
          </TabsContent>
          <TabsContent value="claude">
            <ClaudeTab productId={formProductId} settings={s} />
          </TabsContent>
          <TabsContent value="approvals">
            <ApprovalsTab productId={formProductId} settings={s} />
          </TabsContent>
          <TabsContent value="tracking">
            <TrackingTab settings={s} />
          </TabsContent>
        </div>
      </Tabs>
    );
  }

  return (
    <Page
      title="Settings"
      documentTitle="Settings"
      subtitle={
        formProduct ? (
          <span className="inline-flex items-center gap-2">
            <ProductDot color={formProduct.color} />
            Settings for {formProduct.name}. Change the product in the switcher.
          </span>
        ) : (
          'Settings for the product chosen in the switcher'
        )
      }
    >
      <DirtyProvider value={report}>{body}</DirtyProvider>

      <ConfirmDialog
        open={pendingProductId !== null}
        onOpenChange={(open) => {
          if (open) return;
          if (confirmedSwitch.current) {
            confirmedSwitch.current = false;
            return;
          }
          // Closed without discarding: stay on the product being edited.
          if (pendingProductId !== null) {
            setPendingProductId(null);
            if (formProductId) setProductId(formProductId);
          }
        }}
        title="Discard unsaved changes?"
        description={`You have unsaved changes for ${formProduct?.name ?? 'this product'}. Switching to ${pendingProduct?.name ?? 'another product'} throws them away.`}
        confirmLabel="Discard and switch"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          const next = pendingProductId;
          confirmedSwitch.current = true;
          setDirtyMap({});
          setPendingProductId(null);
          setFormProductId(next);
        }}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (open) return;
          if (confirmedLeave.current) {
            confirmedLeave.current = false;
            return;
          }
          if (blocker.state === 'blocked') blocker.reset();
        }}
        title="Discard unsaved changes?"
        description="You have changes that are not saved. Leaving this section throws them away."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          confirmedLeave.current = true;
          setDirtyMap({});
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </Page>
  );
}
