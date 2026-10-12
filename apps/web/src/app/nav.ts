import {
  CalendarBlank,
  CalendarCheck,
  ChartLineUp,
  Eye,
  FilmStrip,
  GearSix,
  Handshake,
  HouseSimple,
  Lightbulb,
  NotePencil,
  PaperPlaneTilt,
  PlugsConnected,
  SealCheck,
  Stack,
} from '@phosphor-icons/react';
import type { IconComponent } from '@/components/atoms/Icon';

export interface NavEntry {
  to: string;
  label: string;
  icon: IconComponent;
  end?: boolean;
  /** Which live count to show next to the label. */
  count?: 'approvals';
}

export interface NavGroup {
  label: string | null;
  items: NavEntry[];
}

/** Sidebar structure from Figma (Sidebar 239:677). Icon names match the Figma kit. */
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: [{ to: '/', label: 'Home', icon: HouseSimple, end: true }] },
  {
    label: 'Make',
    items: [
      { to: '/products', label: 'Products', icon: Stack },
      { to: '/ideas', label: 'Ideas', icon: Lightbulb },
      { to: '/plan', label: 'Plan', icon: CalendarBlank },
      { to: '/briefs', label: 'Briefs', icon: NotePencil },
      { to: '/studio', label: 'Studio', icon: FilmStrip },
    ],
  },
  {
    label: 'Ship',
    items: [
      { to: '/review', label: 'Review', icon: Eye },
      { to: '/approvals', label: 'Approvals', icon: SealCheck, count: 'approvals' },
      { to: '/publish', label: 'Publish', icon: PaperPlaneTilt },
      { to: '/schedule', label: 'Schedule', icon: CalendarCheck },
    ],
  },
  {
    label: 'Learn',
    items: [
      { to: '/analytics', label: 'Analytics', icon: ChartLineUp },
      { to: '/sales', label: 'Sales', icon: Handshake },
    ],
  },
];

/** Bottom of the sidebar. Settings has no Figma frame (added 12 Oct 2026 at Sundaran's request). */
export const NAV_FOOTER: NavEntry[] = [
  { to: '/settings', label: 'Settings', icon: GearSix },
  { to: '/integrations', label: 'Integrations', icon: PlugsConnected },
];

export const ALL_NAV_ENTRIES: NavEntry[] = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER];
