import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from '@phosphor-icons/react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'focus-ring peer size-5 shrink-0 rounded-md border-[1.5px] border-strong bg-surface-card transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-care data-[state=checked]:bg-care data-[state=checked]:text-white',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check size={14} weight="bold" aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';
