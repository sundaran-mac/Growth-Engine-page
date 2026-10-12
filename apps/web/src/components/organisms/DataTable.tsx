import type * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/molecules/ErrorState';

export interface DataTableColumn<T> {
  id: string;
  /** Header text. Figma shows these as small caps ("CHANNEL", "FORMAT"). */
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined;
  getRowId: (row: T) => string;
  /** Screen-reader caption describing the table. */
  caption: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown when rows is an empty array. */
  empty?: React.ReactNode;
  /** Makes rows clickable and keyboard reachable (Enter or Space). */
  onRowClick?: (row: T) => void;
  isRowSelected?: (row: T) => boolean;
  className?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/** Basic table: loading skeleton, error with retry, empty state, clickable rows. */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  loading = false,
  error,
  onRetry,
  empty,
  onRowClick,
  isRowSelected,
  className,
}: DataTableProps<T>) {
  if (error) return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;

  return (
    <Table className={className} aria-busy={loading || undefined}>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.id} scope="col" className={cn(alignClass[col.align ?? 'left'], col.headClassName)}>
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <TableRow key={`skeleton-${i}`}>
              {columns.map((col) => (
                <TableCell key={col.id}>
                  <Skeleton className="h-4 w-full max-w-[160px]" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : rows && rows.length > 0 ? (
          rows.map((row) => {
            const selected = isRowSelected?.(row) ?? false;
            return (
              <TableRow
                key={getRowId(row)}
                data-state={selected ? 'selected' : undefined}
                aria-selected={onRowClick ? selected : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={cn(onRowClick && 'focus-ring cursor-pointer hover:bg-surface-sunken/60')}
              >
                {columns.map((col) => (
                  <TableCell key={col.id} className={cn(alignClass[col.align ?? 'left'], col.className)}>
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-muted">
              {empty ?? 'Nothing here yet.'}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
