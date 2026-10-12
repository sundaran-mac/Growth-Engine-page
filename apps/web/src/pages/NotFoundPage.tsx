import { MapTrifold } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/molecules/EmptyState';
import { Page } from '@/components/templates/Page';

export default function NotFoundPage() {
  return (
    <Page title="Page not found" subtitle="The link may be old or mistyped">
      <EmptyState
        icon={MapTrifold}
        title="We could not find that page"
        description="Go back home, or use Search everything (Cmd K) to find a screen."
        action={
          <Button asChild variant="primary">
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </Page>
  );
}
