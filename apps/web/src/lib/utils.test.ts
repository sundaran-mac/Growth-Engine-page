import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps the text colour next to a custom font size', () => {
    expect(cn('text-media-text', 'text-13')).toBe('text-media-text text-13');
    expect(cn('text-ink', 'text-stat')).toBe('text-ink text-stat');
    expect(cn('text-muted', 'text-2xs')).toBe('text-muted text-2xs');
  });
  it('still lets a later font size win over an earlier one', () => {
    expect(cn('text-13', 'text-sm')).toBe('text-sm');
    expect(cn('text-sm', 'text-17')).toBe('text-17');
  });
  it('still lets a later colour win over an earlier one', () => {
    expect(cn('text-ink', 'text-media-text')).toBe('text-media-text');
  });
});
