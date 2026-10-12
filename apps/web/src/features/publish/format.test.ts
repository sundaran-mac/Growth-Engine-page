import { describe, expect, it } from 'vitest';
import type { PostView } from '@growth-desk/contract';
import {
  channelLabel,
  formatWhen,
  fromZonedInputValue,
  howLabel,
  languagesLabel,
  needsPolling,
  toZonedInputValue,
} from './format';

describe('publish format helpers', () => {
  it('labels HOW like the Figma', () => {
    expect(howLabel('auto', 'instagram')).toBe('Auto · Meta API');
    expect(howLabel('auto', 'youtube')).toBe('Auto · YouTube API');
    expect(howLabel('needs_approval', 'linkedin')).toBe('Needs API approval');
    expect(howLabel('reminder', 'whatsapp')).toBe('Reminder · by hand');
    expect(howLabel('not_connected', 'facebook')).toBe('Not connected');
  });

  it('labels channels and languages', () => {
    expect(channelLabel('instagram', 'reel')).toBe('Instagram Reel');
    expect(channelLabel('youtube', 'reel')).toBe('YouTube Short');
    expect(channelLabel('linkedin', 'reel', 'Elan')).toBe('LinkedIn · Elan');
    expect(channelLabel('whatsapp', 'poster')).toBe('WhatsApp Channel');
    expect(languagesLabel(['en', 'ta'])).toBe('EN + TA');
    expect(languagesLabel([])).toBe('-');
  });

  it('formats a time in the audience zone', () => {
    // 14:00 UTC is 7:30 pm in India, Thursday 15 Oct 2026.
    expect(formatWhen('2026-10-15T14:00:00.000Z', 'Asia/Kolkata')).toBe('Thu 7:30 pm IST');
  });

  it('round-trips a datetime-local value through a zone', () => {
    const iso = '2026-10-15T14:00:00.000Z';
    expect(toZonedInputValue(iso, 'Asia/Kolkata')).toBe('2026-10-15T19:30');
    expect(fromZonedInputValue('2026-10-15T19:30', 'Asia/Kolkata')).toBe(iso);
    expect(fromZonedInputValue('2026-10-15T20:00', 'Asia/Singapore')).toBe(
      '2026-10-15T12:00:00.000Z',
    );
    expect(fromZonedInputValue('not a date', 'Asia/Kolkata')).toBeNull();
  });

  it('polls only while a row is publishing or due', () => {
    const now = Date.parse('2026-10-15T14:00:00.000Z');
    const row = (status: PostView['status'], scheduledAt: string | null) =>
      ({ status, scheduledAt }) as PostView;
    expect(needsPolling(undefined, now)).toBe(false);
    expect(needsPolling([row('draft', null)], now)).toBe(false);
    expect(needsPolling([row('publishing', '2026-10-15T13:00:00.000Z')], now)).toBe(true);
    expect(needsPolling([row('scheduled', '2026-10-15T14:00:30.000Z')], now)).toBe(true);
    expect(needsPolling([row('scheduled', '2026-10-16T14:00:00.000Z')], now)).toBe(false);
  });
});
