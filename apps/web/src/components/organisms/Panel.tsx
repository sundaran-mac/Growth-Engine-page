import * as React from 'react';
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
}

const tones: Record<PanelTone, string> = {
  card: 'border border-hairline bg-surface-card text-ink',
  dark: 'bg-media-canvas text-media-text',
  sunken: 'bg-surface-sunken text-ink',
};

/** Card / panel from Figma Home (20px radius, 24px padding, 12px gap, 18px bold title). */
export function Panel({ title, titleIcon, description, actions, tone = 'card', flush = false, className, children, ...props }: PanelProps) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn('flex min-w-0 flex-col gap-3 rounded-card', tones[tone], !flush && 'p-6', className)}
      {...props}
    >
      {title || actions ? (
        <div className={cn('flex items-start gap-3', flush && 'px-6 pt-6')}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {title ? (
              <h2 id={headingId} className="flex items-center gap-2.5 text-lg font-bold">
                {titleIcon}
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className={cn('text-13', tone === 'dark' ? 'text-media-text/70' : 'text-muted')}>{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Alias for readers who look for "Card". */
export const ContentCard = Panel;
