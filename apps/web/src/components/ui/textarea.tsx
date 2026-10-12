import * as React from 'react';
import { cn } from '@/lib/utils';
import { inputClass } from './input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(inputClass, 'h-auto min-h-[88px] resize-y', className)} {...props} />
));
Textarea.displayName = 'Textarea';
