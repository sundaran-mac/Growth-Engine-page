import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { DURATION, EASE, fadeUp } from '@/components/motion';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaddedContainerContext } from '@/components/ui/table-context';
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
  /**
   * Edge padding. Default is automatic: inside a padded Panel the outer cells line up with the
   * panel title (inset); anywhere else (flush Panel, bare card) the table pads its own edges by 24px.
   * Pass `inset` only for a padded container that is not a Panel; pass `inset={false}` to force edges.
   */
  inset?: boolean;
  /**
   * plain = header row with hairline dividers (default).
   * figma = Publish frame 242:1131: sunken header strip with 10px radius, 11px caps, rows without dividers.
   */
  look?: 'plain' | 'figma';
  /**
   * Rows ease in one after another on first show and when a row is added; a removed row fades out.
   * A refetch with the same row ids does not animate. Respects reduced motion.
   */
  stagger?: boolean;
  className?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};
const rowExit = { opacity: 0, transition: { duration: DURATION.fast, ease: EASE } };

/** Figma look: the strip and rows sit 14px in from their own rounded edge. */
const figmaHead =
  'h-auto bg-surface-sunken py-2.5 text-2xs first:rounded-l-[10px] first:pl-3.5 last:rounded-r-[10px] last:pr-3.5';
const figmaCell = 'py-4 first:pl-3.5 last:pr-3.5';

/**
 * The one table for every screen: loading skeleton, error with retry, empty state,
 * clickable and selectable rows, two looks and an optional row stagger.
 */
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
  inset,
  look = 'plain',
  stagger = false,
  className,
}: DataTableProps<T>) {
  const padded = React.useContext(PaddedContainerContext);
  if (error) return <ErrorState error={error} {...(onRetry ? { onRetry } : {})} />;
  const figma = look === 'figma';
  // The figma strip has its own inner padding; outside a padded container it keeps 24px from the card edge.
  const needsGutter = figma && !(inset ?? padded);

  const rowClass = (selected: boolean) =>
    cn(
      'group/row',
      onRowClick && 'focus-ring cursor-pointer',
      figma
        ? cn(
            'border-0 [&>td:first-child]:rounded-l-[10px] [&>td:last-child]:rounded-r-[10px]',
            selected ? '[&>td]:bg-joy-soft/70' : onRowClick && 'hover:[&>td]:bg-surface-sunken/60',
          )
        : onRowClick && 'hover:bg-surface-sunken/60',
    );

  const rowProps = (row: T) => {
    const selected = isRowSelected?.(row) ?? false;
    return {
      'data-state': selected ? 'selected' : undefined,
      'aria-selected': onRowClick ? selected : undefined,
      tabIndex: onRowClick ? 0 : undefined,
      onClick: onRowClick ? () => onRowClick(row) : undefined,
      onKeyDown: onRowClick
        ? (e: React.KeyboardEvent<HTMLTableRowElement>) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onRowClick(row);
            }
          }
        : undefined,
      className: cn(
        rowClass(selected),
        figma && selected && 'data-[state=selected]:bg-transparent',
      ),
    };
  };

  const cells = (row: T) =>
    columns.map((col) => (
      <TableCell
        key={col.id}
        className={cn(figma && figmaCell, alignClass[col.align ?? 'left'], col.className)}
      >
        {col.cell(row)}
      </TableCell>
    ));

  const hasRows = !loading && rows && rows.length > 0;

  const table = (
    <Table
      className={cn(figma && 'border-separate border-spacing-0', className)}
      aria-busy={loading || undefined}
      {...(inset === undefined ? {} : { inset })}
      {...(needsGutter ? { inset: true } : {})}
    >
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader className={cn(figma && '[&_tr]:border-0')}>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.id}
              scope="col"
              className={cn(figma && figmaHead, alignClass[col.align ?? 'left'], col.headClassName)}
            >
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {loading ? (
        <TableBody key="loading">
          {Array.from({ length: 4 }, (_, i) => (
            <TableRow key={`skeleton-${i}`} className={cn(figma && 'border-0')}>
              {columns.map((col) => (
                <TableCell key={col.id} className={cn(figma && figmaCell)}>
                  <Skeleton className="h-4 w-full max-w-[160px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      ) : hasRows && stagger ? (
        <motion.tbody
          key="rows"
          className="[&_tr:last-child]:border-0"
          initial="hidden"
          animate="show"
          variants={staggerContainer}
        >
          <AnimatePresence initial={false}>
            {rows.map((row) => {
              const { className: rc, ...rp } = rowProps(row);
              return (
                <motion.tr
                  key={getRowId(row)}
                  variants={fadeUp}
                  exit={rowExit}
                  {...rp}
                  className={cn(
                    'border-b border-hairline transition-colors data-[state=selected]:bg-joy-soft',
                    rc,
                  )}
                >
                  {cells(row)}
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </motion.tbody>
      ) : hasRows ? (
        <TableBody key="rows">
          {rows.map((row) => (
            <TableRow key={getRowId(row)} {...rowProps(row)}>
              {cells(row)}
            </TableRow>
          ))}
        </TableBody>
      ) : (
        <TableBody key="empty">
          <TableRow className={cn(figma && 'border-0')}>
            <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-muted">
              {empty ?? 'Nothing here yet.'}
            </TableCell>
          </TableRow>
        </TableBody>
      )}
    </Table>
  );

  return needsGutter ? <div className="px-6">{table}</div> : table;
}
