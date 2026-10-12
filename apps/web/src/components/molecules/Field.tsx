import * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface FieldProps {
  label: React.ReactNode;
  /** Error text. Accepts a react-hook-form FieldError too (its message is used). */
  error?: string | { message?: string | undefined } | undefined;
  hint?: React.ReactNode;
  required?: boolean;
  /** id for the control. Generated when left out. */
  id?: string;
  className?: string;
  /** One form control (Input, Textarea, SelectTrigger...). It gets id, aria-invalid and aria-describedby. */
  children: React.ReactElement;
}

/**
 * Label + control + hint + error. Works with react-hook-form:
 *   <Field label="Email" error={errors.email}><Input {...register('email')} /></Field>
 */
export function Field({ label, error, hint, required = false, id, className, children }: FieldProps) {
  const autoId = React.useId();
  const controlId = id ?? (children.props as { id?: string }).id ?? `field-${autoId}`;
  const message = typeof error === 'string' ? error : error?.message;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = message ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id: controlId,
    'aria-invalid': message ? true : undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
  });

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={controlId}>
        {label}
        {required ? (
          <span className="text-danger-text" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-text">
          {message}
        </p>
      ) : null}
    </div>
  );
}
