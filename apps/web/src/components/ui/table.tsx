import * as React from 'react';
import { cn } from '@/lib/utils';
import { PaddedContainerContext } from './table-context';

/** inset = the table sits in padded content; edge = the table runs to the card border. */
type TableEdge = 'inset' | 'edge';
const TableEdgeContext = React.createContext<TableEdge>('edge');

const edgeClass: Record<TableEdge, string> = {
  inset: 'first:pl-0 last:pr-0',
  edge: 'first:pl-6 last:pr-6',
};

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /**
   * Override the edge padding. Default: inset inside a padded Panel, edge everywhere else
   * (flush Panel, bare card, page).
   */
  inset?: boolean;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, inset, ...props }, ref) => {
    const padded = React.useContext(PaddedContainerContext);
    const edge: TableEdge = (inset ?? padded) ? 'inset' : 'edge';
    return (
      <TableEdgeContext.Provider value={edge}>
        <div className="relative w-full overflow-x-auto">
          <table
            ref={ref}
            className={cn('w-full caption-bottom border-collapse text-sm', className)}
            {...props}
          />
        </div>
      </TableEdgeContext.Provider>
    );
  },
);
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-hairline transition-colors data-[state=selected]:bg-joy-soft',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const edge = React.useContext(TableEdgeContext);
  return (
    <th
      ref={ref}
      className={cn(
        'h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold uppercase tracking-kicker text-muted',
        edgeClass[edge],
        className,
      )}
      {...props}
    />
  );
});
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const edge = React.useContext(TableEdgeContext);
  return (
    <td
      ref={ref}
      className={cn('px-3 py-3 align-middle text-sm text-ink', edgeClass[edge], className)}
      {...props}
    />
  );
});
TableCell.displayName = 'TableCell';

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-13 text-muted', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';
