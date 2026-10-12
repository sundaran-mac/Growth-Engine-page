import { describe, expect, it } from 'vitest';
import { addMonths, calendarWeeks, defaultPlanMonth, ideasPermissions, isMonthKey, monthBounds, monthTitle } from './lib';

const P = 'p1';

describe('month helpers', () => {
  it('moves across years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('opens on next month by default', () => {
    expect(defaultPlanMonth(new Date(2026, 9, 12))).toBe('2026-11');
    expect(defaultPlanMonth(new Date(2026, 11, 31))).toBe('2027-01');
  });

  it('checks month keys', () => {
    expect(isMonthKey('2026-11')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey(null)).toBe(false);
  });

  it('builds Monday-first weeks and month bounds', () => {
    const weeks = calendarWeeks('2026-11');
    expect(weeks[0]?.[0]).toBe('2026-10-26');
    expect(weeks).toHaveLength(6);
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthTitle('2026-11')).toBe('November 2026');
  });
});

describe('ideasPermissions', () => {
  it('matches the API rules', () => {
    const member = ideasPermissions({ role: 'member' }, [{ productId: P, productRole: 'maker' }], P);
    expect(member).toMatchObject({ canRead: true, canWrite: true, canDelete: false, canFreeze: false, canUnfreeze: false });
    const owner = ideasPermissions({ role: 'member' }, [{ productId: P, productRole: 'owner' }], P);
    expect(owner.canFreeze).toBe(true);
    const viewer = ideasPermissions({ role: 'viewer' }, [], P);
    expect(viewer).toMatchObject({ canRead: true, canWrite: false });
    const editor = ideasPermissions({ role: 'editor' }, [], P);
    expect(editor).toMatchObject({ canWrite: true, canDelete: true, canFreeze: true, canUnfreeze: false, canAddOccasion: true });
    expect(ideasPermissions({ role: 'admin' }, [], P).canUnfreeze).toBe(true);
    expect(ideasPermissions(null, [], P).canRead).toBe(false);
  });
});
