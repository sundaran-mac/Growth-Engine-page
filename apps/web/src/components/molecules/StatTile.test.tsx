import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('shows label, value and delta like Figma', () => {
    render(<StatTile label="Reach · 7 days" value="48.2k" delta="+12% vs last week" />);
    const label = screen.getByText('Reach · 7 days');
    expect(label).toHaveClass('uppercase', 'tracking-kicker', 'text-muted');
    expect(screen.getByText('48.2k')).toHaveClass('text-stat', 'font-bold');
    expect(screen.getByText('+12% vs last week')).toHaveClass('text-joy-text');
  });

  it('colours the delta by tone', () => {
    render(<StatTile label="Installs" value="214" delta="+8%" deltaTone="care" />);
    expect(screen.getByText('+8%')).toHaveClass('text-care-text');
  });

  it('hides the value while loading and marks the tile busy', () => {
    const { container } = render(<StatTile label="Installs" value="214" delta="+8%" loading />);
    expect(screen.queryByText('214')).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
  });

  it('omits the delta line when there is none', () => {
    render(<StatTile label="Pieces" value="36" />);
    expect(screen.getByText('36')).toBeInTheDocument();
    expect(screen.queryByText(/vs last week/)).not.toBeInTheDocument();
  });
});
