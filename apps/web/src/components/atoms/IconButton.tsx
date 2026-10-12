import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Icon, type IconComponent } from './Icon';

export type IconButtonVariant = 'outline' | 'ghost' | 'dark' | 'primary';

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  icon: IconComponent;
  /** Required: the accessible name (and tooltip text). */
  label: string;
  variant?: IconButtonVariant;
  size?: 'sm' | 'md';
  /** Show the label as a tooltip on hover and focus. Default true. */
  tooltip?: boolean;
}

const variants: Record<IconButtonVariant, string> = {
  // Figma top bar bell: white circle with hairline border
  outline: 'border border-hairline bg-surface-card text-ink hover:bg-surface-sunken',
  ghost: 'text-ink hover:bg-surface-sunken',
  dark: 'text-media-text hover:bg-white/10 focus-ring-dark',
  primary: 'bg-joy text-ink hover:brightness-95',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      label,
      variant = 'outline',
      size = 'md',
      tooltip = true,
      className,
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const button = (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          'focus-ring relative inline-flex shrink-0 items-center justify-center rounded-pill transition-[color,background-color,border-color,box-shadow,filter,transform] duration-150 ease-out motion-safe:active:scale-[0.94] disabled:pointer-events-none disabled:opacity-50',
          size === 'md' ? 'size-10' : 'size-8',
          variants[variant],
          className,
        )}
        {...props}
      >
        <Icon icon={icon} size={size === 'md' ? 18 : 16} />
      </button>
    );
    if (!tooltip) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  },
);
IconButton.displayName = 'IconButton';
