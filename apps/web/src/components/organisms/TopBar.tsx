import { List, MagnifyingGlass } from '@phosphor-icons/react';
import type * as React from 'react';
import { IconButton } from '@/components/atoms/IconButton';
import { Kbd } from '@/components/atoms/Kbd';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';
import { NotificationsBell } from './NotificationsBell';

export interface TopBarProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Page primary action slot, usually one primary Button ("+ New idea"). */
  actions?: React.ReactNode;
  className?: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Search pill that opens the command palette (Figma 239:762, 220 x 40).
 * Below 1400px wide (1280px when the page has no actions) it becomes a round icon button,
 * so long page titles keep their room. Both open Cmd+K.
 */
function SearchTrigger({ roomy }: { roomy: boolean }) {
  const setOpen = useUiStore((s) => s.setCommandOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search everything"
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        className={cn(
          'focus-ring hidden h-10 w-[220px] shrink-0 items-center gap-2 rounded-pill border border-hairline bg-surface-card px-3.5 text-left text-13 text-muted transition-colors duration-150 hover:border-strong hover:text-ink',
          roomy ? 'xl:flex' : 'min-[1400px]:flex',
        )}
      >
        <MagnifyingGlass size={16} aria-hidden="true" />
        <span className="flex-1">Search everything</span>
        {/* Not in Figma; kept as a quiet hint. */}
        <Kbd
          aria-hidden="true"
          className="border-transparent bg-transparent px-0 font-medium text-muted/70"
        >
          {isMac ? '⌘K' : 'Ctrl K'}
        </Kbd>
      </button>
      <IconButton
        icon={MagnifyingGlass}
        label="Search everything"
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        className={roomy ? 'xl:hidden' : 'min-[1400px]:hidden'}
        onClick={() => setOpen(true)}
      />
    </>
  );
}

/** Page top bar (Figma 239:758): 64px row; title 28 bold, subtitle 14 muted, search, bell, primary action. */
export function TopBar({ title, subtitle, actions, className }: TopBarProps) {
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  return (
    <header className={cn('flex min-h-16 items-center gap-4', className)}>
      <IconButton
        icon={List}
        label="Open menu"
        variant="outline"
        className="lg:hidden"
        onClick={() => setSidebarOpen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="truncate text-2xl font-bold text-ink">{title}</h1>
        {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
      </div>
      <SearchTrigger roomy={!actions} />
      <NotificationsBell />
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  );
}
