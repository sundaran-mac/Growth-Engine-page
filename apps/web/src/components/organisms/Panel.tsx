import * as React from 'react';
import { PaddedContainerContext } from '@/components/ui/table-context';
import { cn } from '@/lib/utils';

export type PanelTone = 'card' | 'dark' | 'sunken';

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  /** Icon or element before the title (Figma "Claude this week" sparkle). */
  titleIcon?: React.ReactNode;
  description?: React.ReactNode;
  /** Right side of the header (a link button, a menu). */
  actions?: React.ReactNode;
  /** card = white with hairline border; dark = media canvas (Claude panel); sunken = beige. */
  tone?: PanelTone;
  /** Remove inner padding (for tables that run edge to edge). */
  flush?: boolean;
  /** Title size: lg = 18px (Figma Home panels, default), md = 17px (side panels), sm = 16px (settings sections). */
  titleSize?: 'sm' | 'md' | 'lg';
  /** Ease in once on mount (fade and 8px rise, 200 ms). Use for panels that load data. */
  fadeIn?: boolean;
}

const tones: Record<PanelTone, string> = {
  card: 'border border-hairline bg-surface-card text-ink',
  dark: 'bg-media-canvas text-media-text',
  sunken: 'bg-surface-sunken text-ink',
};

const titleSizes = { sm: 'text-base', md: 'text-17', lg: 'text-lg' } as const;

/** Card / panel from Figma Home (20px radius, 24px padding, 12px gap, 18px bold title). */
export function Panel({
  title,
  titleIcon,
  description,
  actions,
  tone = 'card',
  flush = false,
  fadeIn = false,
  titleSize = 'lg',
  className,
  children,
  ...props
}: PanelProps) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-card',
        tones[tone],
        !flush && 'p-6',
        fadeIn &&
          'duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] animate-in fade-in-0 slide-in-from-bottom-2',
        className,
      )}
      {...props}
    >
      {title || actions ? (
        <div className={cn('flex items-start gap-3', flush && 'px-6 pt-6')}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {title ? (
              <h2
                id={headingId}
                className={cn('flex items-center gap-2.5 font-bold', titleSizes[titleSize])}
              >
                {titleIcon}
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className={cn('text-13', tone === 'dark' ? 'text-media-text/70' : 'text-muted')}>
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <PaddedContainerContext.Provider value={!flush}>{children}</PaddedContainerContext.Provider>
    </section>
  );
}

/** Alias for readers who look for "Card". */
export const ContentCard = Panel;
