import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Base button (shadcn/ui shape) with the Growth Desk variants from the Figma kit (237:674).
 * Prefer the atom `@/components/atoms/Button` in screens; it adds icons and a loading state.
 */
export const buttonVariants = cva(
  'focus-ring inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-joy text-ink hover:brightness-95 active:brightness-90',
        dark: 'bg-media-canvas text-media-text hover:bg-media-canvas/85',
        secondary: 'border-[1.5px] border-strong bg-surface-card text-ink hover:bg-surface-sunken',
        ghost: 'text-ink hover:bg-surface-sunken',
        danger: 'bg-danger text-white hover:bg-danger-text',
        link: 'h-auto rounded-sm px-0 py-0 text-ink underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-4 text-13',
        md: 'h-11 px-5 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10 p-0',
        'icon-sm': 'size-8 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonBaseProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const ButtonBase = React.forwardRef<HTMLButtonElement, ButtonBaseProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...(asChild ? {} : { type: type ?? 'button' })}
        {...props}
      />
    );
  },
);
ButtonBase.displayName = 'ButtonBase';
