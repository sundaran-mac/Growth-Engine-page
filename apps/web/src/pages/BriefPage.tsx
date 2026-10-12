// Brief screen (route /briefs/:briefId), Figma frame 240:1314.
import { ArrowLeft, FileX } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Page } from '@/components/templates/Page';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api';
import { useBrief } from '@/features/make/api';
import { BriefEditor } from '@/features/make/brief/BriefEditor';

function BriefSkeleton() {
  return (
    <Page title={<Skeleton className="h-8 w-80" />} documentTitle="Brief" subtitle={<Skeleton className="mt-1 h-4 w-64" />}>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-pill" />
        ))}
      </div>
      <div className="flex flex-col gap-5 lg:flex-row" aria-busy="true" aria-label="Loading brief">
        <Skeleton className="h-[420px] rounded-card lg:flex-[700_1_0%]" />
        <div className="flex flex-col gap-4 lg:flex-[376_1_0%]">
          <Skeleton className="h-56 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      </div>
    </Page>
  );
}

export default function BriefPage() {
  const { briefId } = useParams();
  const query = useBrief(briefId);

  if (query.isPending) return <BriefSkeleton />;
  if (query.isError) {
    const notFound = isApiError(query.error) && (query.error.status === 404 || query.error.code === 'VALIDATION_FAILED');
    return (
      <Page title="Brief">
        {notFound ? (
          <EmptyState
            icon={FileX}
            title="Brief not found"
            description="It may have been removed, or the link is wrong."
            action={
              <Button asChild variant="secondary">
                <Link to="/briefs"><ArrowLeft size={16} aria-hidden="true" />All briefs</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        )}
      </Page>
    );
  }
  return <BriefEditor key={query.data.id} brief={query.data} />;
}
