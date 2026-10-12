import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '@/test/utils';
import { productRoleOf, useSessionStore } from './session';
import { safeStorage, UI_STORAGE_KEY, useUiStore } from './ui';

describe('useSessionStore', () => {
  beforeEach(() => useSessionStore.setState({ user: null, memberships: [], status: 'unknown' }));

  it('starts unknown, then holds the session, then clears it', () => {
    expect(useSessionStore.getState().status).toBe('unknown');
    useSessionStore.getState().setSession({
      ...ME,
      memberships: [{ productId: '00000000-0000-4000-8000-0000000000aa', productRole: 'owner' }],
    });
    const s = useSessionStore.getState();
    expect(s.status).toBe('signedIn');
    expect(s.user?.name).toBe('Jeeva Santiago');
    expect(productRoleOf(s.memberships, '00000000-0000-4000-8000-0000000000aa')).toBe('owner');
    expect(productRoleOf(s.memberships, 'other')).toBeNull();
    expect(productRoleOf(s.memberships, null)).toBeNull();

    s.clearSession();
    expect(useSessionStore.getState()).toMatchObject({ user: null, memberships: [], status: 'signedOut' });
  });
});

describe('useUiStore', () => {
  afterEach(() => vi.restoreAllMocks());

  it('persists only the selected product', () => {
    useUiStore.getState().setSelectedProductId('p1');
    useUiStore.getState().setCommandOpen(true);
    const saved = JSON.parse(window.localStorage.getItem(UI_STORAGE_KEY) ?? '{}') as { state: Record<string, unknown> };
    expect(saved.state).toEqual({ selectedProductId: 'p1' });
    useUiStore.getState().toggleCommand();
    expect(useUiStore.getState().commandOpen).toBe(false);
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => useUiStore.getState().setSelectedProductId('p2')).not.toThrow();
    expect(useUiStore.getState().selectedProductId).toBe('p2');
    expect(safeStorage.getItem('x')).toBeNull();
  });
});
