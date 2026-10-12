import logoMarkUrl from '@/assets/logo-mark.svg';
import { cn } from '@/lib/utils';

/**
 * Humini mark on a white tile (Figma "Marketing/Logo mark", 36px).
 * The SVG carries its own drop shadow, so it is drawn 40% larger and offset, as in Figma.
 * Never recolour the mark.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-block size-9 shrink-0', className)} aria-hidden="true">
      <img src={logoMarkUrl} alt="" width={50.4} height={50.4} className="absolute left-[-20%] top-[-13.33%] block max-w-none" />
    </span>
  );
}
