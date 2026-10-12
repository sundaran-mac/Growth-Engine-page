import { AvatarFallback, AvatarImage, AvatarRoot } from '@/components/ui/avatar';
import { cn, initialsOf } from '@/lib/utils';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  name: string;
  /** Use the API's initials when present; otherwise taken from the name. */
  initials?: string | null;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

const sizes: Record<AvatarSize, string> = {
  sm: 'size-7 text-2xs',
  md: 'size-9 text-13', // Figma: 36px, 13px semibold
  lg: 'size-11 text-sm',
};

/** Initials avatar on joy-soft, as in the Figma kit. */
export function Avatar({ name, initials, src, size = 'md', className }: AvatarProps) {
  return (
    <AvatarRoot className={cn(sizes[size], className)} title={name}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback aria-label={name} role="img">
        {(initials || initialsOf(name)).slice(0, 2)}
      </AvatarFallback>
    </AvatarRoot>
  );
}
