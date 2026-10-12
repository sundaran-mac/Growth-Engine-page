/**
 * Review checklist (8 items, Figma 241:1193). Pure functions, no database.
 *
 * Auto items are filled from data and cannot be ticked by hand:
 * - claim_check: the claim check result MAKE stores on the brief (`claimFlags`)
 * - consent, music_licence, ai_label: flags on the ready assets
 * - tracked_link: posts carry a tracked URL, or the product has a tracking base URL
 * - loudness: the master's loudness reading against the target
 * An item with no data to decide it (for example no loudness reading yet) becomes a manual tick.
 */
import {
  CHECKLIST_KEYS,
  LOUDNESS_TARGET_LUFS,
  LOUDNESS_TOLERANCE_LU,
  type ChecklistItem,
  type ChecklistKey,
  type ClaimFlag,
  type ContentMode,
  type Language,
} from '@growth-desk/contract';

export interface ChecklistAsset {
  mimeType: string;
  licence: string | null;
  consentOnFile: boolean;
  aiGenerated: boolean;
  /** Integrated loudness of the mix, when measured. */
  loudnessLufs: number | null;
}

export interface ChecklistInputs {
  mode: ContentMode;
  captionLanguages: readonly Language[];
  claimFlags: readonly ClaimFlag[];
  /** The ready master (video or poster), or null when none is ready. */
  master: ChecklistAsset | null;
  /** Every ready visual asset (master and cut-downs). */
  visualAssets: readonly ChecklistAsset[];
  /** Posts of the brief, if any exist yet. */
  posts: readonly { trackedUrl: string | null }[];
  /** Product tracking base URL (Settings, Tracking tab). */
  trackingBaseUrl: string | null;
}

/** Result of an auto check. `null` means there is no data, so a person ticks it. */
export type AutoResult = { done: boolean; detail: string | null } | null;

/** Typographic minus for negative numbers, as in the Figma ("−11.8 LUFS"). */
export function formatLufs(value: number): string {
  const fixed = Math.abs(value).toFixed(1);
  return value < 0 ? `−${fixed}` : fixed;
}

function isStill(asset: ChecklistAsset): boolean {
  return asset.mimeType.startsWith('image/');
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function checklistLabel(key: ChecklistKey, captionLanguages: readonly Language[]): string {
  switch (key) {
    case 'claim_check':
      return 'Claim check passed';
    case 'captions_safe_zone': {
      const langs = captionLanguages.map((l) => l.toUpperCase());
      return langs.length > 0
        ? `Captions ${langs.join(' and ')} inside the safe zone`
        : 'Captions inside the safe zone';
    }
    case 'real_screens':
      return 'Real app screens only, no mockups';
    case 'consent':
      return 'Consent on file for every face';
    case 'music_licence':
      return 'Music licensed for commercial use';
    case 'tracked_link':
      return 'Tracked link in bio and description';
    case 'ai_label':
      return 'AI label set where people are generated';
    case 'loudness':
      return 'Loudness';
  }
}

export function autoCheck(key: ChecklistKey, input: ChecklistInputs): AutoResult {
  const noMaster = { done: false, detail: 'No ready master asset yet' };
  switch (key) {
    case 'claim_check': {
      if (input.claimFlags.length === 0) {
        return { done: false, detail: 'The claim check has not run on this brief' };
      }
      const red = input.claimFlags.filter((f) => f.status === 'fail').length;
      const amber = input.claimFlags.filter((f) => f.status === 'warn').length;
      if (red > 0) return { done: false, detail: plural(red, 'red flag', 'red flags') };
      return { done: true, detail: amber > 0 ? plural(amber, 'amber note', 'amber notes') : null };
    }
    case 'consent': {
      if (!input.master) return noMaster;
      const missing = input.visualAssets.filter((a) => !a.consentOnFile).length;
      return missing === 0
        ? { done: true, detail: null }
        : { done: false, detail: `Consent missing on ${plural(missing, 'asset', 'assets')}` };
    }
    case 'music_licence': {
      if (!input.master) return noMaster;
      if (isStill(input.master)) return { done: true, detail: 'No audio in a still image' };
      const licence = input.master.licence?.trim();
      return licence
        ? { done: true, detail: licence }
        : { done: false, detail: 'No licence on the master asset' };
    }
    case 'ai_label': {
      if (!input.master) return noMaster;
      if (input.visualAssets.some((a) => a.aiGenerated)) {
        return { done: true, detail: 'AI label on' };
      }
      // M2 is "AI people stories": generated people are expected, so the label must be on.
      if (input.mode === 'M2') {
        return { done: false, detail: 'AI people piece: turn the AI label on in Studio' };
      }
      return { done: true, detail: 'No generated people' };
    }
    case 'tracked_link': {
      if (input.posts.length > 0) {
        const missing = input.posts.filter((p) => !p.trackedUrl).length;
        return missing === 0
          ? { done: true, detail: null }
          : { done: false, detail: `${plural(missing, 'post has', 'posts have')} no tracked link` };
      }
      return input.trackingBaseUrl
        ? { done: true, detail: `Added at publish from ${input.trackingBaseUrl}` }
        : { done: false, detail: 'Set the tracking base URL in Settings' };
    }
    case 'loudness': {
      if (!input.master) return noMaster;
      if (isStill(input.master)) return { done: true, detail: 'No audio in a still image' };
      const lufs = input.master.loudnessLufs;
      if (lufs === null || !Number.isFinite(lufs)) return null;
      const ok = Math.abs(lufs - LOUDNESS_TARGET_LUFS) <= LOUDNESS_TOLERANCE_LU;
      return {
        done: ok,
        detail: `${formatLufs(lufs)} LUFS (target ${formatLufs(LOUDNESS_TARGET_LUFS)})`,
      };
    }
    case 'captions_safe_zone':
    case 'real_screens':
      return null;
  }
}

/**
 * The full checklist: auto items from data, manual items from the stored ticks.
 * A stored tick only counts when it was a manual tick (an old auto value never carries over).
 */
export function buildChecklist(
  input: ChecklistInputs,
  stored: readonly ChecklistItem[] | null,
): ChecklistItem[] {
  const storedByKey = new Map((stored ?? []).map((i) => [i.key, i]));
  return CHECKLIST_KEYS.map((key) => {
    const label = checklistLabel(key, input.captionLanguages);
    const auto = autoCheck(key, input);
    if (auto) return { key, label, done: auto.done, auto: true, detail: auto.detail };
    const prev = storedByKey.get(key);
    const done = prev !== undefined && !prev.auto && prev.done;
    const detail = key === 'loudness' ? 'No loudness reading yet. Check the mix by hand.' : null;
    return { key, label, done, auto: false, detail };
  });
}

export function checklistCounts(items: readonly ChecklistItem[]) {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, complete: items.length > 0 && done === items.length };
}

/** Applies manual ticks. Throws the key of the first auto item someone tried to tick. */
export function applyManualTicks(
  items: readonly ChecklistItem[],
  ticks: readonly { key: ChecklistKey; done: boolean }[],
): { items: ChecklistItem[]; autoKey: ChecklistKey | null } {
  const byKey = new Map(ticks.map((t) => [t.key, t.done]));
  for (const item of items) {
    if (item.auto && byKey.has(item.key as ChecklistKey)) {
      return { items: [...items], autoKey: item.key as ChecklistKey };
    }
  }
  return {
    items: items.map((i) =>
      byKey.has(i.key as ChecklistKey) ? { ...i, done: byKey.get(i.key as ChecklistKey)! } : i,
    ),
    autoKey: null,
  };
}

/** Readable list of what is still open, for error messages. */
export function openItemsText(items: readonly ChecklistItem[]): string {
  return items
    .filter((i) => !i.done)
    .map((i) => i.label)
    .join(', ');
}
