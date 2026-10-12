import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusChip } from './StatusChip';

describe('StatusChip', () => {
  it.each([
    ['scheduled', 'bg-care-soft', 'text-care-text'],
    ['care', 'bg-care-soft', 'text-care-text'],
    ['reminder', 'bg-joy-soft', 'text-joy-text'],
    ['joy', 'bg-joy-soft', 'text-joy-text'],
    ['neutral', 'bg-surface-sunken', 'text-ink'],
    ['danger', 'bg-danger-soft', 'text-danger-text'],
    ['success', 'bg-success-soft', 'text-success-text'],
  ] as const)('tone %s uses the right colours', (tone, bg, text) => {
    render(<StatusChip tone={tone}>Label</StatusChip>);
    const chip = screen.getByText('Label');
    expect(chip).toHaveClass(bg, text, 'rounded-pill', 'text-2xs', 'font-semibold');
    expect(chip).toHaveAttribute('data-tone', tone);
  });

  it('defaults to neutral and renders an optional dot', () => {
    const { container } = render(<StatusChip dot>Draft</StatusChip>);
    expect(screen.getByText('Draft')).toHaveAttribute('data-tone', 'neutral');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
