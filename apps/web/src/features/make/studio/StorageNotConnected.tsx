import { CloudSlash } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/molecules/EmptyState';

export function StorageNotConnected({ compact = false }: { compact?: boolean }) {
  return (
    <EmptyState
      icon={CloudSlash}
      title="Storage not connected"
      description="File uploads are off because storage keys are not set. Connect R2 storage on Integrations."
      bordered={!compact}
      action={
        <Button asChild variant="secondary" size="sm">
          <Link to="/integrations">Open Integrations</Link>
        </Button>
      }
    />
  );
}
