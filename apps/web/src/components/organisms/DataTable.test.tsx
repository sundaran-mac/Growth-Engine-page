import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Panel } from './Panel';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  code: string;
  when: string;
}
const ROWS: Row[] = [
  { id: 'a', code: 'REEL-031', when: 'Thu' },
  { id: 'b', code: 'POSTER-031', when: 'Fri' },
];
const columns: DataTableColumn<Row>[] = [
  { id: 'code', header: 'Code', cell: (r) => r.code },
  { id: 'when', header: 'Updated', align: 'right', cell: (r) => r.when },
];

function table(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return (
    <DataTable caption="Rows" columns={columns} rows={ROWS} getRowId={(r) => r.id} {...props} />
  );
}

describe('DataTable edge padding', () => {
  it('pads its own edges by default, so text never touches a card border', () => {
    render(table());
    expect(screen.getByRole('columnheader', { name: 'Code' })).toHaveClass('first:pl-6');
    expect(screen.getByRole('cell', { name: 'Thu' })).toHaveClass('last:pr-6', 'text-right');
  });

  it('pads its edges inside a flush Panel', () => {
    render(<Panel flush>{table()}</Panel>);
    expect(screen.getByRole('cell', { name: 'REEL-031' })).toHaveClass('first:pl-6');
  });

  it('lines up with the panel title inside a padded Panel', () => {
    render(<Panel title="Pieces">{table()}</Panel>);
    expect(screen.getByRole('cell', { name: 'REEL-031' })).toHaveClass('first:pl-0');
    expect(screen.getByRole('cell', { name: 'Thu' })).toHaveClass('last:pr-0');
  });

  it('lets the caller force the edge mode', () => {
    render(<Panel title="Pieces">{table({ inset: false })}</Panel>);
    expect(screen.getByRole('cell', { name: 'REEL-031' })).toHaveClass('first:pl-6');
  });
});

describe('DataTable looks and rows', () => {
  it('draws the Figma look: sunken header strip, no row dividers', () => {
    render(<Panel title="Channels">{table({ look: 'figma' })}</Panel>);
    const head = screen.getByRole('columnheader', { name: 'Code' });
    expect(head).toHaveClass(
      'bg-surface-sunken',
      'first:rounded-l-[10px]',
      'first:pl-3.5',
      'text-2xs',
    );
    const row = screen.getByRole('cell', { name: 'REEL-031' }).closest('tr');
    expect(row).toHaveClass('border-0');
  });

  it('keeps 24px from the card edge for the Figma look outside a padded panel', () => {
    const { container } = render(table({ look: 'figma' }));
    expect(container.firstElementChild).toHaveClass('px-6');
  });

  it('staggered rows render every row and stay clickable by keyboard', async () => {
    const onRowClick = vi.fn();
    render(table({ stagger: true, onRowClick, isRowSelected: (r) => r.id === 'b' }));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    rows[0]!.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('shows the empty text when there are no rows', () => {
    render(table({ rows: [], empty: 'No briefs yet.' }));
    expect(within(screen.getByRole('table')).getByText('No briefs yet.')).toBeInTheDocument();
  });
});
