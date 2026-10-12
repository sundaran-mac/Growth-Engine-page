import { MagnifyingGlass } from '@phosphor-icons/react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Accessible name. Defaults to the placeholder. */
  label?: string;
  containerClassName?: string;
}

/** Pill search field from the Figma top bar ("Search everything"). */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ label, placeholder = 'Search', className, containerClassName, ...props }, ref) => (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-pill border border-hairline bg-surface-card px-3.5 transition-colors focus-within:border-ink focus-within:ring-2 focus-within:ring-ring/20',
        containerClassName,
      )}
    >
      <MagnifyingGlass size={16} className="shrink-0 text-muted" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        className={cn('h-full min-w-0 flex-1 bg-transparent text-13 text-ink outline-none placeholder:text-muted', className)}
        {...props}
      />
    </div>
  ),
);
SearchInput.displayName = 'SearchInput';
