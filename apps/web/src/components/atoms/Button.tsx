import * as React from 'react';
import { ButtonBase, type ButtonBaseProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Icon, type IconComponent } from './Icon';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonBaseProps, 'variant' | 'size'> {
  /** primary = joy orange pill, dark = near-black pill, secondary = outlined pill, ghost = text only. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  leftIcon?: IconComponent;
  rightIcon?: IconComponent;
}

const iconSize: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

/** Pill button from the Figma kit (237:674). */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', loading = false, leftIcon, rightIcon, disabled, children, className, asChild, ...props },
    ref,
  ) => {
    if (asChild) {
      return (
        <ButtonBase ref={ref} asChild variant={variant} size={size} className={className} {...props}>
          {children}
        </ButtonBase>
      );
    }
    return (
      <ButtonBase
        ref={ref}
        variant={variant}
        size={size}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(loading && 'cursor-progress', className)}
        {...props}
      >
        {loading ? (
          <Spinner size={iconSize[size] - 2} label={null} />
        ) : leftIcon ? (
          <Icon icon={leftIcon} size={iconSize[size]} />
        ) : null}
        {children}
        {rightIcon && !loading ? <Icon icon={rightIcon} size={iconSize[size]} /> : null}
      </ButtonBase>
    );
  },
);
Button.displayName = 'Button';
