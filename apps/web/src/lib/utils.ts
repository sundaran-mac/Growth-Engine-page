import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge must know our custom font sizes (tailwind.config.ts `fontSize`).
 * Without this it reads `text-13` or `text-stat` as a text colour and drops the real colour,
 * for example `text-media-text` on a dark button, which then shows black text on black.
 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['2xs', '13', '17', 'stat'] }] } },
});

/** Merge class names; later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Two-letter initials from a display name ("Jeeva Santiago" gives "JS"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
