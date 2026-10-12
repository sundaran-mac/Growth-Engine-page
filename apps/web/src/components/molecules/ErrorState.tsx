import { ArrowClockwise, Warning } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { isApiError } from '@/lib/api';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Any thrown value. An ApiError gives its title and detail. */
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

export function errorMessage(error: unknown): { title: string; detail: string | undefined } {
  if (isApiError(error)) return { title: error.title, detail: error.detail };
  if (error instanceof Error) return { title: 'Something went wrong', detail: error.message };
  return { title: 'Something went wrong', detail: undefined };
}

/** Error block with a retry button. Use for failed queries in place of the content. */
export function ErrorState({ title, description, error, onRetry, retrying = false, className }: ErrorStateProps) {
  const parsed = errorMessage(error);
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-hairline bg-surface-card px-6 py-12 text-center',
        className,
      )}
    >
      <span className="inline-flex size-12 items-center justify-center rounded-tile bg-danger-soft text-danger-text">
        <Icon icon={Warning} size={24} />
      </span>
      <h2 className="text-lg font-bold text-ink">{title ?? parsed.title}</h2>
      <p className="max-w-md text-sm text-muted">{description ?? parsed.detail ?? 'Please try again.'}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" leftIcon={ArrowClockwise} loading={retrying} onClick={onRetry} className="mt-2">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
