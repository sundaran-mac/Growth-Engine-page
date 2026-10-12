import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from '@phosphor-icons/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { TooltipProvider } from '@/components/ui/tooltip';

describe('Button', () => {
  it.each([
    ['primary', 'bg-joy'],
    ['dark', 'bg-media-canvas'],
    ['secondary', 'border-strong'],
    ['ghost', 'hover:bg-surface-sunken'],
  ] as const)('renders the %s variant as a pill', (variant, expected) => {
    render(<Button variant={variant}>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn).toHaveClass(expected);
    expect(btn).toHaveClass('rounded-pill');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('defaults to primary, medium (44px high)', () => {
    render(<Button>Primary action</Button>);
    const btn = screen.getByRole('button', { name: 'Primary action' });
    expect(btn).toHaveClass('bg-joy', 'h-11', 'text-sm');
  });

  it('applies sizes', () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Small' })).toHaveClass('h-9');
    expect(screen.getByRole('button', { name: 'Large' })).toHaveClass('h-12');
  });

  it('loading disables the button, sets aria-busy and blocks clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} leftIcon={Plus}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onClick when enabled and is keyboard reachable', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Freeze</Button>);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Freeze' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders as a child element with asChild', () => {
    render(
      <Button asChild variant="secondary">
        <a href="/plan">Open plan</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Open plan' });
    expect(link).toHaveClass('border-strong');
  });
});

describe('IconButton', () => {
  it('uses the label as its accessible name', () => {
    render(
      <TooltipProvider>
        <IconButton icon={Plus} label="Add idea" />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Add idea' })).toBeInTheDocument();
  });
});
