// Home (Figma frame 239:675). Owned by the INSIGHTS agent.
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/atoms/Button';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Page } from '@/components/templates/Page';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { useSessionStore } from '@/stores/session';
import { useDashboard } from '@/features/insights/api';
import { greeting, longDate, needsYouLine } from '@/features/insights/format';
import {
  ClaudeThisWeekPanel,
  GoingOutTodayPanel,
  HomeSkeleton,
  HomeStats,
  NeedsYouPanel,
  NextPostsPanel,
  NoProductState,
  PipelinePanel,
  ProductsPanel,
} from '@/features/insights/components/HomePanels';
import { MondayNoteDialog } from '@/features/insights/components/MondayNoteDialog';

export default function HomePage() {
  const user = useSessionStore((s) => s.user);
  const selected = useSelectedProduct();
  const dashboard = useDashboard(selected.productId);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const firstName = user?.name.split(' ')[0];
  const data = dashboard.data;

  const subtitle = data
    ? [longDate(data.today), selected.product?.name, needsYouLine(data.needsYou.length)]
        .filter(Boolean)
        .join(' · ')
    : 'Loading your day';

  return (
    <Page
      title={firstName ? `${greeting()}, ${firstName}` : greeting()}
      documentTitle="Home"
      subtitle={subtitle}
      actions={
        <Button asChild>
          <Link to="/ideas">+ New idea</Link>
        </Button>
      }
    >
      {!selected.isLoading && !selected.productId ? (
        selected.isError ? (
          <ErrorState error={selected.error} onRetry={() => void selected.refetch()} />
        ) : (
          <NoProductState />
        )
      ) : dashboard.isError ? (
        <ErrorState
          error={dashboard.error}
          onRetry={() => void dashboard.refetch()}
          retrying={dashboard.isFetching}
        />
      ) : (
        <>
          <HomeStats data={data} loading={!data} />
          {!data ? (
            <HomeSkeleton />
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_392px]">
              <div className="flex min-w-0 flex-col gap-6">
                <NeedsYouPanel items={data.needsYou} />
                <GoingOutTodayPanel posts={data.goingOutToday} />
                <NextPostsPanel items={data.nextPosts} />
              </div>
              <div className="flex min-w-0 flex-col gap-6">
                <ClaudeThisWeekPanel
                  claude={data.claudeThisWeek}
                  onOpenNote={() => setNoteOpen(true)}
                />
                <PipelinePanel pipeline={data.pipeline} />
                <ProductsPanel products={data.products} />
              </div>
            </div>
          )}
        </>
      )}
      <MondayNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        productId={selected.productId}
        productName={selected.product?.name}
      />
    </Page>
  );
}
