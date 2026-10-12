import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Icon, type IconComponent } from '@/components/atoms/Icon';

export interface NavItemViewProps {
  icon: IconComponent;
  label: string;
  active?: boolean;
  /** Shown as "Label · 3" like Figma. Hidden when 0 or undefined. */
  count?: number | undefined;
  className?: string;
}

const base =
  'focus-ring-dark flex h-11 w-full items-center gap-3 rounded-tile px-3.5 py-2.5 text-sm transition-colors';
const activeClass = 'bg-joy font-semibold text-ink';
const idleClass = 'font-medium text-media-text/80 hover:bg-white/[0.06] hover:text-media-text';

function Content({ icon, label, count }: Pick<NavItemViewProps, 'icon' | 'label' | 'count'>) {
  return (
    <>
      <Icon icon={icon} size={20} />
      <span className="truncate">
        {label}
        {count ? (
          <>
            <span aria-hidden="true"> · {count}</span>
            <span className="sr-only">, {count} waiting</span>
          </>
        ) : null}
      </span>
    </>
  );
}

/** Presentational nav item (used by the kit page). */
export function NavItemView({ icon, label, active = false, count, className }: NavItemViewProps) {
  return (
    <div className={cn(base, active ? activeClass : idleClass, className)}>
      <Content icon={icon} label={label} count={count} />
    </div>
  );
}

export interface NavItemProps extends Omit<NavItemViewProps, 'active'> {
  to: string;
  /** Match the path exactly (use for "/"). */
  end?: boolean;
  onNavigate?: () => void;
}

/** Sidebar link. Active state comes from the router and sets aria-current="page". */
export function NavItem({ to, end, icon, label, count, onNavigate, className }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      onClick={onNavigate}
      className={({ isActive }) => cn(base, isActive ? activeClass : idleClass, className)}
    >
      <Content icon={icon} label={label} count={count} />
    </NavLink>
  );
}
