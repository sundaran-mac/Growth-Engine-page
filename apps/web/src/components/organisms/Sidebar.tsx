import { SignOut, User } from '@phosphor-icons/react';
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAV_FOOTER, NAV_GROUPS, type NavEntry } from '@/app/nav';
import { Avatar } from '@/components/atoms/Avatar';
import { LogoMark } from '@/components/atoms/LogoMark';
import { NavItem } from '@/components/molecules/NavItem';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogout } from '@/lib/auth';
import { useApprovalsWaitingCount } from '@/lib/shell-queries';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/session';
import { ProductSwitcher } from './ProductSwitcher';

export interface SidebarProps {
  /** Called after a link is clicked (closes the drawer on small screens). */
  onNavigate?: () => void;
  className?: string;
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  editor: 'Editor',
  member: 'Member',
  viewer: 'Viewer',
};

function UserBlock() {
  const user = useSessionStore((s) => s.user);
  const logout = useLogout();
  const navigate = useNavigate();
  if (!user) return null;
  const subtitle = user.title || ROLE_LABEL[user.role] || user.role;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="focus-ring-dark -mx-2 flex items-center gap-2.5 rounded-tile px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
        aria-label={`Account: ${user.name}`}
      >
        <Avatar name={user.name} initials={user.initials} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-13 font-semibold text-media-text">{user.name}</span>
          <span className="truncate text-2xs text-muted">{subtitle}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block truncate text-13 font-semibold text-ink">{user.name}</span>
          <span className="block truncate text-xs font-normal text-muted">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User size={16} aria-hidden="true" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
          }}
        >
          <SignOut size={16} aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** True at each end of a scroll box that has more content past that end. */
function useScrollEdges(ref: React.RefObject<HTMLElement>) {
  const [edges, setEdges] = React.useState({ top: false, bottom: false });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref]);
  return edges;
}

const FADE = '20px';
function fadeMask({
  top,
  bottom,
}: {
  top: boolean;
  bottom: boolean;
}): React.CSSProperties | undefined {
  if (!top && !bottom) return undefined;
  const image = `linear-gradient(to bottom, ${top ? 'transparent' : 'black'} 0, black ${top ? FADE : '0px'}, black calc(100% - ${
    bottom ? FADE : '0px'
  }), ${bottom ? 'transparent' : 'black'} 100%)`;
  return { maskImage: image, WebkitMaskImage: image };
}

/**
 * App sidebar (Figma 239:677): 264px, near-black, joy active item, groups MAKE / SHIP / LEARN.
 * The logo, product switcher, footer links and user block stay pinned; only the nav scrolls
 * (on short screens), with a soft fade on an edge only when there is more to scroll that way.
 */
export function Sidebar({ onNavigate, className }: SidebarProps) {
  const approvals = useApprovalsWaitingCount();
  const countFor = (entry: NavEntry) => (entry.count === 'approvals' ? approvals.data : undefined);
  const navRef = React.useRef<HTMLElement>(null);
  const edges = useScrollEdges(navRef);
  const { pathname } = useLocation();

  // Keep the current page's item in view when the nav has to scroll.
  React.useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [pathname]);

  return (
    <div
      className={cn(
        'flex h-full w-sidebar flex-col gap-1 bg-media-canvas px-6 pb-5 pt-6',
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-3">
        <LogoMark />
        <div className="flex min-w-0 flex-col">
          <span className="text-17 font-bold text-media-text">Growth Desk</span>
          <span className="text-2xs text-muted">Humini ecosystem</span>
        </div>
      </div>
      <ProductSwitcher className="shrink-0" />
      <div className="h-2.5 shrink-0" aria-hidden="true" />
      <nav
        ref={navRef}
        aria-label="Main"
        data-scroll-top={edges.top || undefined}
        data-scroll-bottom={edges.bottom || undefined}
        style={fadeMask(edges)}
        className="-mx-2 -my-1 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 py-1 [&_a]:scroll-my-6 [scrollbar-color:rgb(245_242_236/0.18)_transparent] [scrollbar-width:thin]"
      >
        <div className="flex flex-col gap-1">
          {NAV_GROUPS.map((group, i) => (
            <div key={group.label ?? `group-${i}`} className="flex flex-col gap-1">
              {group.label ? (
                <p
                  id={`nav-group-${group.label}`}
                  className="mt-2.5 text-2xs font-semibold uppercase tracking-group text-muted"
                >
                  {group.label}
                </p>
              ) : null}
              <ul
                className="flex flex-col gap-1"
                aria-labelledby={group.label ? `nav-group-${group.label}` : undefined}
              >
                {group.items.map((entry) => (
                  <li key={entry.to}>
                    <NavItem
                      to={entry.to}
                      end={entry.end ?? false}
                      icon={entry.icon}
                      label={entry.label}
                      count={countFor(entry)}
                      {...(onNavigate ? { onNavigate } : {})}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <ul className="flex shrink-0 flex-col gap-1 pt-1">
        {NAV_FOOTER.map((entry) => (
          <li key={entry.to}>
            <NavItem
              to={entry.to}
              icon={entry.icon}
              label={entry.label}
              {...(onNavigate ? { onNavigate } : {})}
            />
          </li>
        ))}
      </ul>
      <div className="shrink-0">
        <UserBlock />
      </div>
    </div>
  );
}
