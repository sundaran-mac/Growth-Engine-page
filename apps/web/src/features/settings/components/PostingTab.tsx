/**
 * Posting schedule tab: launch date, product time zone, auto schedule, weekly slots per
 * platform (weekday + local time + audience time zone), and a preview of the next 10 slots.
 * Placeholder design until Jeeva designs Settings.
 */
import { AnimatePresence, motion } from 'motion/react';
import { CalendarCheck, Plus, Trash } from '@phosphor-icons/react';
import * as React from 'react';
import { toast } from 'sonner';
import {
  PLATFORMS,
  replacePostingSlotsSchema,
  type Platform,
  type ProductSettingsDetail,
} from '@growth-desk/contract';
import { IconButton } from '@/components/atoms/IconButton';
import { Input } from '@/components/atoms/Input';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { DURATION, EASE } from '@/components/motion';
import { Panel } from '@/components/organisms/Panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useNextSlots, useReplaceSlots, useSlots } from '../api';
import {
  errorToast,
  formatDayTime,
  platformLabel,
  viewerTimeZone,
  viewerZoneName,
  zoneAbbr,
} from '../format';
import { useSettingsDraft } from '../use-settings-draft';
import { FieldError } from './GeneralTab';
import {
  PlatformBadge,
  ReadOnlyNote,
  SaveBar,
  SettingRow,
  TabSkeleton,
  TimeZoneSelect,
  WeekdaySelect,
} from './shared';
import { useDraft, useReportDirty } from '../draft';
import { newSlotKey, toDraft, toInput, type SlotDraft } from '../slot-draft';

const KEYS = ['launchDate', 'timezone', 'autoSchedule'] as const;

/** Slot rows ease in when added and fade out when removed; the rows below slide up. */
const SLOT_MOTION = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE } },
  transition: { duration: DURATION.base, ease: EASE },
} as const;

export function PostingTab({
  productId,
  settings,
}: {
  productId: string;
  settings: ProductSettingsDetail;
}) {
  const canEdit = settings.canEdit;
  const form = useSettingsDraft(settings, KEYS, 'posting-settings');
  const slotsQuery = useSlots(productId);
  const replace = useReplaceSlots(productId);
  const next = useNextSlots(productId, 10);

  const saved = React.useMemo(() => (slotsQuery.data?.items ?? []).map(toDraft), [slotsQuery.data]);
  const { draft: slots, setDraft: setSlots, reset: resetSlots } = useDraft<SlotDraft[]>(saved);
  const [slotErrors, setSlotErrors] = React.useState<Record<string, string>>({});
  // Compare what would be saved (row keys of new rows do not count).
  const slotsDirty = JSON.stringify(slots.map(toInput)) !== JSON.stringify(saved.map(toInput));
  useReportDirty('posting-slots', slotsDirty);

  const dirty = form.dirty || slotsDirty;
  const saving = form.saving || replace.isPending;

  async function saveSlots(): Promise<boolean> {
    if (!slotsDirty) return true;
    const body = { slots: slots.map(toInput) };
    const parsed = replacePostingSlotsSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const idx = Number(issue.path[1]);
        const row = Number.isInteger(idx) ? slots[idx] : undefined;
        if (row) next[row.key] ??= issue.message;
      }
      setSlotErrors(next);
      toast.error('Check the highlighted slots');
      return false;
    }
    try {
      await replace.mutateAsync(body.slots);
      resetSlots();
      setSlotErrors({});
      return true;
    } catch (error) {
      toast.error(...errorToast(error, 'Slots not saved'));
      return false;
    }
  }

  async function saveAll() {
    const okSettings = await form.save();
    if (!okSettings) return;
    const hadSlots = slotsDirty;
    const okSlots = await saveSlots();
    if (okSlots && hadSlots) toast.success('Posting slots saved');
  }

  function discardAll() {
    form.discard();
    resetSlots();
    setSlotErrors({});
  }

  const patchSlot = (key: string, patch: Partial<SlotDraft>) => {
    setSlots((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    setSlotErrors((e) => ({ ...e, [key]: '' }));
  };

  const addSlot = (platform: Platform) =>
    setSlots((list) => [
      ...list,
      {
        key: newSlotKey(),
        platform,
        weekday: 4,
        localTime: '19:30',
        audienceTimezone: form.draft.timezone,
        label: '',
        active: true,
      },
    ]);

  const disabled = !canEdit || saving;
  const viewer = viewerTimeZone();

  return (
    <div className="flex flex-col gap-4">
      <ReadOnlyNote show={!canEdit} />
      <Panel title="Launch and time zone" description="Nothing is scheduled before the launch day.">
        <SettingRow
          title="First post day"
          help="Launch date in the product time zone. Leave empty to post any time."
          htmlFor="pt-launch"
        >
          <Input
            id="pt-launch"
            type="date"
            value={form.draft.launchDate ?? ''}
            onChange={(e) => form.set('launchDate', e.target.value || null)}
            disabled={disabled}
            className="max-w-xs"
            aria-invalid={form.errors.launchDate ? true : undefined}
          />
          {form.errors.launchDate ? <FieldError text={form.errors.launchDate} /> : null}
        </SettingRow>
        <SettingRow
          title="Product time zone"
          help="Used for the launch day, the weekly run and the plan."
          htmlFor="pt-tz"
        >
          <TimeZoneSelect
            id="pt-tz"
            value={form.draft.timezone}
            onChange={(tz) => form.set('timezone', tz)}
            disabled={disabled}
          />
        </SettingRow>
        <SettingRow
          title="Auto schedule"
          help="Approved posts take the next free slot on each channel. You can still change the time on Publish."
        >
          <Switch
            checked={form.draft.autoSchedule}
            onCheckedChange={(v) => form.set('autoSchedule', v)}
            disabled={disabled}
            aria-label="Auto schedule approved posts"
          />
        </SettingRow>
      </Panel>

      <Panel
        title="Posting slots"
        description="Weekly times per channel, in the audience's own time zone. One window can exist twice for two time zones."
        actions={
          canEdit ? (
            <Select value="" onValueChange={(v) => addSlot(v as Platform)} disabled={disabled}>
              <SelectTrigger
                className="h-9 w-auto gap-2 rounded-pill px-4 text-13 font-semibold"
                aria-label="Add a slot for a channel"
              >
                <Plus size={16} aria-hidden="true" />
                <SelectValue placeholder="Add slot" />
              </SelectTrigger>
              <SelectContent align="end">
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {platformLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      >
        {slotsQuery.isPending ? (
          <TabSkeleton />
        ) : slotsQuery.isError ? (
          <ErrorState error={slotsQuery.error} onRetry={() => void slotsQuery.refetch()} />
        ) : slots.length === 0 ? (
          <EmptyState
            bordered={false}
            icon={CalendarCheck}
            title="No posting slots yet"
            description="Add a slot per channel, for example Instagram on Thursday at 7:30 pm India time."
          />
        ) : (
          <div className="flex flex-col gap-5">
            <AnimatePresence initial={false}>
              {PLATFORMS.filter((p) => slots.some((s) => s.platform === p)).map((platform) => (
                <motion.fieldset
                  key={platform}
                  layout="position"
                  {...SLOT_MOTION}
                  className="flex flex-col gap-2"
                >
                  <legend className="mb-2">
                    <PlatformBadge platform={platform} />
                  </legend>
                  <AnimatePresence initial={false}>
                    {slots
                      .filter((s) => s.platform === platform)
                      .map((s) => (
                        <motion.div key={s.key} layout="position" {...SLOT_MOTION}>
                          <SlotRow
                            slot={s}
                            error={slotErrors[s.key]}
                            disabled={disabled}
                            onChange={(patch) => patchSlot(s.key, patch)}
                            onRemove={() => setSlots((list) => list.filter((x) => x.key !== s.key))}
                          />
                        </motion.div>
                      ))}
                  </AnimatePresence>
                </motion.fieldset>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Panel>

      <Panel
        title="Next 10 slots"
        description={`From the saved slots, after the launch day, skipping slots that already have a post. Your time zone: ${viewerZoneName(viewer)}.`}
      >
        {slotsDirty ? (
          <p className="text-xs font-medium text-joy-text">Save to update this preview.</p>
        ) : null}
        {next.isPending ? (
          <TabSkeleton />
        ) : next.isError ? (
          <ErrorState error={next.error} onRetry={() => void next.refetch()} />
        ) : next.data.items.length === 0 ? (
          <p className="py-4 text-sm text-muted">No free slots. Add an active slot above.</p>
        ) : (
          <ol className="grid gap-2 sm:grid-cols-2" aria-label="Next free posting slots">
            {next.data.items.map((s) => (
              <li
                key={`${s.slotId}-${s.at}`}
                className="flex items-center gap-3 rounded-tile border border-hairline px-3.5 py-2.5"
              >
                <PlatformBadge platform={s.platform} showLabel={false} />
                <div className="min-w-0 flex-1">
                  <p className="text-13 font-semibold text-ink">
                    {formatDayTime(s.at, s.audienceTimezone)} {zoneAbbr(s.at, s.audienceTimezone)}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {zoneAbbr(s.at, s.audienceTimezone) === zoneAbbr(s.at, viewer)
                      ? 'Your time too'
                      : `Your time: ${formatDayTime(s.at, viewer)}`}
                    {s.label ? ` · ${s.label}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void saveAll()}
        onDiscard={discardAll}
        disabled={!canEdit}
      />
    </div>
  );
}

function SlotRow({
  slot,
  error,
  disabled,
  onChange,
  onRemove,
}: {
  slot: SlotDraft;
  error: string | undefined;
  disabled: boolean;
  onChange: (patch: Partial<SlotDraft>) => void;
  onRemove: () => void;
}) {
  const base = `slot-${slot.key}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 items-center gap-2 rounded-tile bg-surface-base p-2 md:grid-cols-[120px_120px_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
        <WeekdaySelect
          value={slot.weekday}
          onChange={(d) => onChange({ weekday: d })}
          disabled={disabled}
          label={`Weekday for ${platformLabel(slot.platform)} slot`}
        />
        <Input
          type="time"
          aria-label="Local time"
          id={`${base}-time`}
          value={slot.localTime}
          onChange={(e) => onChange({ localTime: e.target.value.slice(0, 5) })}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
        />
        <TimeZoneSelect
          value={slot.audienceTimezone}
          onChange={(tz) => onChange({ audienceTimezone: tz })}
          disabled={disabled}
          label="Audience time zone"
        />
        <Input
          aria-label="Label"
          placeholder="Label, for example India evening"
          value={slot.label}
          maxLength={60}
          onChange={(e) => onChange({ label: e.target.value })}
          disabled={disabled}
        />
        <div className="flex items-center gap-2 px-1">
          <Switch
            checked={slot.active}
            onCheckedChange={(v) => onChange({ active: v })}
            disabled={disabled}
            aria-label="Slot active"
          />
          <span className="text-xs text-muted">{slot.active ? 'On' : 'Off'}</span>
        </div>
        {!disabled ? (
          <IconButton
            icon={Trash}
            label="Remove slot"
            variant="ghost"
            size="sm"
            onClick={onRemove}
          />
        ) : (
          <span />
        )}
      </div>
      {error ? <FieldError text={error} /> : null}
    </div>
  );
}
