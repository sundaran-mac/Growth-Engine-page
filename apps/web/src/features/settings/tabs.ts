/** Settings tabs, in screen order. The id is the `?tab=` value. */
export const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'schedule', label: 'Posting schedule' },
  { id: 'channels', label: 'Channels' },
  { id: 'claude', label: 'Claude and weekly run' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'tracking', label: 'Tracking' },
] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export const isSettingsTab = (v: string | null): v is SettingsTabId =>
  SETTINGS_TABS.some((t) => t.id === v);
