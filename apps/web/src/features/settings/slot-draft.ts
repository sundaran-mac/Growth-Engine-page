/** Slot editor rows (draft) and their conversion to the API input. */
import type { PostingSlot, PostingSlotInput } from '@growth-desk/contract';

export interface SlotDraft extends Required<Omit<PostingSlotInput, 'label'>> {
  key: string;
  label: string;
}

let seq = 0;
export const newSlotKey = () => `new-${(seq += 1)}`;

export function toDraft(s: PostingSlot): SlotDraft {
  return {
    key: s.id,
    platform: s.platform,
    weekday: s.weekday,
    localTime: s.localTime,
    audienceTimezone: s.audienceTimezone,
    label: s.label ?? '',
    active: s.active,
  };
}

export function toInput(d: SlotDraft): PostingSlotInput {
  return {
    platform: d.platform,
    weekday: d.weekday,
    localTime: d.localTime,
    audienceTimezone: d.audienceTimezone,
    label: d.label.trim() || null,
    active: d.active,
  };
}
