import { toast } from '@/components/ui/sonner';
import { errorText } from './format';

/** One error toast with the server detail (problem+json). */
export function toastError(error: unknown, fallbackTitle?: string): void {
  const { title, description } = errorText(error);
  toast.error(fallbackTitle ?? title, description ? { description } : undefined);
}
